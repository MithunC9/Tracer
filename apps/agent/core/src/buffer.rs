//! Local event buffer: SQLite (bundled) with every event payload encrypted at rest.
//!
//! Encryption: AES-256-GCM per row, 96-bit random nonce, the event id as associated data
//! (a payload cannot be swapped onto another row). The 256-bit key lives in the
//! [`SecretStore`] (Keychain on macOS, 0600 file in simulated mode). We chose per-row
//! AES-GCM over SQLCipher: no OpenSSL/SQLCipher build on every platform, and the plaintext
//! columns are limited to non-content metadata (id, seq, ts, kind, upload status).
//!
//! Lifecycle of an event: `pending` -> assigned to a persisted batch (stable batchId)
//! -> `sent` (or `rejected`) when the server acks that batch. Sent events are kept until
//! the end of their local day so the "what left this device today" view can show them,
//! then purged. Pending events are capped (oldest dropped first, and counted).

use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{AeadCore, Aes256Gcm, Key, Nonce};
use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use uuid::Uuid;

use crate::model::{fmt_ts, ActivityEvent};
use crate::secrets::{SecretError, SecretStore, BUFFER_KEY};

#[derive(Debug, thiserror::Error)]
pub enum BufferError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("crypto: payload failed authentication")]
    Crypto,
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Secret(#[from] SecretError),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, BufferError>;

pub struct Cipher {
    aead: Aes256Gcm,
}

impl Cipher {
    pub fn new(key: &[u8; 32]) -> Self {
        Cipher { aead: Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key)) }
    }

    pub fn generate_key() -> [u8; 32] {
        Aes256Gcm::generate_key(&mut OsRng).into()
    }

    /// Returns nonce || ciphertext+tag.
    pub fn seal(&self, plaintext: &[u8], aad: &[u8]) -> Vec<u8> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = self.aead.encrypt(&nonce, Payload { msg: plaintext, aad }).expect("aes-gcm encrypt");
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ct);
        out
    }

    pub fn open(&self, sealed: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        if sealed.len() < 12 + 16 {
            return Err(BufferError::Crypto);
        }
        let (n, ct) = sealed.split_at(12);
        self.aead.decrypt(Nonce::from_slice(n), Payload { msg: ct, aad }).map_err(|_| BufferError::Crypto)
    }
}

/// Load the buffer key from the secret store, creating one on first run.
pub fn load_or_create_key(secrets: &dyn SecretStore) -> Result<[u8; 32]> {
    if let Some(k) = secrets.get(BUFFER_KEY)? {
        if let Ok(arr) = <[u8; 32]>::try_from(k.as_slice()) {
            return Ok(arr);
        }
        return Err(SecretError::Malformed(BUFFER_KEY.into()).into());
    }
    let k = Cipher::generate_key();
    secrets.set(BUFFER_KEY, &k)?;
    Ok(k)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventStatus {
    Pending,
    Sent,
    Rejected,
}

impl EventStatus {
    fn as_str(self) -> &'static str {
        match self {
            EventStatus::Pending => "pending",
            EventStatus::Sent => "sent",
            EventStatus::Rejected => "rejected",
        }
    }
    fn parse(s: &str) -> Self {
        match s {
            "sent" => EventStatus::Sent,
            "rejected" => EventStatus::Rejected,
            _ => EventStatus::Pending,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEvent {
    pub status: EventStatus,
    pub batch_id: Option<Uuid>,
    pub event: ActivityEvent,
}

#[derive(Debug, Clone)]
pub struct PendingBatch {
    pub batch_id: Uuid,
    pub attempts: u32,
    pub events: Vec<ActivityEvent>,
}

#[derive(Debug, Clone, Copy)]
pub struct Retention {
    /// Hard cap on pending (unsent) events; oldest are dropped beyond it.
    pub max_pending: u64,
    /// Pending events older than this are dropped (the audit window is at most 14 days).
    pub max_pending_age: Duration,
}

impl Default for Retention {
    fn default() -> Self {
        Retention { max_pending: 500_000, max_pending_age: Duration::days(21) }
    }
}

pub struct Store {
    conn: Connection,
    cipher: Cipher,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS events (
  id        TEXT PRIMARY KEY,
  seq       INTEGER NOT NULL,
  ts        TEXT NOT NULL,
  kind      TEXT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'pending',
  batch_id  TEXT,
  stored_at TEXT NOT NULL,
  payload   BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_status_seq ON events(status, seq);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS events_batch ON events(batch_id);
CREATE TABLE IF NOT EXISTS batches (
  batch_id   TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value BLOB NOT NULL
);
"#;

pub const DB_FILE: &str = "buffer.sqlite";

impl Store {
    pub fn open(path: &Path, key: &[u8; 32]) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        Self::init(conn, key)
    }

    /// Open `<data_dir>/buffer.sqlite` with the key from `secrets`.
    pub fn open_in(data_dir: &Path, secrets: &dyn SecretStore) -> Result<Self> {
        let key = load_or_create_key(secrets)?;
        Self::open(&data_dir.join(DB_FILE), &key)
    }

    pub fn open_in_memory(key: &[u8; 32]) -> Result<Self> {
        Self::init(Connection::open_in_memory()?, key)
    }

    fn init(conn: Connection, key: &[u8; 32]) -> Result<Self> {
        conn.execute_batch(SCHEMA)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        Ok(Store { conn, cipher: Cipher::new(key) })
    }

    // ------------------------------------------------------------ kv (encrypted)

    pub fn kv_get<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>> {
        let blob: Option<Vec<u8>> =
            self.conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional()?;
        match blob {
            None => Ok(None),
            Some(b) => Ok(Some(serde_json::from_slice(&self.cipher.open(&b, key.as_bytes())?)?)),
        }
    }

    pub fn kv_set<T: Serialize>(&self, key: &str, value: &T) -> Result<()> {
        let sealed = self.cipher.seal(&serde_json::to_vec(value)?, key.as_bytes());
        self.conn.execute(
            "INSERT INTO kv(key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, sealed],
        )?;
        Ok(())
    }

    pub fn kv_delete(&self, key: &str) -> Result<()> {
        self.conn.execute("DELETE FROM kv WHERE key = ?1", [key])?;
        Ok(())
    }

    /// Next sequence number to assign (persisted so seq stays monotonic across restarts).
    pub fn next_seq(&self) -> Result<u64> {
        let stored: Option<u64> = self.kv_get("next_seq")?;
        let max: Option<i64> = self.conn.query_row("SELECT MAX(seq) FROM events", [], |r| r.get(0))?;
        let from_rows = max.map(|m| m as u64 + 1).unwrap_or(0);
        Ok(stored.unwrap_or(0).max(from_rows))
    }

    pub fn set_next_seq(&self, seq: u64) -> Result<()> {
        self.kv_set("next_seq", &seq)
    }

    // ------------------------------------------------------------ events

    /// Persist already-redacted events. Idempotent on event id.
    pub fn insert(&mut self, events: &[ActivityEvent]) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        let now = fmt_ts(&Utc::now());
        let tx = self.conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO events(id, seq, ts, kind, status, stored_at, payload) VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6)",
            )?;
            let mut max_seq = 0u64;
            for e in events {
                let id = e.id.to_string();
                let payload = self.cipher.seal(&serde_json::to_vec(e)?, id.as_bytes());
                stmt.execute(params![id, e.seq as i64, fmt_ts(&e.ts), e.kind(), now, payload])?;
                max_seq = max_seq.max(e.seq + 1);
            }
            let sealed = self.cipher.seal(&serde_json::to_vec(&max_seq)?, b"next_seq");
            let current: Option<Vec<u8>> =
                tx.query_row("SELECT value FROM kv WHERE key = 'next_seq'", [], |r| r.get(0)).optional()?;
            let current: u64 = match current {
                Some(b) => serde_json::from_slice(&self.cipher.open(&b, b"next_seq")?)?,
                None => 0,
            };
            if max_seq > current {
                tx.execute(
                    "INSERT INTO kv(key, value) VALUES ('next_seq', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    [sealed],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    fn decode(&self, id: &str, payload: &[u8]) -> Result<ActivityEvent> {
        Ok(serde_json::from_slice(&self.cipher.open(payload, id.as_bytes())?)?)
    }

    pub fn count(&self, status: EventStatus) -> Result<u64> {
        let n: i64 = self.conn.query_row("SELECT COUNT(*) FROM events WHERE status = ?1", [status.as_str()], |r| r.get(0))?;
        Ok(n as u64)
    }

    /// All events (any status) whose `ts` falls in [from, to), oldest first, decrypted.
    pub fn events_between(&self, from: DateTime<Utc>, to: DateTime<Utc>) -> Result<Vec<StoredEvent>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, status, batch_id, payload FROM events WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, seq",
        )?;
        let rows = stmt.query_map(params![fmt_ts(&from), fmt_ts(&to)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Vec<u8>>(3)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, status, batch, payload) = row?;
            out.push(StoredEvent {
                status: EventStatus::parse(&status),
                batch_id: batch.and_then(|b| Uuid::parse_str(&b).ok()),
                event: self.decode(&id, &payload)?,
            });
        }
        Ok(out)
    }

    /// Exactly the redacted events pending or sent with a timestamp in the local day of `now`.
    pub fn captured_today(&self, now: DateTime<Local>) -> Result<Vec<StoredEvent>> {
        let (start, end) = local_day_bounds(now);
        self.events_between(start, end)
    }

    /// Pending events in seq order (used by dry-run export).
    pub fn pending_events(&self, limit: usize) -> Result<Vec<ActivityEvent>> {
        let mut stmt = self.conn.prepare("SELECT id, payload FROM events WHERE status = 'pending' ORDER BY seq LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))?;
        rows.map(|r| {
            let (id, p) = r?;
            self.decode(&id, &p)
        })
        .collect()
    }

    // ------------------------------------------------------------ batches

    /// The batch that was assigned but not acknowledged (e.g. the app was killed mid-upload).
    /// Re-sending it with the same batchId makes ingest idempotent.
    pub fn open_batch(&self) -> Result<Option<PendingBatch>> {
        let row: Option<(String, u32)> = self
            .conn
            .query_row("SELECT batch_id, attempts FROM batches ORDER BY created_at LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        let Some((batch_id, attempts)) = row else { return Ok(None) };
        let mut stmt = self.conn.prepare("SELECT id, payload FROM events WHERE batch_id = ?1 AND status = 'pending' ORDER BY seq")?;
        let events: Vec<ActivityEvent> = stmt
            .query_map([&batch_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))?
            .map(|r| {
                let (id, p) = r?;
                self.decode(&id, &p)
            })
            .collect::<Result<_>>()?;
        let batch_id = Uuid::parse_str(&batch_id).map_err(|_| BufferError::Crypto)?;
        if events.is_empty() {
            self.conn.execute("DELETE FROM batches WHERE batch_id = ?1", [batch_id.to_string()])?;
            return self.open_batch();
        }
        Ok(Some(PendingBatch { batch_id, attempts, events }))
    }

    /// Assign up to `max_events` pending events (and at most `max_bytes` of serialized
    /// events) to a new batch, persisted before anything is sent.
    pub fn create_batch(&mut self, max_events: usize, max_bytes: usize) -> Result<Option<PendingBatch>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, payload FROM events WHERE status = 'pending' AND batch_id IS NULL ORDER BY seq LIMIT ?1")?;
        let rows: Vec<(String, Vec<u8>)> =
            stmt.query_map([max_events as i64], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<std::result::Result<_, _>>()?;
        drop(stmt);
        let mut events = Vec::new();
        let mut bytes = 0usize;
        for (id, p) in rows {
            let e = self.decode(&id, &p)?;
            let size = serde_json::to_vec(&e)?.len() + 1;
            if !events.is_empty() && bytes + size > max_bytes {
                break;
            }
            bytes += size;
            events.push(e);
        }
        if events.is_empty() {
            return Ok(None);
        }
        let batch_id = Uuid::new_v4();
        let tx = self.conn.transaction()?;
        tx.execute("INSERT INTO batches(batch_id, created_at) VALUES (?1, ?2)", params![batch_id.to_string(), fmt_ts(&Utc::now())])?;
        {
            let mut up = tx.prepare("UPDATE events SET batch_id = ?1 WHERE id = ?2")?;
            for e in &events {
                up.execute(params![batch_id.to_string(), e.id.to_string()])?;
            }
        }
        tx.commit()?;
        Ok(Some(PendingBatch { batch_id, attempts: 0, events }))
    }

    pub fn record_attempt(&self, batch_id: Uuid, error: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE batches SET attempts = attempts + 1, last_error = ?2 WHERE batch_id = ?1",
            params![batch_id.to_string(), error],
        )?;
        Ok(())
    }

    /// The server accepted the batch (accepted + duplicates); `rejected` ids are kept as
    /// rejected locally and never retried.
    pub fn ack_batch(&mut self, batch_id: Uuid, rejected: &[String]) -> Result<()> {
        let tx = self.conn.transaction()?;
        let b = batch_id.to_string();
        tx.execute("UPDATE events SET status = 'sent' WHERE batch_id = ?1 AND status = 'pending'", [&b])?;
        for id in rejected {
            tx.execute("UPDATE events SET status = 'rejected' WHERE batch_id = ?1 AND id = ?2", params![&b, id])?;
        }
        tx.execute("DELETE FROM batches WHERE batch_id = ?1", [&b])?;
        tx.commit()?;
        Ok(())
    }

    /// Return a batch's events to the pending pool (used when splitting an oversized or
    /// invalid batch). The old batchId is abandoned and never reused.
    pub fn release_batch(&mut self, batch_id: Uuid) -> Result<()> {
        let tx = self.conn.transaction()?;
        let b = batch_id.to_string();
        tx.execute("UPDATE events SET batch_id = NULL WHERE batch_id = ?1 AND status = 'pending'", [&b])?;
        tx.execute("DELETE FROM batches WHERE batch_id = ?1", [&b])?;
        tx.commit()?;
        Ok(())
    }

    pub fn mark_rejected(&mut self, ids: &[Uuid]) -> Result<()> {
        for id in ids {
            self.conn.execute("UPDATE events SET status = 'rejected', batch_id = NULL WHERE id = ?1", [id.to_string()])?;
        }
        Ok(())
    }

    // ------------------------------------------------------------ retention

    /// Purge sent/rejected events before the start of the local day, and enforce the
    /// pending cap. Returns the number of pending events dropped by the cap/age limit.
    pub fn purge(&mut self, now: DateTime<Local>, retention: Retention) -> Result<u64> {
        let (today_start, _) = local_day_bounds(now);
        self.conn.execute("DELETE FROM events WHERE status != 'pending' AND ts < ?1", [fmt_ts(&today_start)])?;
        let oldest_allowed = now.with_timezone(&Utc) - retention.max_pending_age;
        let mut dropped = self.conn.execute(
            "DELETE FROM events WHERE status = 'pending' AND batch_id IS NULL AND ts < ?1",
            [fmt_ts(&oldest_allowed)],
        )? as u64;
        let pending = self.count(EventStatus::Pending)?;
        if pending > retention.max_pending {
            let excess = pending - retention.max_pending;
            dropped += self.conn.execute(
                "DELETE FROM events WHERE id IN (SELECT id FROM events WHERE status = 'pending' AND batch_id IS NULL ORDER BY seq LIMIT ?1)",
                [excess as i64],
            )? as u64;
        }
        if dropped > 0 {
            let prev: u64 = self.kv_get("dropped_by_retention")?.unwrap_or(0);
            self.kv_set("dropped_by_retention", &(prev + dropped))?;
        }
        Ok(dropped)
    }

    /// Delete everything stored locally (events, batches, settings) and compact the file
    /// so deleted pages do not linger.
    pub fn wipe(&mut self) -> Result<()> {
        self.conn.execute_batch(
            "DELETE FROM events; DELETE FROM batches; DELETE FROM kv; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;",
        )?;
        Ok(())
    }
}

/// [start, end) of the local calendar day containing `now`, in UTC.
pub fn local_day_bounds(now: DateTime<Local>) -> (DateTime<Utc>, DateTime<Utc>) {
    let date = now.date_naive();
    let start_naive = date.and_time(NaiveTime::MIN);
    let start = Local
        .from_local_datetime(&start_naive)
        .earliest()
        .unwrap_or_else(|| now - Duration::hours(24));
    let next = Local
        .from_local_datetime(&(start_naive + Duration::days(1)))
        .earliest()
        .unwrap_or_else(|| start + Duration::hours(24));
    (start.with_timezone(&Utc), next.with_timezone(&Utc))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{AppRef, EventBody, RedactionCounts};

    pub fn ev(seq: u64, ts: DateTime<Utc>, title: &str) -> ActivityEvent {
        ActivityEvent {
            id: Uuid::now_v7(),
            ts,
            seq,
            schema_version: 1,
            redactions: RedactionCounts::new(),
            body: EventBody::AppFocus {
                app: AppRef { key: "excel".into(), name: "Microsoft Excel".into() },
                window_title: Some(title.into()),
                url_host: None,
            },
        }
    }

    #[test]
    fn cipher_roundtrip_and_aad_binding() {
        let c = Cipher::new(&Cipher::generate_key());
        let s = c.seal(b"hello", b"id-1");
        assert_eq!(c.open(&s, b"id-1").unwrap(), b"hello");
        assert!(c.open(&s, b"id-2").is_err());
        let other = Cipher::new(&Cipher::generate_key());
        assert!(other.open(&s, b"id-1").is_err());
    }

    #[test]
    fn batches_are_stable_until_acked() {
        let mut s = Store::open_in_memory(&Cipher::generate_key()).unwrap();
        let now = Utc::now();
        let evs: Vec<_> = (0..25).map(|i| ev(i, now, &format!("Sheet {i}"))).collect();
        s.insert(&evs).unwrap();
        s.insert(&evs[..3]).unwrap(); // idempotent
        assert_eq!(s.count(EventStatus::Pending).unwrap(), 25);
        assert_eq!(s.next_seq().unwrap(), 25);
        assert!(s.open_batch().unwrap().is_none());
        let b = s.create_batch(10, usize::MAX).unwrap().unwrap();
        assert_eq!(b.events.len(), 10);
        assert_eq!(b.events[0].seq, 0);
        // "crash" here: the same batch comes back with the same id and events
        let again = s.open_batch().unwrap().unwrap();
        assert_eq!(again.batch_id, b.batch_id);
        assert_eq!(again.events.iter().map(|e| e.id).collect::<Vec<_>>(), b.events.iter().map(|e| e.id).collect::<Vec<_>>());
        s.ack_batch(b.batch_id, &[b.events[1].id.to_string()]).unwrap();
        assert!(s.open_batch().unwrap().is_none());
        assert_eq!(s.count(EventStatus::Sent).unwrap(), 9);
        assert_eq!(s.count(EventStatus::Rejected).unwrap(), 1);
        let b2 = s.create_batch(1000, usize::MAX).unwrap().unwrap();
        assert_eq!(b2.events.len(), 15);
        assert_eq!(b2.events[0].seq, 10);
    }

    #[test]
    fn batches_respect_byte_cap() {
        let mut s = Store::open_in_memory(&Cipher::generate_key()).unwrap();
        let now = Utc::now();
        let evs: Vec<_> = (0..50).map(|i| ev(i, now, &"x".repeat(200))).collect();
        s.insert(&evs).unwrap();
        let one = serde_json::to_vec(&evs[0]).unwrap().len() + 1;
        let b = s.create_batch(1000, one * 7 + 3).unwrap().unwrap();
        assert_eq!(b.events.len(), 7);
        s.release_batch(b.batch_id).unwrap();
        let b = s.create_batch(1000, usize::MAX).unwrap().unwrap();
        assert_eq!(b.events.len(), 50);
    }

    #[test]
    fn today_query_and_purge() {
        let mut s = Store::open_in_memory(&Cipher::generate_key()).unwrap();
        let now = Local::now();
        let (start, _) = local_day_bounds(now);
        let today = ev(1, start + Duration::minutes(1), "today");
        let yesterday = ev(0, start - Duration::minutes(1), "yesterday");
        s.insert(&[yesterday.clone(), today.clone()]).unwrap();
        let t = s.captured_today(now).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].event, today);
        let b = s.create_batch(10, usize::MAX).unwrap().unwrap();
        s.ack_batch(b.batch_id, &[]).unwrap();
        s.purge(now, Retention::default()).unwrap();
        assert_eq!(s.count(EventStatus::Sent).unwrap(), 1, "yesterday's sent event purged, today's kept");
        assert_eq!(s.captured_today(now).unwrap()[0].status, EventStatus::Sent);
    }

    #[test]
    fn pending_cap_drops_oldest() {
        let mut s = Store::open_in_memory(&Cipher::generate_key()).unwrap();
        let now = Utc::now();
        s.insert(&(0..10).map(|i| ev(i, now, "x")).collect::<Vec<_>>()).unwrap();
        let dropped = s.purge(Local::now(), Retention { max_pending: 4, max_pending_age: Duration::days(21) }).unwrap();
        assert_eq!(dropped, 6);
        assert_eq!(s.pending_events(100).unwrap()[0].seq, 6);
        assert_eq!(s.kv_get::<u64>("dropped_by_retention").unwrap(), Some(6));
    }
}

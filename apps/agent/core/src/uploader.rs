//! Batches pending events and uploads them, idempotently.
//!
//! - A batch (≤ maxEventsPerBatch events, ≤ maxBatchBytes serialized) is assigned and its
//!   batchId persisted BEFORE the request. If the process dies mid-request, the same batch
//!   (same id, same events) is re-sent next time; the server treats it as a duplicate.
//! - Failures back off exponentially (base 2s, cap 15 min) with "equal jitter".
//! - 413 or a validation error splits the batch; a single invalid event is marked rejected
//!   locally so one bad row cannot wedge the queue.
//! - Every IngestResult carries `captureAllowed` / `captureUntil`; the agent acts on it.

use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use rand::Rng;

use crate::api::{ApiClient, ApiError};
use crate::buffer::{BufferError, PendingBatch, Store};
use crate::model::{limits, IngestBatch, IngestResult, Platform};

/// Exponential backoff with equal jitter: delay in [d/2, d], d = min(cap, base * 2^n).
#[derive(Debug, Clone)]
pub struct Backoff {
    pub base: Duration,
    pub cap: Duration,
    failures: u32,
    next_allowed: Option<Instant>,
}

impl Default for Backoff {
    fn default() -> Self {
        Backoff::new(Duration::from_secs(2), Duration::from_secs(15 * 60))
    }
}

impl Backoff {
    pub fn new(base: Duration, cap: Duration) -> Self {
        Backoff { base, cap, failures: 0, next_allowed: None }
    }

    pub fn delay_for(&self, failures: u32) -> Duration {
        let exp = self.base.saturating_mul(1u32.checked_shl(failures.min(20)).unwrap_or(u32::MAX));
        let d = exp.min(self.cap);
        let half = d / 2;
        let jitter = rand::thread_rng().gen_range(0..=half.as_millis().max(1) as u64);
        half + Duration::from_millis(jitter)
    }

    pub fn failure(&mut self) -> Duration {
        let d = self.delay_for(self.failures);
        self.failures = self.failures.saturating_add(1);
        self.next_allowed = Some(Instant::now() + d);
        d
    }

    pub fn success(&mut self) {
        self.failures = 0;
        self.next_allowed = None;
    }

    pub fn failures(&self) -> u32 {
        self.failures
    }

    pub fn ready(&self) -> bool {
        self.next_allowed.is_none_or(|t| Instant::now() >= t)
    }

    pub fn wait_remaining(&self) -> Duration {
        self.next_allowed.map(|t| t.saturating_duration_since(Instant::now())).unwrap_or_default()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum UploadError {
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    Buffer(#[from] BufferError),
    #[error("backing off for {0:?}")]
    BackingOff(Duration),
}

#[derive(Debug, Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadReport {
    pub batches: u32,
    pub accepted: u64,
    pub duplicates: u64,
    pub rejected: u64,
    /// The most recent IngestResult (carries captureAllowed / captureUntil).
    #[serde(skip)]
    pub last_result: Option<IngestResult>,
}

pub struct Uploader {
    pub platform: Platform,
    pub agent_version: String,
    pub backoff: Backoff,
    /// Shrinks on 413 / validation errors, grows back after successes.
    max_events: usize,
    max_bytes: usize,
}

impl Uploader {
    pub fn new(platform: Platform, agent_version: &str) -> Self {
        Uploader {
            platform,
            agent_version: agent_version.to_string(),
            backoff: Backoff::default(),
            max_events: limits::MAX_EVENTS_PER_BATCH,
            max_bytes: limits::MAX_BATCH_BYTES,
        }
    }

    pub fn with_limits(mut self, max_events: usize, max_bytes: usize) -> Self {
        self.max_events = max_events.clamp(1, limits::MAX_EVENTS_PER_BATCH);
        self.max_bytes = max_bytes.clamp(1024, limits::MAX_BATCH_BYTES);
        self
    }

    fn envelope(&self, batch: &PendingBatch, sent_at: DateTime<Utc>) -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&IngestBatch {
            batch_id: batch.batch_id,
            sent_at,
            agent_version: self.agent_version.clone(),
            platform: self.platform,
            events: batch.events.clone(),
        })
    }

    /// Upload until the queue is empty or a request fails. On failure the batch stays
    /// assigned (same batchId next time) and backoff is armed.
    pub fn upload_pending(&mut self, store: &mut Store, api: &ApiClient) -> Result<UploadReport, (UploadReport, UploadError)> {
        let mut report = UploadReport::default();
        if !self.backoff.ready() {
            return Err((report, UploadError::BackingOff(self.backoff.wait_remaining())));
        }
        loop {
            let batch = match store.open_batch() {
                Ok(Some(b)) => b,
                Ok(None) => {
                    // envelope overhead (~300 bytes) is reserved from the byte cap
                    match store.create_batch(self.max_events, self.max_bytes.saturating_sub(4096)) {
                        Ok(Some(b)) => b,
                        Ok(None) => return Ok(report),
                        Err(e) => return Err((report, e.into())),
                    }
                }
                Err(e) => return Err((report, e.into())),
            };
            let body = match self.envelope(&batch, Utc::now()) {
                Ok(b) => b,
                Err(e) => return Err((report, BufferError::Json(e).into())),
            };
            if body.len() > limits::MAX_BATCH_BYTES {
                if let Err(e) = self.split(store, &batch) {
                    return Err((report, e));
                }
                continue;
            }
            match api.ingest(body) {
                Ok(res) => {
                    let rejected: Vec<String> = res.rejected.iter().map(|r| r.id.clone()).collect();
                    if let Err(e) = store.ack_batch(batch.batch_id, &rejected) {
                        return Err((report, e.into()));
                    }
                    self.backoff.success();
                    self.max_events = (self.max_events * 2).min(limits::MAX_EVENTS_PER_BATCH);
                    report.batches += 1;
                    report.accepted += res.accepted;
                    report.duplicates += res.duplicates;
                    report.rejected += rejected.len() as u64;
                    let stop = !res.capture_allowed;
                    report.last_result = Some(res);
                    if stop {
                        // Window ended / paused / deleted: let the agent decide before sending more.
                        return Ok(report);
                    }
                }
                Err(e) if e.status() == Some(413) || (matches!(e.status(), Some(400) | Some(422)) && !e.is_window_closed()) => {
                    log::warn!("batch {} refused ({e}); splitting", batch.batch_id);
                    if let Err(e) = self.split(store, &batch) {
                        return Err((report, e));
                    }
                }
                Err(e) => {
                    let _ = store.record_attempt(batch.batch_id, Some(&e.to_string()));
                    let d = self.backoff.failure();
                    log::warn!("upload failed ({e}); retrying batch {} in {d:?}", batch.batch_id);
                    return Err((report, e.into()));
                }
            }
        }
    }

    fn split(&mut self, store: &mut Store, batch: &PendingBatch) -> Result<(), UploadError> {
        if batch.events.len() <= 1 {
            let ids: Vec<_> = batch.events.iter().map(|e| e.id).collect();
            store.release_batch(batch.batch_id)?;
            store.mark_rejected(&ids)?;
            log::warn!("event {:?} rejected by server validation; dropped from queue", ids);
            return Ok(());
        }
        store.release_batch(batch.batch_id)?;
        self.max_events = (batch.events.len() / 2).max(1);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_grows_with_jitter_and_caps() {
        let b = Backoff::new(Duration::from_secs(2), Duration::from_secs(60));
        for n in 0..10 {
            let d = b.delay_for(n);
            let full = Duration::from_secs(2 * (1u64 << n)).min(Duration::from_secs(60));
            assert!(d >= full / 2 && d <= full, "n={n} d={d:?} full={full:?}");
        }
        let mut b = Backoff::new(Duration::from_millis(10), Duration::from_millis(100));
        assert!(b.ready());
        b.failure();
        assert!(!b.ready());
        b.success();
        assert!(b.ready());
    }
}

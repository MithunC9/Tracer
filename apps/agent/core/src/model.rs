//! Serde mirrors of the Zod contract in `packages/schema` (events.ts, raw.ts, api.ts,
//! exclusions.ts). JSON shape must match exactly: camelCase fields, `kind`/`type`
//! discriminators, nullable (not optional) fields serialized as `null`.
//!
//! `tests/contract_shape.rs` validates serialized events against a JSON Schema generated
//! from the Zod types (`scripts/gen-contract.mjs`), and, when node is available, against
//! the Zod schema itself.

use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Contract limits (`packages/schema/src/config.ts` LIMITS). A test asserts these match
/// the generated `src/contract/limits.json`.
pub mod limits {
    pub const MAX_EVENTS_PER_BATCH: usize = 1000;
    pub const MAX_BATCH_BYTES: usize = 2 * 1024 * 1024;
    pub const MAX_WINDOW_TITLE_CHARS: usize = 256;
    pub const MAX_DIGEST_TEXT_CHARS: usize = 2000;
    pub const MAX_DIGEST_ITEMS: usize = 40;
    pub const MAX_DIGEST_ITEM_CHARS: usize = 120;
    pub const MAX_APP_NAME_CHARS: usize = 80;
    pub const MAX_REASON_CHARS: usize = 120;
    pub const MAX_HOST_CHARS: usize = 253;
    pub const DEFAULT_UPLOAD_INTERVAL_SECONDS: u64 = 300;
    pub const IDLE_THRESHOLD_SECONDS: u32 = 120;
    pub const SCHEMA_VERSION: u8 = 1;
}

/// Format a timestamp the way the API expects: RFC 3339, UTC, millisecond precision, `Z`.
/// Fixed width, so lexicographic order == chronological order (the buffer relies on this).
pub fn fmt_ts(t: &DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub mod ts_serde {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(t: &DateTime<Utc>, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&fmt_ts(t))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<DateTime<Utc>, D::Error> {
        let s = String::deserialize(d)?;
        DateTime::<FixedOffset>::parse_from_rfc3339(&s)
            .map(|t| t.with_timezone(&Utc))
            .map_err(serde::de::Error::custom)
    }
}

pub mod opt_ts_serde {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(t: &Option<DateTime<Utc>>, s: S) -> Result<S::Ok, S::Error> {
        match t {
            Some(t) => s.serialize_str(&fmt_ts(t)),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<DateTime<Utc>>, D::Error> {
        let s = Option::<String>::deserialize(d)?;
        s.map(|s| {
            DateTime::<FixedOffset>::parse_from_rfc3339(&s)
                .map(|t| t.with_timezone(&Utc))
                .map_err(serde::de::Error::custom)
        })
        .transpose()
    }
}

// ---------------------------------------------------------------- redaction

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RedactionKind {
    CardNumber,
    Ssn,
    Email,
    Phone,
    ApiKey,
    HighEntropyToken,
    PasswordField,
    Iban,
    UrlPath,
}

impl RedactionKind {
    pub const ALL: [RedactionKind; 9] = [
        RedactionKind::CardNumber,
        RedactionKind::Ssn,
        RedactionKind::Email,
        RedactionKind::Phone,
        RedactionKind::ApiKey,
        RedactionKind::HighEntropyToken,
        RedactionKind::PasswordField,
        RedactionKind::Iban,
        RedactionKind::UrlPath,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            RedactionKind::CardNumber => "card_number",
            RedactionKind::Ssn => "ssn",
            RedactionKind::Email => "email",
            RedactionKind::Phone => "phone",
            RedactionKind::ApiKey => "api_key",
            RedactionKind::HighEntropyToken => "high_entropy_token",
            RedactionKind::PasswordField => "password_field",
            RedactionKind::Iban => "iban",
            RedactionKind::UrlPath => "url_path",
        }
    }

    /// `[REDACTED:<kind>]`, identical to `redactionPlaceholder` in events.ts.
    pub fn placeholder(self) -> String {
        format!("[REDACTED:{}]", self.as_str())
    }
}

pub type RedactionCounts = BTreeMap<RedactionKind, u32>;

pub fn merge_counts(into: &mut RedactionCounts, from: &RedactionCounts) {
    for (k, v) in from {
        *into.entry(*k).or_insert(0) += v;
    }
}

// ---------------------------------------------------------------- ActivityEvent

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppRef {
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextDigest {
    pub headings: Vec<String>,
    pub labels: Vec<String>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContentKind {
    Text,
    Image,
    File,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureState {
    Started,
    Paused,
    Resumed,
    Stopped,
    AutoStopped,
    ExcludedAppActive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum EventBody {
    AppFocus {
        app: AppRef,
        window_title: Option<String>,
        url_host: Option<String>,
    },
    IdleStart {
        idle_threshold_seconds: u32,
    },
    IdleEnd {},
    ClipboardChange {
        app: AppRef,
        content_kind: ContentKind,
    },
    TextDigest {
        app: AppRef,
        digest: TextDigest,
        digest_hash: String,
    },
    CaptureState {
        state: CaptureState,
        reason: Option<String>,
    },
}

impl EventBody {
    pub fn kind(&self) -> &'static str {
        match self {
            EventBody::AppFocus { .. } => "app_focus",
            EventBody::IdleStart { .. } => "idle_start",
            EventBody::IdleEnd { .. } => "idle_end",
            EventBody::ClipboardChange { .. } => "clipboard_change",
            EventBody::TextDigest { .. } => "text_digest",
            EventBody::CaptureState { .. } => "capture_state",
        }
    }
}

/// The ONLY data that leaves the device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: Uuid,
    #[serde(with = "ts_serde")]
    pub ts: DateTime<Utc>,
    pub seq: u64,
    pub schema_version: u8,
    #[serde(default)]
    pub redactions: RedactionCounts,
    #[serde(flatten)]
    pub body: EventBody,
}

impl ActivityEvent {
    pub fn kind(&self) -> &'static str {
        self.body.kind()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
    Simulated,
}

impl Platform {
    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Macos => "macos",
            Platform::Windows => "windows",
            Platform::Linux => "linux",
            Platform::Simulated => "simulated",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestBatch {
    pub batch_id: Uuid,
    #[serde(with = "ts_serde")]
    pub sent_at: DateTime<Utc>,
    pub agent_version: String,
    pub platform: Platform,
    pub events: Vec<ActivityEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RejectedEvent {
    pub id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub batch_id: Uuid,
    pub accepted: u64,
    pub duplicates: u64,
    #[serde(default)]
    pub rejected: Vec<RejectedEvent>,
    pub capture_allowed: bool,
    #[serde(with = "opt_ts_serde", default)]
    pub capture_until: Option<DateTime<Utc>>,
}

// ---------------------------------------------------------------- API

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Exclusions {
    pub apps: Vec<String>,
    pub domains: Vec<String>,
    pub title_keywords: Vec<String>,
    /// Always true; private windows are excluded regardless of this value.
    #[serde(default = "always_true")]
    pub private_browsing: bool,
}

fn always_true() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub device_id: Uuid,
    pub audit_id: Option<Uuid>,
    pub capture_allowed: bool,
    #[serde(with = "opt_ts_serde", default)]
    pub capture_from: Option<DateTime<Utc>>,
    #[serde(with = "opt_ts_serde", default)]
    pub capture_until: Option<DateTime<Utc>>,
    pub paused: bool,
    pub exclusions: Exclusions,
    pub upload_interval_seconds: u64,
    pub idle_threshold_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairDeviceRequest {
    pub code: String,
    pub device_name: String,
    pub platform: Platform,
    pub agent_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairDeviceResponse {
    pub device_id: Uuid,
    pub device_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiErrorBody {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiErrorEnvelope {
    pub error: ApiErrorBody,
}

// ---------------------------------------------------------------- RawSample (device-local)

/// Device-local capture format (raw.ts). Never sent anywhere; the fixtures write it as
/// `raw.jsonl` and the simulated source replays it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum RawSample {
    Focus {
        #[serde(with = "ts_serde")]
        t: DateTime<Utc>,
        bundle_id: String,
        app_name: String,
        title: Option<String>,
        /// Full URL for browsers (device-local only).
        url: Option<String>,
        #[serde(default)]
        private: bool,
    },
    Ax {
        #[serde(with = "ts_serde")]
        t: DateTime<Utc>,
        bundle_id: String,
        app_name: String,
        headings: Vec<String>,
        labels: Vec<String>,
        text: String,
        #[serde(default)]
        secure_field: bool,
    },
    Clipboard {
        #[serde(with = "ts_serde")]
        t: DateTime<Utc>,
        bundle_id: String,
        app_name: String,
        content_kind: ContentKind,
    },
    IdleStart {
        #[serde(with = "ts_serde")]
        t: DateTime<Utc>,
        threshold_seconds: u32,
    },
    IdleEnd {
        #[serde(with = "ts_serde")]
        t: DateTime<Utc>,
    },
}

impl RawSample {
    pub fn t(&self) -> DateTime<Utc> {
        match self {
            RawSample::Focus { t, .. }
            | RawSample::Ax { t, .. }
            | RawSample::Clipboard { t, .. }
            | RawSample::IdleStart { t, .. }
            | RawSample::IdleEnd { t } => *t,
        }
    }

    pub fn shift(&mut self, by: chrono::Duration) {
        match self {
            RawSample::Focus { t, .. }
            | RawSample::Ax { t, .. }
            | RawSample::Clipboard { t, .. }
            | RawSample::IdleStart { t, .. }
            | RawSample::IdleEnd { t } => *t += by,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_focus_shape() {
        let e = ActivityEvent {
            id: Uuid::nil(),
            ts: DateTime::parse_from_rfc3339("2026-11-20T09:00:00Z").unwrap().with_timezone(&Utc),
            seq: 1,
            schema_version: 1,
            redactions: [(RedactionKind::Email, 2)].into_iter().collect(),
            body: EventBody::AppFocus {
                app: AppRef { key: "gmail".into(), name: "Gmail".into() },
                window_title: None,
                url_host: Some("mail.google.com".into()),
            },
        };
        let v = serde_json::to_value(&e).unwrap();
        assert_eq!(v["kind"], "app_focus");
        assert_eq!(v["schemaVersion"], 1);
        assert_eq!(v["ts"], "2026-11-20T09:00:00.000Z");
        assert_eq!(v["windowTitle"], serde_json::Value::Null);
        assert_eq!(v["urlHost"], "mail.google.com");
        assert_eq!(v["redactions"]["email"], 2);
        let back: ActivityEvent = serde_json::from_value(v).unwrap();
        assert_eq!(back, e);
    }

    #[test]
    fn raw_sample_parses() {
        let s: RawSample = serde_json::from_str(
            r#"{"t":"2026-11-16T09:00:00.000Z","type":"focus","bundleId":"com.google.Chrome","appName":"Google Chrome","title":"Inbox","url":"https://mail.google.com/mail/u/0/#inbox"}"#,
        )
        .unwrap();
        assert!(matches!(s, RawSample::Focus { private: false, .. }));
        let s: RawSample = serde_json::from_str(r#"{"t":"2026-11-16T09:00:00+01:00","type":"idle_start","thresholdSeconds":120}"#).unwrap();
        assert_eq!(fmt_ts(&s.t()), "2026-11-16T08:00:00.000Z");
    }
}

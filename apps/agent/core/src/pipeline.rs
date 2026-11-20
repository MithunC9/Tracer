//! RawSample -> exclude -> redact -> AppKey -> ActivityEvent.
//!
//! This is the only place ActivityEvents are constructed from captured data, and it runs
//! before anything touches disk: the buffer only ever receives the output of this module.

use chrono::{DateTime, Utc};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::apps::{self, resolve};
use crate::exclude::{is_excluded, ExclusionTarget};
use crate::model::{
    limits, merge_counts, ActivityEvent, AppRef, CaptureState, EventBody, Exclusions, RawSample, RedactionCounts,
    RedactionKind, TextDigest,
};
use crate::redact::{redact, secure_field, truncate_chars};

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStats {
    pub samples_in: u64,
    pub events_out: u64,
    /// Samples dropped because an excluded app/domain/title/private window was active.
    pub samples_excluded: u64,
    pub excluded_stretches: u64,
    pub redactions: RedactionCounts,
}

pub struct Pipeline {
    exclusions: Exclusions,
    next_seq: u64,
    /// Some while an excluded window is frontmost; everything except idle is dropped.
    in_excluded_stretch: bool,
    stats: PipelineStats,
}

/// sha256 over the normalized digest: each item trimmed, whitespace collapsed, lowercased;
/// headings, labels and text joined with U+001E record separators, items with U+001F.
pub fn digest_hash(d: &TextDigest) -> String {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let join = |v: &[String]| v.iter().map(|s| norm(s)).collect::<Vec<_>>().join("\u{1f}");
    let canonical = format!("{}\u{1e}{}\u{1e}{}", join(&d.headings), join(&d.labels), norm(&d.text));
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

fn clean(text: &str, max: usize, counts: &mut RedactionCounts) -> String {
    let r = redact(text);
    merge_counts(counts, &r.counts);
    truncate_chars(&r.text, max)
}

impl Pipeline {
    pub fn new(exclusions: Exclusions, next_seq: u64) -> Self {
        Pipeline { exclusions, next_seq, in_excluded_stretch: false, stats: PipelineStats::default() }
    }

    pub fn exclusions(&self) -> &Exclusions {
        &self.exclusions
    }

    pub fn set_exclusions(&mut self, ex: Exclusions) {
        self.exclusions = ex;
    }

    pub fn next_seq(&self) -> u64 {
        self.next_seq
    }

    pub fn stats(&self) -> &PipelineStats {
        &self.stats
    }

    pub fn in_excluded_stretch(&self) -> bool {
        self.in_excluded_stretch
    }

    fn event(&mut self, ts: DateTime<Utc>, redactions: RedactionCounts, body: EventBody) -> ActivityEvent {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.stats.events_out += 1;
        merge_counts(&mut self.stats.redactions, &redactions);
        ActivityEvent { id: Uuid::now_v7(), ts, seq, schema_version: limits::SCHEMA_VERSION, redactions, body }
    }

    /// Agent lifecycle event (started, paused, auto_stopped, ...). `reason` is redacted too.
    pub fn lifecycle(&mut self, ts: DateTime<Utc>, state: CaptureState, reason: Option<&str>) -> ActivityEvent {
        let mut counts = RedactionCounts::new();
        let reason = reason.map(|r| clean(r, limits::MAX_REASON_CHARS, &mut counts));
        if !matches!(state, CaptureState::ExcludedAppActive) {
            self.in_excluded_stretch = false;
        }
        self.event(ts, counts, EventBody::CaptureState { state, reason })
    }

    fn app_ref(&self, key: String, name: &str, counts: &mut RedactionCounts) -> AppRef {
        let name = clean(name, limits::MAX_APP_NAME_CHARS, counts);
        AppRef { key, name }
    }

    fn app_excluded(&self, bundle_id: &str, app_name: &str) -> bool {
        let r = resolve(bundle_id, app_name, None);
        is_excluded(&self.exclusions, &ExclusionTarget { app_key: &r.key, bundle_id: Some(bundle_id), ..Default::default() })
    }

    /// Turn one raw sample into zero or more events.
    pub fn process(&mut self, s: &RawSample) -> Vec<ActivityEvent> {
        self.stats.samples_in += 1;
        let ts = s.t();
        match s {
            RawSample::Focus { bundle_id, app_name, title, url, private, .. } => {
                let resolved = resolve(bundle_id, app_name, url.as_deref());
                let excluded = is_excluded(
                    &self.exclusions,
                    &ExclusionTarget {
                        app_key: &resolved.key,
                        bundle_id: Some(bundle_id),
                        url_host: resolved.url_host.as_deref(),
                        window_title: title.as_deref(),
                        is_private_window: *private,
                    },
                );
                if excluded {
                    self.stats.samples_excluded += 1;
                    if self.in_excluded_stretch {
                        return vec![];
                    }
                    self.in_excluded_stretch = true;
                    self.stats.excluded_stretches += 1;
                    // No app, title or host: only the fact that something excluded was active.
                    return vec![self.event(
                        ts,
                        RedactionCounts::new(),
                        EventBody::CaptureState { state: CaptureState::ExcludedAppActive, reason: None },
                    )];
                }
                self.in_excluded_stretch = false;
                let mut counts = RedactionCounts::new();
                if resolved.dropped_path {
                    *counts.entry(RedactionKind::UrlPath).or_insert(0) += 1;
                }
                let app = self.app_ref(resolved.key, app_name, &mut counts);
                let window_title = title.as_deref().map(|t| clean(t, limits::MAX_WINDOW_TITLE_CHARS, &mut counts));
                vec![self.event(ts, counts, EventBody::AppFocus { app, window_title, url_host: resolved.url_host })]
            }
            RawSample::Ax { bundle_id, app_name, headings, labels, text, secure_field: secure, .. } => {
                if self.in_excluded_stretch || self.app_excluded(bundle_id, app_name) {
                    self.stats.samples_excluded += 1;
                    return vec![];
                }
                let mut counts = RedactionCounts::new();
                let items = |v: &[String], counts: &mut RedactionCounts| -> Vec<String> {
                    v.iter()
                        .filter(|s| !s.trim().is_empty())
                        .take(limits::MAX_DIGEST_ITEMS)
                        .map(|s| clean(s, limits::MAX_DIGEST_ITEM_CHARS, counts))
                        .collect()
                };
                let headings = items(headings, &mut counts);
                let labels = items(labels, &mut counts);
                let text = if *secure {
                    let r = secure_field();
                    merge_counts(&mut counts, &r.counts);
                    r.text
                } else {
                    clean(text, limits::MAX_DIGEST_TEXT_CHARS, &mut counts)
                };
                let digest = TextDigest { headings, labels, text };
                let digest_hash = digest_hash(&digest);
                let app = self.app_ref(resolve(bundle_id, app_name, None).key, app_name, &mut counts);
                vec![self.event(ts, counts, EventBody::TextDigest { app, digest, digest_hash })]
            }
            RawSample::Clipboard { bundle_id, app_name, content_kind, .. } => {
                if self.in_excluded_stretch || self.app_excluded(bundle_id, app_name) {
                    self.stats.samples_excluded += 1;
                    return vec![];
                }
                let mut counts = RedactionCounts::new();
                let app = self.app_ref(resolve(bundle_id, app_name, None).key, app_name, &mut counts);
                vec![self.event(ts, counts, EventBody::ClipboardChange { app, content_kind: *content_kind })]
            }
            RawSample::IdleStart { threshold_seconds, .. } => {
                vec![self.event(ts, RedactionCounts::new(), EventBody::IdleStart { idle_threshold_seconds: (*threshold_seconds).max(1) })]
            }
            RawSample::IdleEnd { .. } => vec![self.event(ts, RedactionCounts::new(), EventBody::IdleEnd {})],
        }
    }
}

/// True if this AppKey is something the pipeline can emit (matches the schema regex).
pub fn valid_app_key(k: &str) -> bool {
    if let Some(slug) = k.strip_prefix("other:") {
        return (1..=64).contains(&slug.len())
            && slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'));
    }
    !k.is_empty() && k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') && apps::APPS.iter().any(|a| a.key == k)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exclude::default_exclusions;

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn focus(bundle: &str, name: &str, title: Option<&str>, url: Option<&str>, private: bool) -> RawSample {
        RawSample::Focus {
            t: t("2026-11-16T09:00:00Z"),
            bundle_id: bundle.into(),
            app_name: name.into(),
            title: title.map(Into::into),
            url: url.map(Into::into),
            private,
        }
    }

    #[test]
    fn focus_is_redacted_and_resolved() {
        let mut p = Pipeline::new(default_exclusions(), 10);
        let ev = p.process(&focus(
            "com.google.Chrome",
            "Google Chrome",
            Some("Invoice for jane@acme.com - 4111 1111 1111 1111"),
            Some("https://app.hubspot.com/contacts/123/record/0-1/456?x=1"),
            false,
        ));
        assert_eq!(ev.len(), 1);
        let e = &ev[0];
        assert_eq!(e.seq, 10);
        match &e.body {
            EventBody::AppFocus { app, window_title, url_host } => {
                assert_eq!(app.key, "hubspot");
                assert_eq!(url_host.as_deref(), Some("app.hubspot.com"));
                assert_eq!(window_title.as_deref(), Some("Invoice for [REDACTED:email] - [REDACTED:card_number]"));
            }
            _ => panic!(),
        }
        assert_eq!(e.redactions[&RedactionKind::UrlPath], 1);
        assert_eq!(e.redactions[&RedactionKind::Email], 1);
        assert_eq!(e.redactions[&RedactionKind::CardNumber], 1);
        assert_eq!(p.next_seq(), 11);
    }

    #[test]
    fn excluded_stretch_emits_single_event_without_details() {
        let mut p = Pipeline::new(default_exclusions(), 0);
        let a = p.process(&focus("com.1password.1password", "1Password", Some("Vault"), None, false));
        let ax = RawSample::Ax {
            t: t("2026-11-16T09:00:01Z"),
            bundle_id: "com.1password.1password".into(),
            app_name: "1Password".into(),
            headings: vec!["Logins".into()],
            labels: vec![],
            text: "secret".into(),
            secure_field: false,
        };
        let b = p.process(&ax);
        let c = p.process(&focus("com.google.Chrome", "Chrome", Some("Chase"), Some("https://secure.chase.com/x"), false));
        let d = p.process(&focus("com.google.Chrome", "Chrome", Some("New Tab"), None, true));
        assert_eq!(a.len(), 1);
        assert!(b.is_empty() && c.is_empty() && d.is_empty());
        let json = serde_json::to_string(&a[0]).unwrap();
        assert!(json.contains("excluded_app_active"));
        assert!(!json.contains("1Password") && !json.contains("Vault") && !json.contains("password_manager"));
        // stretch ends when a normal window becomes frontmost
        let e = p.process(&focus("com.microsoft.Excel", "Microsoft Excel", Some("Book1"), None, false));
        assert_eq!(e[0].kind(), "app_focus");
        let f = p.process(&focus("com.apple.Safari", "Safari", None, Some("https://mercury.com/"), false));
        assert_eq!(f[0].kind(), "capture_state");
        assert_eq!(p.stats().excluded_stretches, 2);
    }

    #[test]
    fn secure_field_text_is_dropped() {
        let mut p = Pipeline::new(default_exclusions(), 0);
        let ev = p.process(&RawSample::Ax {
            t: t("2026-11-16T09:00:01Z"),
            bundle_id: "com.google.Chrome".into(),
            app_name: "Chrome".into(),
            headings: vec!["Sign in".into()],
            labels: vec!["Email".into(), "Password".into()],
            text: "hunter2-super-secret".into(),
            secure_field: true,
        });
        let json = serde_json::to_string(&ev[0]).unwrap();
        assert!(!json.contains("hunter2"));
        assert_eq!(ev[0].redactions[&RedactionKind::PasswordField], 1);
    }

    #[test]
    fn digest_truncation_and_hash() {
        let mut p = Pipeline::new(default_exclusions(), 0);
        let long = "word ".repeat(1000);
        let ev = p.process(&RawSample::Ax {
            t: t("2026-11-16T09:00:01Z"),
            bundle_id: "com.microsoft.Excel".into(),
            app_name: "Microsoft Excel".into(),
            headings: (0..100).map(|i| format!("Heading {i} {}", "x".repeat(200))).collect(),
            labels: vec!["".into(), "OK".into()],
            text: long,
            secure_field: false,
        });
        match &ev[0].body {
            EventBody::TextDigest { digest, digest_hash: h, app } => {
                assert_eq!(app.key, "excel");
                assert_eq!(digest.headings.len(), limits::MAX_DIGEST_ITEMS);
                assert!(digest.headings.iter().all(|s| s.chars().count() <= limits::MAX_DIGEST_ITEM_CHARS));
                assert_eq!(digest.labels, vec!["OK".to_string()]);
                assert_eq!(digest.text.chars().count(), limits::MAX_DIGEST_TEXT_CHARS);
                assert_eq!(h.len(), 64);
                assert_eq!(*h, super::digest_hash(digest));
            }
            _ => panic!(),
        }
    }

    #[test]
    fn app_keys_are_schema_valid() {
        let mut p = Pipeline::new(default_exclusions(), 0);
        let ev = p.process(&focus("com.Weird App/Inc", "Weird App", None, None, false));
        match &ev[0].body {
            EventBody::AppFocus { app, .. } => assert!(valid_app_key(&app.key), "{}", app.key),
            _ => panic!(),
        }
    }
}

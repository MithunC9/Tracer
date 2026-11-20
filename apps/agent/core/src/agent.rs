//! The agent loop shared by `tracer-sim` and the Tauri shell:
//! source -> pipeline (exclude, redact) -> encrypted buffer -> uploader, plus pause/resume,
//! config polling and the audit-window auto-stop.
//!
//! Auto-stop is strict: once `captureUntil` passes (by wall clock or by sample time) or the
//! server says `captureAllowed: false` without `paused`, capture stops, a
//! `capture_state: auto_stopped` event is recorded, and no further samples are accepted.
//! Capture only restarts if the server opens a *different* audit window.

use std::time::{Duration, Instant};

use chrono::{DateTime, Local, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::{ApiClient, ApiError};
use crate::buffer::{BufferError, EventStatus, Retention, StoredEvent, Store};
use crate::model::{limits, AgentConfig, CaptureState, Exclusions, IngestResult, Platform, RawSample, RedactionCounts};
use crate::pipeline::{Pipeline, PipelineStats};
use crate::uploader::{UploadError, UploadReport, Uploader};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Not started yet (e.g. not paired, or no audit window).
    Idle,
    Capturing,
    Paused,
    /// Stopped by the user or because the device was revoked.
    Stopped,
    /// The audit window ended.
    AutoStopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub mode: Mode,
    pub audit_id: Option<Uuid>,
    pub stopped_audit_id: Option<Uuid>,
    pub capture_from: Option<DateTime<Utc>>,
    pub capture_until: Option<DateTime<Utc>>,
    pub exclusions: Exclusions,
    pub upload_interval_seconds: u64,
    pub idle_threshold_seconds: u32,
    pub last_upload_at: Option<DateTime<Utc>>,
    pub last_upload_error: Option<String>,
    pub stop_reason: Option<String>,
    pub device_id: Option<Uuid>,
    pub events_sent_total: u64,
}

impl Default for PersistedState {
    fn default() -> Self {
        PersistedState {
            mode: Mode::Idle,
            audit_id: None,
            stopped_audit_id: None,
            capture_from: None,
            capture_until: None,
            exclusions: Exclusions::default(),
            upload_interval_seconds: limits::DEFAULT_UPLOAD_INTERVAL_SECONDS,
            idle_threshold_seconds: limits::IDLE_THRESHOLD_SECONDS,
            last_upload_at: None,
            last_upload_error: None,
            stop_reason: None,
            device_id: None,
            events_sent_total: 0,
        }
    }
}

/// What the UI status screen shows. Counts only.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub mode: Mode,
    pub platform: Platform,
    pub paired: bool,
    pub capture_from: Option<DateTime<Utc>>,
    pub capture_until: Option<DateTime<Utc>>,
    /// "Day N of M" (1-based), when an audit window is known.
    pub day_number: Option<u32>,
    pub total_days: Option<u32>,
    pub pending_events: u64,
    pub events_today: u64,
    pub events_sent_total: u64,
    pub last_upload_at: Option<DateTime<Utc>>,
    pub last_upload_error: Option<String>,
    pub stop_reason: Option<String>,
    pub exclusions: Exclusions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayView {
    pub events: Vec<StoredEvent>,
    pub redactions: RedactionCounts,
    pub pending: u64,
    pub sent: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error(transparent)]
    Buffer(#[from] BufferError),
    #[error(transparent)]
    Api(#[from] ApiError),
}

const STATE_KEY: &str = "agent_state";

pub struct Agent {
    store: Store,
    api: Option<ApiClient>,
    pipeline: Pipeline,
    uploader: Uploader,
    state: PersistedState,
    platform: Platform,
    last_upload_attempt: Option<Instant>,
    last_config_poll: Option<Instant>,
    /// Override of the upload interval (tracer-sim --upload-interval).
    pub upload_interval_override: Option<Duration>,
    pub config_poll_interval: Duration,
    pub retention: Retention,
    pub samples_dropped_not_capturing: u64,
    pub upload_totals: UploadReport,
    /// Also compare `captureUntil` against the wall clock (true for real capture; the
    /// simulator turns it off when replaying un-shifted historical samples).
    pub use_wall_clock: bool,
}

impl Agent {
    pub fn new(store: Store, api: Option<ApiClient>, platform: Platform, agent_version: &str) -> Result<Self, AgentError> {
        let state: PersistedState = store.kv_get(STATE_KEY)?.unwrap_or_default();
        let pipeline = Pipeline::new(state.exclusions.clone(), store.next_seq()?);
        Ok(Agent {
            store,
            api,
            pipeline,
            uploader: Uploader::new(platform, agent_version),
            state,
            platform,
            last_upload_attempt: None,
            last_config_poll: None,
            upload_interval_override: None,
            config_poll_interval: Duration::from_secs(60),
            retention: Retention::default(),
            samples_dropped_not_capturing: 0,
            upload_totals: UploadReport::default(),
            use_wall_clock: true,
        })
    }

    pub fn with_uploader(mut self, uploader: Uploader) -> Self {
        self.uploader = uploader;
        self
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn store_mut(&mut self) -> &mut Store {
        &mut self.store
    }

    pub fn api_mut(&mut self) -> Option<&mut ApiClient> {
        self.api.as_mut()
    }

    pub fn set_api(&mut self, api: Option<ApiClient>) {
        self.api = api;
    }

    pub fn state(&self) -> &PersistedState {
        &self.state
    }

    pub fn mode(&self) -> Mode {
        self.state.mode
    }

    pub fn stats(&self) -> &PipelineStats {
        self.pipeline.stats()
    }

    pub fn uploader_mut(&mut self) -> &mut Uploader {
        &mut self.uploader
    }

    fn save(&self) -> Result<(), AgentError> {
        self.store.kv_set(STATE_KEY, &self.state)?;
        Ok(())
    }

    fn record(&mut self, ts: DateTime<Utc>, state: CaptureState, reason: Option<&str>) -> Result<(), AgentError> {
        let e = self.pipeline.lifecycle(ts, state, reason);
        self.store.insert(&[e])?;
        Ok(())
    }

    pub fn set_device_id(&mut self, id: Uuid) -> Result<(), AgentError> {
        self.state.device_id = Some(id);
        self.save()
    }

    /// Set the capture window locally (dry-run / tests; normally it comes from AgentConfig).
    pub fn set_capture_window(&mut self, from: Option<DateTime<Utc>>, until: Option<DateTime<Utc>>) -> Result<(), AgentError> {
        self.state.capture_from = from;
        self.state.capture_until = until;
        self.save()
    }

    pub fn set_exclusions(&mut self, ex: Exclusions) -> Result<(), AgentError> {
        let ex = Exclusions { private_browsing: true, ..ex };
        self.pipeline.set_exclusions(ex.clone());
        self.state.exclusions = ex;
        self.save()
    }

    // ------------------------------------------------------------ lifecycle

    /// Begin capturing (records `started`). No-op unless idle/stopped. Refuses to start once
    /// the known window has ended.
    pub fn start(&mut self, ts: DateTime<Utc>) -> Result<bool, AgentError> {
        if matches!(self.state.mode, Mode::Capturing | Mode::Paused) {
            return Ok(true);
        }
        if self.window_ended(ts) {
            return Ok(false);
        }
        if self.state.mode == Mode::AutoStopped && self.state.audit_id == self.state.stopped_audit_id {
            return Ok(false);
        }
        self.record(ts, CaptureState::Started, None)?;
        self.state.mode = Mode::Capturing;
        self.state.stop_reason = None;
        self.save()?;
        Ok(true)
    }

    pub fn pause(&mut self, ts: DateTime<Utc>, reason: Option<&str>) -> Result<(), AgentError> {
        if self.state.mode == Mode::Capturing {
            self.record(ts, CaptureState::Paused, reason)?;
            self.state.mode = Mode::Paused;
            self.save()?;
        }
        Ok(())
    }

    pub fn resume(&mut self, ts: DateTime<Utc>) -> Result<(), AgentError> {
        if self.state.mode == Mode::Paused && !self.window_ended(ts) {
            self.record(ts, CaptureState::Resumed, None)?;
            self.state.mode = Mode::Capturing;
            self.save()?;
        }
        Ok(())
    }

    /// User-initiated or terminal stop (records `stopped`).
    pub fn stop(&mut self, ts: DateTime<Utc>, reason: &str) -> Result<(), AgentError> {
        if matches!(self.state.mode, Mode::Capturing | Mode::Paused) {
            self.record(ts, CaptureState::Stopped, Some(reason))?;
        }
        self.state.mode = Mode::Stopped;
        self.state.stop_reason = Some(reason.to_string());
        self.save()
    }

    /// The audit window ended: stop and record `auto_stopped`. Never keeps capturing.
    pub fn auto_stop(&mut self, ts: DateTime<Utc>, reason: &str) -> Result<(), AgentError> {
        if self.state.mode == Mode::AutoStopped {
            return Ok(());
        }
        if matches!(self.state.mode, Mode::Capturing | Mode::Paused) {
            self.record(ts, CaptureState::AutoStopped, Some(reason))?;
        }
        self.state.mode = Mode::AutoStopped;
        self.state.stopped_audit_id = self.state.audit_id;
        self.state.stop_reason = Some(reason.to_string());
        log::info!("capture auto-stopped: {reason}");
        self.save()
    }

    fn window_ended(&self, t: DateTime<Utc>) -> bool {
        self.state.capture_until.is_some_and(|u| t >= u || (self.use_wall_clock && Utc::now() >= u))
    }

    // ------------------------------------------------------------ capture

    /// Feed samples from a source. Returns how many events were stored.
    pub fn ingest(&mut self, samples: &[RawSample]) -> Result<usize, AgentError> {
        let mut out = Vec::new();
        for s in samples {
            if let Some(until) = self.state.capture_until {
                if self.state.mode == Mode::Capturing && (s.t() >= until || (self.use_wall_clock && Utc::now() >= until)) {
                    self.store.insert(&out)?;
                    out.clear();
                    let ts = until.min(s.t());
                    self.auto_stop(ts, "audit window ended")?;
                }
            }
            if self.state.mode != Mode::Capturing {
                self.samples_dropped_not_capturing += 1;
                continue;
            }
            out.extend(self.pipeline.process(s));
        }
        let n = out.len();
        self.store.insert(&out)?;
        Ok(n)
    }

    /// Wall-clock check, for when no samples arrive (e.g. the machine is idle at the end).
    pub fn check_window(&mut self, now: DateTime<Utc>) -> Result<(), AgentError> {
        if !self.use_wall_clock {
            return Ok(());
        }
        if let Some(until) = self.state.capture_until {
            if now >= until && matches!(self.state.mode, Mode::Capturing | Mode::Paused) {
                self.auto_stop(until, "audit window ended")?;
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------ server

    /// Apply a freshly fetched AgentConfig.
    pub fn apply_config(&mut self, cfg: &AgentConfig, ts: DateTime<Utc>) -> Result<(), AgentError> {
        self.state.device_id = Some(cfg.device_id);
        self.state.upload_interval_seconds = cfg.upload_interval_seconds;
        self.state.idle_threshold_seconds = cfg.idle_threshold_seconds;
        self.state.capture_from = cfg.capture_from;
        self.state.capture_until = cfg.capture_until;
        if cfg.audit_id != self.state.audit_id {
            self.state.audit_id = cfg.audit_id;
        }
        let ex = Exclusions { private_browsing: true, ..cfg.exclusions.clone() };
        self.pipeline.set_exclusions(ex.clone());
        self.state.exclusions = ex;
        self.save()?;

        if cfg.paused {
            self.pause(ts, Some("paused from web"))?;
        } else if !cfg.capture_allowed {
            if matches!(self.state.mode, Mode::Capturing | Mode::Paused) {
                self.auto_stop(ts, "capture not allowed (audit window closed)")?;
            }
        } else {
            match self.state.mode {
                Mode::Paused => self.resume(ts)?,
                Mode::Idle => {
                    self.start(ts)?;
                }
                Mode::AutoStopped if cfg.audit_id.is_some() && cfg.audit_id != self.state.stopped_audit_id => {
                    self.start(ts)?;
                }
                _ => {}
            }
        }
        self.check_window(Utc::now())
    }

    fn apply_ingest_result(&mut self, res: &IngestResult, ts: DateTime<Utc>) -> Result<(), AgentError> {
        if let Some(u) = res.capture_until {
            self.state.capture_until = Some(u);
        }
        if !res.capture_allowed {
            // Paused or ended? Ask; if we cannot tell, stop (fail closed).
            match self.api.as_ref().map(|a| a.config()) {
                Some(Ok(cfg)) => {
                    self.apply_config(&cfg, ts)?;
                    if !cfg.paused && !cfg.capture_allowed {
                        self.auto_stop(ts, "capture not allowed (audit window closed)")?;
                    }
                }
                _ => self.auto_stop(ts, "server reported capture not allowed")?,
            }
        }
        self.save()
    }

    pub fn poll_config(&mut self, ts: DateTime<Utc>) -> Result<(), AgentError> {
        let Some(api) = self.api.as_ref() else { return Ok(()) };
        self.last_config_poll = Some(Instant::now());
        match api.config() {
            Ok(cfg) => self.apply_config(&cfg, ts),
            Err(e) if e.is_unauthorized() => {
                self.stop(ts, "device token revoked")?;
                Err(e.into())
            }
            Err(e) => Err(e.into()),
        }
    }

    fn upload_interval(&self) -> Duration {
        self.upload_interval_override.unwrap_or(Duration::from_secs(self.state.upload_interval_seconds.max(1)))
    }

    /// Upload everything pending now (subject to backoff).
    pub fn upload_now(&mut self, ts: DateTime<Utc>) -> Result<UploadReport, AgentError> {
        let Some(api) = self.api.clone() else { return Ok(UploadReport::default()) };
        self.last_upload_attempt = Some(Instant::now());
        let result = self.uploader.upload_pending(&mut self.store, &api);
        let (report, err) = match result {
            Ok(r) => (r, None),
            Err((r, e)) => (r, Some(e)),
        };
        self.upload_totals.batches += report.batches;
        self.upload_totals.accepted += report.accepted;
        self.upload_totals.duplicates += report.duplicates;
        self.upload_totals.rejected += report.rejected;
        if report.batches > 0 {
            self.state.last_upload_at = Some(Utc::now());
            self.state.events_sent_total += report.accepted + report.duplicates;
            self.state.last_upload_error = None;
        }
        if let Some(res) = &report.last_result {
            self.apply_ingest_result(res, ts)?;
        }
        match err {
            None => {
                self.save()?;
                Ok(report)
            }
            Some(UploadError::BackingOff(_)) => Ok(report),
            Some(UploadError::Api(e)) => {
                self.state.last_upload_error = Some(e.to_string());
                if e.is_unauthorized() {
                    self.stop(ts, "device token revoked")?;
                } else if e.is_window_closed() {
                    self.auto_stop(ts, "audit window closed")?;
                }
                self.save()?;
                Err(e.into())
            }
            Some(UploadError::Buffer(e)) => Err(e.into()),
        }
    }

    /// Periodic housekeeping: config poll, upload when due, retention.
    pub fn tick(&mut self, ts: DateTime<Utc>) -> Result<(), AgentError> {
        self.check_window(Utc::now())?;
        if self.api.is_some() {
            if self.last_config_poll.is_none_or(|t| t.elapsed() >= self.config_poll_interval) {
                if let Err(e) = self.poll_config(ts) {
                    log::warn!("config poll failed: {e}");
                }
            }
            let due = self.last_upload_attempt.is_none_or(|t| t.elapsed() >= self.upload_interval());
            if due && self.uploader.backoff.ready() {
                if let Err(e) = self.upload_now(ts) {
                    log::warn!("upload failed: {e}");
                }
            }
        }
        self.store.purge(Local::now(), self.retention)?;
        Ok(())
    }

    /// Upload until nothing is pending, sleeping through backoff, at most `max_failures`
    /// consecutive failures. Returns events still pending.
    pub fn flush(&mut self, ts: DateTime<Utc>, max_failures: u32) -> Result<u64, AgentError> {
        if self.api.is_none() {
            return Ok(self.store.count(EventStatus::Pending)?);
        }
        let mut failures = 0;
        loop {
            let wait = self.uploader.backoff.wait_remaining();
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
            match self.upload_now(ts) {
                Ok(report) => {
                    failures = 0;
                    let pending = self.store.count(EventStatus::Pending)?;
                    if pending == 0 || report.batches == 0 {
                        return Ok(pending);
                    }
                }
                Err(AgentError::Api(e)) if e.is_window_closed() || e.is_unauthorized() => {
                    return Ok(self.store.count(EventStatus::Pending)?);
                }
                Err(AgentError::Api(e)) if e.is_transient() => {
                    failures += 1;
                    if failures >= max_failures {
                        return Ok(self.store.count(EventStatus::Pending)?);
                    }
                }
                Err(e) => return Err(e),
            }
        }
    }

    // ------------------------------------------------------------ UI queries

    pub fn status(&self) -> Result<AgentStatus, AgentError> {
        let now = Utc::now();
        let (day_number, total_days) = match (self.state.capture_from, self.state.capture_until) {
            (Some(from), Some(until)) if until > from => {
                let total = ((until - from).num_seconds() as f64 / 86_400.0).ceil().max(1.0) as u32;
                let day = (((now - from).num_seconds().max(0) as f64 / 86_400.0).floor() as u32 + 1).min(total);
                (Some(day), Some(total))
            }
            _ => (None, None),
        };
        Ok(AgentStatus {
            mode: self.state.mode,
            platform: self.platform,
            paired: self.api.as_ref().is_some_and(ApiClient::has_token),
            capture_from: self.state.capture_from,
            capture_until: self.state.capture_until,
            day_number,
            total_days,
            pending_events: self.store.count(EventStatus::Pending)?,
            events_today: self.store.captured_today(Local::now())?.len() as u64,
            events_sent_total: self.state.events_sent_total,
            last_upload_at: self.state.last_upload_at,
            last_upload_error: self.state.last_upload_error.clone(),
            stop_reason: self.state.stop_reason.clone(),
            exclusions: self.state.exclusions.clone(),
        })
    }

    /// "What left this device today": exactly the stored (redacted) events of today.
    pub fn today(&self) -> Result<TodayView, AgentError> {
        let events = self.store.captured_today(Local::now())?;
        let mut redactions = RedactionCounts::new();
        let (mut pending, mut sent) = (0, 0);
        for e in &events {
            crate::model::merge_counts(&mut redactions, &e.event.redactions);
            match e.status {
                EventStatus::Pending => pending += 1,
                EventStatus::Sent => sent += 1,
                EventStatus::Rejected => {}
            }
        }
        Ok(TodayView { events, redactions, pending, sent })
    }

    /// Delete everything stored locally. Nothing is sent to the server.
    pub fn delete_everything(&mut self) -> Result<(), AgentError> {
        self.store.wipe()?;
        let ex = self.state.exclusions.clone();
        self.state = PersistedState { mode: Mode::Stopped, stop_reason: Some("local data deleted".into()), exclusions: ex, ..Default::default() };
        self.pipeline = Pipeline::new(self.state.exclusions.clone(), 0);
        self.save()
    }
}

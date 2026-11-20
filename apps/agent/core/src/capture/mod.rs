//! Capture sources. A source produces [`RawSample`]s (the device-local format defined in
//! `packages/schema/src/raw.ts`); everything downstream (exclude, redact, buffer, upload)
//! is platform-independent and lives in the rest of this crate.
//!
//! # Adding a platform
//!
//! 1. Create `capture/<platform>.rs` with a struct implementing [`CaptureSource`], gated by
//!    `#[cfg(target_os = "...")]`, plus a non-gated stub that returns
//!    [`CaptureError::Unsupported`] elsewhere (see `windows.rs`).
//! 2. Emit only these samples: `Focus` when the frontmost app or window title/URL changes,
//!    `Ax` with a capped digest of visible static text (never the value of editable or
//!    secure fields), `Clipboard` with a coarse content kind only (never read the data),
//!    `IdleStart`/`IdleEnd` from the OS last-input timer. No screenshots, audio or keys.
//! 3. Report private/incognito windows with `private: true` whenever detectable.
//! 4. Wire it into [`platform_source`] and add the platform to the README table.
//!
//! Sources must not filter or redact themselves (the pipeline owns that), but they must
//! not *collect* anything beyond the fields above.

use std::time::Duration;

use crate::model::{Exclusions, Platform, RawSample};

pub mod simulated;
pub mod windows;

#[cfg(target_os = "macos")]
pub mod macos;

pub use simulated::{SimulatedOptions, SimulatedSource, TimeShift};

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error("unsupported platform for real capture ({0}); use simulated mode (tracer-sim --raw <file>)")]
    Unsupported(&'static str),
    #[error("permission required: {0}")]
    PermissionDenied(String),
    #[error("capture I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("bad sample at line {line}: {message}")]
    BadSample { line: usize, message: String },
    #[error("{0}")]
    Other(String),
}

/// Result of one poll.
#[derive(Debug)]
pub enum SourcePoll {
    /// New samples, oldest first.
    Samples(Vec<RawSample>),
    /// Nothing new within the wait budget.
    Idle,
    /// The source has nothing more to give (end of a replay file).
    Exhausted,
}

/// A polling/event-driven capture source.
///
/// `next_samples` may block for at most `max_wait` (so the caller can interleave uploads,
/// config polls and pause/resume), then returns whatever was observed. Real sources poll
/// the OS on an internal cadence and emit samples only on change; the simulated source
/// replays a file in (optionally accelerated) real time.
pub trait CaptureSource: Send {
    fn platform(&self) -> Platform;
    fn next_samples(&mut self, max_wait: Duration) -> Result<SourcePoll, CaptureError>;
    /// Idle threshold from AgentConfig; sources that detect idle use it.
    fn set_idle_threshold(&mut self, _seconds: u32) {}
    /// Current exclusions, so a real source can avoid even *collecting* text from
    /// excluded/private windows (the pipeline still enforces them independently).
    fn set_exclusions(&mut self, _exclusions: &Exclusions) {}
}

/// The real capture source for this OS, or `Unsupported`.
pub fn platform_source(idle_threshold_seconds: u32) -> Result<Box<dyn CaptureSource>, CaptureError> {
    #[cfg(target_os = "macos")]
    {
        Ok(Box::new(macos::MacosSource::new(idle_threshold_seconds)?))
    }
    #[cfg(target_os = "windows")]
    {
        let _ = idle_threshold_seconds;
        Err(windows::WindowsSource::unsupported())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = idle_threshold_seconds;
        Err(CaptureError::Unsupported(std::env::consts::OS))
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_os = "macos"))]
    #[test]
    fn real_source_is_explicitly_unsupported_off_macos() {
        let err = super::platform_source(120).err().expect("must not fake a source");
        assert!(err.to_string().contains("use simulated mode"), "{err}");
    }
}

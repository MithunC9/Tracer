//! Replays a fixtures `raw.jsonl` (RawSample per line) through the real pipeline. This is
//! how Tracer is demoable on any OS and in CI. It is clearly labelled `platform: simulated`
//! in every upload.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};

use super::{CaptureError, CaptureSource, SourcePoll};
use crate::model::{Platform, RawSample};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeShift {
    /// Keep the timestamps in the file.
    None,
    /// Move the recording to "now":
    /// - with speed 0 (backfill): shift by whole days so the last sample lands on or before
    ///   now, as late as possible. Time of day is preserved, so "9am" stays 9am.
    /// - with speed > 0 (live replay): shift so the first sample is now.
    ToNow,
}

#[derive(Debug, Clone, Copy)]
pub struct SimulatedOptions {
    /// 0 = as fast as possible; N = N x real time (1 = real time).
    pub speed: f64,
    pub time_shift: TimeShift,
    /// Max samples returned per poll in as-fast-as-possible mode.
    pub chunk: usize,
}

impl Default for SimulatedOptions {
    fn default() -> Self {
        SimulatedOptions { speed: 0.0, time_shift: TimeShift::None, chunk: 1000 }
    }
}

pub struct SimulatedSource {
    samples: Vec<RawSample>,
    pos: usize,
    opts: SimulatedOptions,
    started: Option<Instant>,
    shift: chrono::Duration,
}

impl SimulatedSource {
    pub fn from_file(path: &Path, opts: SimulatedOptions) -> Result<Self, CaptureError> {
        let f = std::fs::File::open(path)?;
        let mut samples = Vec::new();
        for (i, line) in BufReader::new(f).lines().enumerate() {
            let line = line?;
            if line.trim().is_empty() {
                continue;
            }
            let s: RawSample = serde_json::from_str(&line)
                .map_err(|e| CaptureError::BadSample { line: i + 1, message: e.to_string() })?;
            samples.push(s);
        }
        Ok(Self::from_samples(samples, opts, Utc::now()))
    }

    pub fn from_samples(mut samples: Vec<RawSample>, opts: SimulatedOptions, now: DateTime<Utc>) -> Self {
        samples.sort_by_key(|s| s.t());
        let shift = match (opts.time_shift, samples.first(), samples.last()) {
            (TimeShift::ToNow, Some(first), Some(last)) => {
                if opts.speed > 0.0 {
                    now - first.t()
                } else {
                    let days = (now - last.t()).num_days();
                    let mut shift = chrono::Duration::days(days);
                    if last.t() + shift > now {
                        shift -= chrono::Duration::days(1);
                    }
                    shift
                }
            }
            _ => chrono::Duration::zero(),
        };
        if !shift.is_zero() {
            for s in &mut samples {
                s.shift(shift);
            }
        }
        SimulatedSource { samples, pos: 0, opts, started: None, shift }
    }

    pub fn len(&self) -> usize {
        self.samples.len()
    }

    pub fn is_empty(&self) -> bool {
        self.samples.is_empty()
    }

    pub fn remaining(&self) -> usize {
        self.samples.len() - self.pos
    }

    /// The offset applied by `--time-shift-to-now`.
    pub fn shift(&self) -> chrono::Duration {
        self.shift
    }

    pub fn first_ts(&self) -> Option<DateTime<Utc>> {
        self.samples.first().map(RawSample::t)
    }

    pub fn last_ts(&self) -> Option<DateTime<Utc>> {
        self.samples.last().map(RawSample::t)
    }
}

impl CaptureSource for SimulatedSource {
    fn platform(&self) -> Platform {
        Platform::Simulated
    }

    fn next_samples(&mut self, max_wait: Duration) -> Result<SourcePoll, CaptureError> {
        if self.pos >= self.samples.len() {
            return Ok(SourcePoll::Exhausted);
        }
        if self.opts.speed <= 0.0 {
            let end = (self.pos + self.opts.chunk.max(1)).min(self.samples.len());
            let out = self.samples[self.pos..end].to_vec();
            self.pos = end;
            return Ok(SourcePoll::Samples(out));
        }
        let started = *self.started.get_or_insert_with(Instant::now);
        let origin = self.samples[0].t();
        let due = |s: &RawSample| {
            let offset = (s.t() - origin).to_std().unwrap_or_default();
            started + offset.div_f64(self.opts.speed)
        };
        let next_due = due(&self.samples[self.pos]);
        let now = Instant::now();
        if next_due > now {
            let wait = (next_due - now).min(max_wait);
            std::thread::sleep(wait);
        }
        let now = Instant::now();
        let mut out = Vec::new();
        while self.pos < self.samples.len() && due(&self.samples[self.pos]) <= now {
            out.push(self.samples[self.pos].clone());
            self.pos += 1;
        }
        Ok(if out.is_empty() { SourcePoll::Idle } else { SourcePoll::Samples(out) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(t: &str) -> RawSample {
        RawSample::IdleEnd { t: DateTime::parse_from_rfc3339(t).unwrap().with_timezone(&Utc) }
    }

    #[test]
    fn backfill_shift_keeps_time_of_day() {
        let now = DateTime::parse_from_rfc3339("2026-11-20T13:00:00Z").unwrap().with_timezone(&Utc);
        let src = SimulatedSource::from_samples(
            vec![s("2026-03-02T17:30:00Z"), s("2026-03-01T09:00:00Z")],
            SimulatedOptions { time_shift: TimeShift::ToNow, ..Default::default() },
            now,
        );
        // last sample 17:30 would be in the future today, so it lands yesterday
        assert_eq!(src.last_ts().unwrap().to_rfc3339(), "2026-11-19T17:30:00+00:00");
        assert_eq!(src.first_ts().unwrap().to_rfc3339(), "2026-11-18T09:00:00+00:00");
    }

    #[test]
    fn live_shift_starts_now_and_paces() {
        let now = Utc::now();
        let mut src = SimulatedSource::from_samples(
            vec![s("2026-03-01T09:00:00Z"), s("2026-03-01T09:00:01Z")],
            SimulatedOptions { speed: 10.0, time_shift: TimeShift::ToNow, chunk: 10 },
            now,
        );
        assert_eq!(src.first_ts(), Some(now));
        let t0 = Instant::now();
        let mut got = 0;
        while got < 2 {
            match src.next_samples(Duration::from_millis(50)).unwrap() {
                SourcePoll::Samples(v) => got += v.len(),
                SourcePoll::Idle => {}
                SourcePoll::Exhausted => break,
            }
        }
        let el = t0.elapsed();
        assert!(el >= Duration::from_millis(90), "1s at 10x is ~100ms, took {el:?}");
        assert!(matches!(src.next_samples(Duration::ZERO).unwrap(), SourcePoll::Exhausted));
    }

    #[test]
    fn fast_mode_chunks() {
        let mut src = SimulatedSource::from_samples(
            (0..25).map(|i| s(&format!("2026-03-01T09:00:{i:02}Z"))).collect(),
            SimulatedOptions { chunk: 10, ..Default::default() },
            Utc::now(),
        );
        let mut sizes = vec![];
        while let SourcePoll::Samples(v) = src.next_samples(Duration::ZERO).unwrap() {
            sizes.push(v.len());
        }
        assert_eq!(sizes, vec![10, 10, 5]);
    }
}

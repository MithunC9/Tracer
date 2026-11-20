//! tracer-sim: replay a fixtures raw.jsonl through the REAL agent path
//! (simulated source -> exclude -> redact -> encrypted buffer -> uploader).
//!
//! Examples:
//!   tracer-sim --raw packages/fixtures/data/bookkeeper/raw.jsonl --dry-run --out events.json
//!   tracer-sim --api http://localhost:4000 --pair-code ABCD-EFGH --device-token-file .tracer/token \
//!              --raw packages/fixtures/data/bookkeeper/raw.jsonl --time-shift-to-now
//!   tracer-sim --api http://localhost:4000 --device-token-file .tracer/token --raw ... --speed 60
//!
//! Exit codes: 0 ok; 1 error; 2 usage; 3 server does not allow capture; 4 events left pending.

use std::io::Write;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Duration;

use chrono::{DateTime, Utc};
use clap::Parser;

use tracer_core::agent::{Agent, Mode};
use tracer_core::api::{ApiClient, AGENT_VERSION};
use tracer_core::buffer::Store;
use tracer_core::capture::{CaptureSource, SimulatedOptions, SimulatedSource, SourcePoll, TimeShift};
use tracer_core::model::{Exclusions, Platform};
use tracer_core::pairing;
use tracer_core::secrets::{write_private_file, FileSecretStore, SecretStore};

#[derive(Parser, Debug)]
#[command(name = "tracer-sim", version, about = "Replay a fixtures raw.jsonl through the real Tracer agent path.")]
struct Args {
    /// RawSample JSONL file (packages/fixtures/data/<persona>/raw.jsonl).
    #[arg(long, value_name = "FILE")]
    raw: PathBuf,

    /// API base URL, e.g. http://localhost:4000 (plain http only to localhost).
    #[arg(long, value_name = "URL", required_unless_present = "dry_run")]
    api: Option<String>,

    /// Pair with this code (XXXX-XXXX) before replaying.
    #[arg(long, value_name = "CODE", conflicts_with = "dry_run")]
    pair_code: Option<String>,

    /// Read the device token from this file; with --pair-code, write the new token here (0600).
    #[arg(long, value_name = "FILE", conflicts_with = "dry_run")]
    device_token_file: Option<PathBuf>,

    /// Device name sent when pairing.
    #[arg(long, default_value = "tracer-sim")]
    device_name: String,

    /// Replay speed: 0 = as fast as possible, N = N x real time (1 = real time).
    #[arg(long, default_value_t = 0.0)]
    speed: f64,

    /// Move timestamps to now. Speed 0: shift by whole days so the replay ends today (time
    /// of day preserved). Speed > 0: the first sample happens now and timestamps are
    /// compressed by the speed, so they follow the wall clock.
    #[arg(long)]
    time_shift_to_now: bool,

    /// Buffer + secrets directory. Default: a fresh temporary directory (deleted on exit).
    #[arg(long, value_name = "DIR")]
    data_dir: Option<PathBuf>,

    /// Do not contact any server; write the ActivityEvents that WOULD be sent.
    #[arg(long)]
    dry_run: bool,

    /// Dry-run output file (JSON array). "-" = stdout.
    #[arg(long, value_name = "FILE", default_value = "-", requires = "dry_run")]
    out: String,

    /// Exclusions JSON (Exclusions shape) for dry-run. With --api the server's config wins.
    #[arg(long, value_name = "FILE")]
    exclusions: Option<PathBuf>,

    /// Dry-run only: pretend the audit window ends at this RFC 3339 time (tests auto-stop).
    #[arg(long, value_name = "TS", requires = "dry_run")]
    capture_until: Option<String>,

    /// Upload every N seconds of wall time (default: AgentConfig.uploadIntervalSeconds;
    /// with --speed 0 everything is uploaded at the end anyway).
    #[arg(long, value_name = "SECS")]
    upload_interval: Option<u64>,

    /// Give up after this many consecutive failed uploads at the end.
    #[arg(long, default_value_t = 8)]
    max_failures: u32,
}

fn main() -> ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).target(env_logger::Target::Stderr).init();
    let args = Args::parse();
    match run(args) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("tracer-sim: {e}");
            ExitCode::from(1)
        }
    }
}

type BoxErr = Box<dyn std::error::Error>;

fn run(args: Args) -> Result<ExitCode, BoxErr> {
    if args.speed < 0.0 || !args.speed.is_finite() {
        eprintln!("--speed must be 0 or a positive number");
        return Ok(ExitCode::from(2));
    }
    let _tmp;
    let data_dir = match &args.data_dir {
        Some(d) => d.clone(),
        None => {
            _tmp = TempDir::new()?;
            _tmp.0.clone()
        }
    };
    std::fs::create_dir_all(&data_dir)?;
    let secrets = FileSecretStore::new(data_dir.join("secrets"))?;
    let store = Store::open_in(&data_dir, &secrets)?;

    let mut source = SimulatedSource::from_file(
        &args.raw,
        SimulatedOptions {
            speed: args.speed,
            time_shift: if args.time_shift_to_now { TimeShift::ToNow } else { TimeShift::None },
            chunk: 1000,
        },
    )?;
    let (Some(first_ts), Some(last_ts)) = (source.first_ts(), source.last_ts()) else {
        eprintln!("{} has no samples", args.raw.display());
        return Ok(ExitCode::from(2));
    };
    log::info!(
        "replaying {} samples {} .. {} (shift {}h, speed {})",
        source.len(),
        first_ts,
        last_ts,
        source.shift().num_hours(),
        args.speed
    );
    let start_ts = first_ts - chrono::Duration::milliseconds(1);

    let api = match &args.api {
        Some(base) if !args.dry_run => Some(connect(base, &args, &secrets)?),
        _ => None,
    };
    let online = api.is_some();
    let mut agent = Agent::new(store, api, Platform::Simulated, AGENT_VERSION)?;
    agent.upload_interval_override = args.upload_interval.map(Duration::from_secs);
    if !args.time_shift_to_now {
        // Historical timestamps: judge the window by sample time only.
        agent.use_wall_clock = false;
    }
    if let Some(path) = &args.exclusions {
        let ex: Exclusions = serde_json::from_slice(&std::fs::read(path)?)?;
        agent.set_exclusions(ex)?;
    }

    if online {
        agent.poll_config(start_ts)?;
        if agent.mode() != Mode::Capturing {
            eprintln!(
                "server does not allow capture for this device right now (mode {:?}: {}). Create/resume an audit first.",
                agent.mode(),
                agent.state().stop_reason.clone().unwrap_or_default()
            );
            return Ok(ExitCode::from(3));
        }
    } else {
        if let Some(until) = &args.capture_until {
            let until = DateTime::parse_from_rfc3339(until)?.with_timezone(&Utc);
            agent.use_wall_clock = false;
            agent.set_capture_window(Some(start_ts), Some(until))?;
        }
        agent.start(start_ts)?;
    }

    let mut last_seen = start_ts;
    loop {
        match source.next_samples(Duration::from_millis(500))? {
            SourcePoll::Samples(v) => {
                if let Some(l) = v.last() {
                    last_seen = l.t();
                }
                agent.ingest(&v)?;
            }
            SourcePoll::Idle => {}
            SourcePoll::Exhausted => break,
        }
        if online && args.speed > 0.0 {
            agent.tick(last_seen)?;
        }
        if matches!(agent.mode(), Mode::AutoStopped | Mode::Stopped) {
            log::info!("capture ended early: {}", agent.state().stop_reason.clone().unwrap_or_default());
            break;
        }
    }
    if matches!(agent.mode(), Mode::Capturing | Mode::Paused) {
        agent.stop(last_seen + chrono::Duration::milliseconds(1), "replay finished")?;
    }

    let stats = agent.stats().clone();
    if args.dry_run {
        let events = agent.store().pending_events(usize::MAX >> 1)?;
        let json = serde_json::to_string_pretty(&events)?;
        if args.out == "-" {
            std::io::stdout().write_all(json.as_bytes())?;
            println!();
        } else {
            write_private_file(std::path::Path::new(&args.out), json.as_bytes())?;
        }
        eprintln!(
            "{}",
            serde_json::json!({ "mode": "dry-run", "pipeline": stats, "events": events.len(), "finalState": agent.mode() })
        );
        return Ok(ExitCode::SUCCESS);
    }

    let pending = agent.flush(last_seen, args.max_failures)?;
    let summary = serde_json::json!({
        "mode": "upload",
        "pipeline": stats,
        "upload": agent.upload_totals,
        "pending": pending,
        "finalState": agent.mode(),
        "stopReason": agent.state().stop_reason,
    });
    println!("{summary}");
    Ok(if pending > 0 { ExitCode::from(4) } else { ExitCode::SUCCESS })
}

fn connect(base: &str, args: &Args, secrets: &dyn SecretStore) -> Result<ApiClient, BoxErr> {
    let mut api = ApiClient::new(base, None)?;
    if let Some(code) = &args.pair_code {
        let resp = pairing::pair(&mut api, secrets, code, &args.device_name, Platform::Simulated)?;
        log::info!("paired as device {}", resp.device_id);
        if let Some(f) = &args.device_token_file {
            write_private_file(f, resp.device_token.as_bytes())?;
        }
        return Ok(api);
    }
    let token = match &args.device_token_file {
        Some(f) => Some(std::fs::read_to_string(f).map_err(|e| format!("reading {}: {e}", f.display()))?.trim().to_string()),
        None => pairing::load_token(secrets)?,
    };
    match token.filter(|t| !t.is_empty()) {
        Some(t) => {
            api.set_token(Some(t));
            Ok(api)
        }
        None => Err("not paired: pass --pair-code or --device-token-file".into()),
    }
}

/// Minimal temp dir (removed on drop) so the binary needs no extra dependency.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> std::io::Result<Self> {
        let p = std::env::temp_dir().join(format!("tracer-sim-{}-{}", std::process::id(), uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&p)?;
        Ok(TempDir(p))
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

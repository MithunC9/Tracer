//! Uploader idempotency/backoff, auto-stop, pause, revocation, encryption at rest and the
//! online tracer-sim path, all against a local mock HTTP server.

mod common;

use std::collections::HashSet;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use common::{accept, agent_config, MockServer, Response};
use serde_json::json;
use tracer_core::agent::{Agent, Mode};
use tracer_core::api::ApiClient;
use tracer_core::buffer::{EventStatus, Store, DB_FILE};
use tracer_core::capture::{CaptureSource, SimulatedOptions, SimulatedSource, SourcePoll};
use tracer_core::model::{Platform, RawSample};
use tracer_core::secrets::FileSecretStore;
use tracer_core::uploader::{Backoff, Uploader};

fn samples() -> Vec<RawSample> {
    let mut src = SimulatedSource::from_file(&common::sample_raw_path(), SimulatedOptions::default()).unwrap();
    let mut out = vec![];
    while let SourcePoll::Samples(v) = src.next_samples(Duration::ZERO).unwrap() {
        out.extend(v);
    }
    out
}

fn ts(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
}

fn agent(dir: &Path, base: Option<&str>) -> Agent {
    let secrets = FileSecretStore::new(dir.join("secrets")).unwrap();
    let store = Store::open_in(dir, &secrets).unwrap();
    let api = base.map(|b| ApiClient::new(b, Some("device-token-123".into())).unwrap());
    let mut a = Agent::new(store, api, Platform::Simulated, "test/0.1")
        .unwrap()
        .with_uploader(Uploader::new(Platform::Simulated, "test/0.1"));
    a.uploader_mut().backoff = Backoff::new(Duration::from_millis(5), Duration::from_millis(40));
    a.use_wall_clock = false;
    a
}

/// Server that records batch ids and returns duplicates for replays, like the real API.
fn idempotent_server(fail_first: usize) -> (MockServer, Arc<Mutex<HashSet<String>>>) {
    let seen: Arc<Mutex<HashSet<String>>> = Arc::default();
    let s2 = seen.clone();
    let ingests = AtomicUsize::new(0);
    let server = MockServer::start(move |req, _| match req.path.as_str() {
        "/v1/agent/config" => Response::json(200, agent_config(true, false, None)),
        "/v1/agent/events" => {
            if ingests.fetch_add(1, Ordering::SeqCst) < fail_first {
                return Response::json(503, json!({"error": {"code": "internal", "message": "down", "requestId": "r"}}));
            }
            let v = req.json();
            let n = v["events"].as_array().unwrap().len();
            let dup = !s2.lock().unwrap().insert(v["batchId"].as_str().unwrap().to_string());
            Response::json(
                202,
                json!({"batchId": v["batchId"], "accepted": if dup {0} else {n}, "duplicates": if dup {n} else {0},
                       "rejected": [], "captureAllowed": true, "captureUntil": null}),
            )
        }
        _ => Response::json(404, json!({})),
    });
    (server, seen)
}

#[test]
fn failed_upload_resends_same_batch_after_restart() {
    let (server, _) = idempotent_server(2);
    let dir = tempfile::tempdir().unwrap();
    {
        let mut a = agent(dir.path(), Some(&server.base));
        a.start(ts("2026-11-16T08:59:59Z")).unwrap();
        a.ingest(&samples()).unwrap();
        assert!(a.upload_now(Utc::now()).is_err(), "503 must surface");
        assert_eq!(a.uploader_mut().backoff.failures(), 1);
        // agent "crashes" here: dropped without acking
    }
    let mut a = agent(dir.path(), Some(&server.base));
    std::thread::sleep(Duration::from_millis(50));
    let _ = a.upload_now(Utc::now()); // second 503
    std::thread::sleep(Duration::from_millis(50));
    a.upload_now(Utc::now()).unwrap();
    let ingests = server.ingests();
    assert_eq!(ingests.len(), 3);
    let ids: Vec<_> = ingests.iter().map(|r| r.json()["batchId"].as_str().unwrap().to_string()).collect();
    assert!(ids.iter().all(|i| *i == ids[0]), "same batchId on every retry: {ids:?}");
    let ev_ids = |i: usize| ingests[i].json()["events"].as_array().unwrap().iter().map(|e| e["id"].clone()).collect::<Vec<_>>();
    assert_eq!(ev_ids(0), ev_ids(2), "same events on retry");
    assert_eq!(a.store().count(EventStatus::Pending).unwrap(), 0);
    let req = &ingests[2];
    assert_eq!(req.header("authorization"), Some("Bearer device-token-123"));
    let body = req.json();
    assert_eq!(body["platform"], "simulated");
    assert_eq!(body["agentVersion"], "test/0.1");
}

#[test]
fn replaying_an_acked_batch_is_a_duplicate_not_a_double_count() {
    let (server, _) = idempotent_server(0);
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), Some(&server.base));
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.ingest(&samples()).unwrap();
    a.upload_now(Utc::now()).unwrap();
    let first = server.ingests()[0].body.clone();
    // a network-level replay of the same request body
    let api = ApiClient::new(&server.base, Some("t".into())).unwrap();
    let r = api.ingest(first).unwrap();
    assert_eq!(r.accepted, 0);
    assert!(r.duplicates > 0);
}

#[test]
fn backoff_spacing_grows() {
    let (server, _) = idempotent_server(usize::MAX);
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), Some(&server.base));
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.ingest(&samples()).unwrap();
    let mut delays = vec![];
    for _ in 0..4 {
        let _ = a.upload_now(Utc::now());
        delays.push(a.uploader_mut().backoff.wait_remaining());
        // while backing off, no request is made
        let before = server.ingests().len();
        let _ = a.upload_now(Utc::now());
        assert_eq!(server.ingests().len(), before);
        std::thread::sleep(a.uploader_mut().backoff.wait_remaining() + Duration::from_millis(2));
    }
    assert_eq!(a.uploader_mut().backoff.failures(), 4);
    assert!(delays[3] >= Duration::from_millis(15), "capped exponential growth: {delays:?}");
    let pending = a.flush(Utc::now(), 3).unwrap();
    assert!(pending > 0, "flush gives up after max failures, data kept");
}

#[test]
fn oversized_batches_are_split() {
    let server = MockServer::start(|req, _| match req.path.as_str() {
        "/v1/agent/events" => {
            if req.json()["events"].as_array().unwrap().len() > 4 {
                Response::json(413, json!({"error": {"code": "payload_too_large", "message": "too big", "requestId": "r"}}))
            } else {
                accept(req, true, None)
            }
        }
        _ => Response::json(200, agent_config(true, false, None)),
    });
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), Some(&server.base));
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.ingest(&samples()).unwrap();
    let total = a.store().count(EventStatus::Pending).unwrap();
    a.flush(Utc::now(), 3).unwrap();
    assert_eq!(a.store().count(EventStatus::Pending).unwrap(), 0);
    let ok: Vec<_> = server.ingests().into_iter().filter(|r| r.json()["events"].as_array().unwrap().len() <= 4).collect();
    let sent: usize = ok.iter().map(|r| r.json()["events"].as_array().unwrap().len()).sum();
    assert_eq!(sent as u64, total);
}

#[test]
fn ingest_result_capture_not_allowed_auto_stops() {
    let server = MockServer::start(|req, _| match req.path.as_str() {
        "/v1/agent/events" => accept(req, false, Some("2026-11-16T09:30:00.000Z")),
        _ => Response::json(200, agent_config(false, false, Some("2026-11-16T09:30:00.000Z"))),
    });
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), Some(&server.base));
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    let s = samples();
    a.ingest(&s[..3]).unwrap();
    a.upload_now(ts("2026-11-16T09:00:31Z")).unwrap();
    assert_eq!(a.mode(), Mode::AutoStopped);
    // nothing more is captured, silently or otherwise
    let n = a.ingest(&s[3..]).unwrap();
    assert_eq!(n, 0);
    assert!(a.samples_dropped_not_capturing > 0);
    let pending = a.store().pending_events(100).unwrap();
    let last = serde_json::to_value(pending.last().unwrap()).unwrap();
    assert_eq!(last["state"], "auto_stopped");
    // and it does not restart for the same audit
    a.poll_config(Utc::now()).unwrap();
    assert!(!a.start(Utc::now()).unwrap());
    assert_eq!(a.mode(), Mode::AutoStopped);
}

#[test]
fn capture_until_passing_auto_stops_mid_stream() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), None);
    a.set_capture_window(None, Some(ts("2026-11-16T09:05:00Z"))).unwrap();
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.ingest(&samples()).unwrap();
    assert_eq!(a.mode(), Mode::AutoStopped);
    let evs = a.store().pending_events(1000).unwrap();
    assert!(evs.iter().all(|e| e.ts <= ts("2026-11-16T09:05:00Z")));
    assert_eq!(serde_json::to_value(evs.last().unwrap()).unwrap()["state"], "auto_stopped");
}

#[test]
fn pause_from_web_drops_samples_until_resume() {
    let paused = Arc::new(Mutex::new(true));
    let p2 = paused.clone();
    let server = MockServer::start(move |req, _| match req.path.as_str() {
        "/v1/agent/events" => accept(req, true, None),
        _ => {
            let p = *p2.lock().unwrap();
            Response::json(200, agent_config(!p, p, None))
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), Some(&server.base));
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.poll_config(ts("2026-11-16T09:00:00Z")).unwrap();
    assert_eq!(a.mode(), Mode::Paused);
    assert_eq!(a.ingest(&samples()).unwrap(), 0);
    *paused.lock().unwrap() = false;
    a.poll_config(ts("2026-11-16T10:00:00Z")).unwrap();
    assert_eq!(a.mode(), Mode::Capturing);
    let states: Vec<String> = a
        .store()
        .pending_events(100)
        .unwrap()
        .iter()
        .map(|e| serde_json::to_value(e).unwrap()["state"].as_str().unwrap_or("").to_string())
        .collect();
    assert_eq!(states, vec!["started", "paused", "resumed"]);
}

#[test]
fn revoked_device_stops_capture() {
    let server = MockServer::start(|_, _| {
        Response::json(401, json!({"error": {"code": "unauthorized", "message": "revoked", "requestId": "r"}}))
    });
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), Some(&server.base));
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.ingest(&samples()[..2]).unwrap();
    assert!(a.upload_now(Utc::now()).is_err());
    assert_eq!(a.mode(), Mode::Stopped);
    assert_eq!(a.state().stop_reason.as_deref(), Some("device token revoked"));
}

#[test]
fn sqlite_file_holds_no_plaintext() {
    let dir = tempfile::tempdir().unwrap();
    {
        let mut a = agent(dir.path(), None);
        a.start(ts("2026-11-16T08:59:59Z")).unwrap();
        a.ingest(&samples()).unwrap();
        assert!(a.store().count(EventStatus::Pending).unwrap() > 5);
    }
    let mut bytes = std::fs::read(dir.path().join(DB_FILE)).unwrap();
    if let Ok(wal) = std::fs::read(dir.path().join(format!("{DB_FILE}-wal"))) {
        bytes.extend(wal);
    }
    let hay = String::from_utf8_lossy(&bytes);
    for needle in ["Q3 invoices", "Invoices", "HubSpot", "#finance", "mail.google.com", "app.hubspot.com", "Microsoft Excel", "Slack"] {
        assert!(!hay.contains(needle), "{needle} found in plaintext in the buffer file");
    }
    // ...but it is all readable with the key
    let a = agent(dir.path(), None);
    let all = a.store().pending_events(1000).unwrap();
    assert!(all.iter().any(|e| serde_json::to_string(e).unwrap().contains("Q3 invoices")));
}

#[test]
fn delete_everything_wipes_local_data() {
    let dir = tempfile::tempdir().unwrap();
    let mut a = agent(dir.path(), None);
    a.start(ts("2026-11-16T08:59:59Z")).unwrap();
    a.ingest(&samples()).unwrap();
    a.delete_everything().unwrap();
    assert_eq!(a.store().count(EventStatus::Pending).unwrap(), 0);
    assert_eq!(a.mode(), Mode::Stopped);
}

#[test]
fn tracer_sim_pairs_and_uploads() {
    let server = MockServer::start(|req, _| match req.path.as_str() {
        "/v1/devices/pair" => {
            let v = req.json();
            assert_eq!(v["code"], "ABCD-EFGH");
            assert_eq!(v["platform"], "simulated");
            Response::json(201, json!({"deviceId": common::DEVICE_ID, "deviceToken": "tok-from-pairing"}))
        }
        "/v1/agent/config" => Response::json(200, agent_config(true, false, None)),
        "/v1/agent/events" => accept(req, true, None),
        _ => Response::json(404, json!({})),
    });
    let dir = tempfile::tempdir().unwrap();
    let token_file = dir.path().join("token");
    let out = Command::new(env!("CARGO_BIN_EXE_tracer-sim"))
        .args(["--api", &server.base, "--pair-code", "abcd efgh"])
        .arg("--device-token-file")
        .arg(&token_file)
        .arg("--raw")
        .arg(common::sample_raw_path())
        .arg("--data-dir")
        .arg(dir.path().join("data"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(std::fs::read_to_string(&token_file).unwrap(), "tok-from-pairing");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(&token_file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let summary: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(summary["pending"], 0);
    assert_eq!(summary["finalState"], "stopped");
    let ingests = server.ingests();
    assert!(!ingests.is_empty());
    assert!(ingests.iter().all(|r| r.header("authorization") == Some("Bearer tok-from-pairing")));
    let sent: usize = ingests.iter().map(|r| r.json()["events"].as_array().unwrap().len()).sum();
    assert_eq!(summary["upload"]["accepted"], sent);

    // second run reuses the token file (no pairing call)
    let before = server.requests().iter().filter(|r| r.path == "/v1/devices/pair").count();
    let out = Command::new(env!("CARGO_BIN_EXE_tracer-sim"))
        .args(["--api", &server.base])
        .arg("--device-token-file")
        .arg(&token_file)
        .arg("--raw")
        .arg(common::sample_raw_path())
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(server.requests().iter().filter(|r| r.path == "/v1/devices/pair").count(), before);
}

#[test]
fn tracer_sim_refuses_when_capture_not_allowed() {
    let server = MockServer::start(|_, _| Response::json(200, agent_config(false, false, None)));
    let dir = tempfile::tempdir().unwrap();
    let token_file = dir.path().join("token");
    std::fs::write(&token_file, "t").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_tracer-sim"))
        .args(["--api", &server.base])
        .arg("--device-token-file")
        .arg(&token_file)
        .arg("--raw")
        .arg(common::sample_raw_path())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(server.ingests().is_empty());
}

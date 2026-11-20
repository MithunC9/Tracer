//! The agent's output must match the Zod contract in packages/schema exactly.
//! 1. JSON Schema generated from Zod (src/contract/*.schema.json) — always runs.
//! 2. The Zod schema itself via node — runs when node and packages/schema/dist exist.
//!
//! Also drives the real `tracer-sim --dry-run` binary end-to-end.

mod common;

use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use tracer_core::model::limits;

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn schema(name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(manifest().join("src/contract").join(name)).unwrap()).unwrap()
}

fn dry_run(extra: &[&str]) -> Vec<Value> {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("events.json");
    let status = Command::new(env!("CARGO_BIN_EXE_tracer-sim"))
        .arg("--raw")
        .arg(common::sample_raw_path())
        .arg("--dry-run")
        .arg("--out")
        .arg(&out)
        .arg("--data-dir")
        .arg(dir.path().join("data"))
        .args(extra)
        .status()
        .unwrap();
    assert!(status.success());
    serde_json::from_str(&std::fs::read_to_string(out).unwrap()).unwrap()
}

#[test]
fn limits_match_schema_package() {
    let l = schema("limits.json");
    assert_eq!(l["maxEventsPerBatch"], limits::MAX_EVENTS_PER_BATCH);
    assert_eq!(l["maxBatchBytes"], limits::MAX_BATCH_BYTES);
    assert_eq!(l["maxWindowTitleChars"], limits::MAX_WINDOW_TITLE_CHARS);
    assert_eq!(l["maxDigestTextChars"], limits::MAX_DIGEST_TEXT_CHARS);
    assert_eq!(l["maxDigestItems"], limits::MAX_DIGEST_ITEMS);
    assert_eq!(l["maxDigestItemChars"], limits::MAX_DIGEST_ITEM_CHARS);
    assert_eq!(l["defaultUploadIntervalSeconds"], limits::DEFAULT_UPLOAD_INTERVAL_SECONDS);
    assert_eq!(l["idleThresholdSeconds"], limits::IDLE_THRESHOLD_SECONDS);
    assert_eq!(l["schemaVersion"], limits::SCHEMA_VERSION);
}

#[test]
fn dry_run_events_match_json_schema() {
    let events = dry_run(&[]);
    let validator = jsonschema::validator_for(&schema("activity-event.schema.json")).unwrap();
    for e in &events {
        let errs: Vec<String> = validator.iter_errors(e).map(|x| x.to_string()).collect();
        assert!(errs.is_empty(), "{e}\n{errs:?}");
    }
    let batch = serde_json::json!({
        "batchId": "6f1c1d64-3f0e-4a8e-9a43-0d5c2d0e9b11",
        "sentAt": "2026-11-20T09:00:00.000Z",
        "agentVersion": tracer_core::api::AGENT_VERSION,
        "platform": "simulated",
        "events": events,
    });
    let bv = jsonschema::validator_for(&schema("ingest-batch.schema.json")).unwrap();
    let errs: Vec<String> = bv.iter_errors(&batch).map(|x| x.to_string()).collect();
    assert!(errs.is_empty(), "{errs:?}");
}

#[test]
fn dry_run_content_is_minimal_and_redacted() {
    let events = dry_run(&[]);
    let text = serde_json::to_string(&events).unwrap();
    for forbidden in [
        "4111 1111",
        "billing@acme-corp.com",
        "jane.doe",
        "/mail/u/0",
        "FMfcgzQXJWDsKmzrNnq",
        "1Password",
        "Banking logins",
        "my-secret-vault-note",
        "Gift ideas",
        "google.com/search",
        "correct-horse-battery-staple",
        "chase",
        "Accounts overview",
        "/contacts/123456",
    ] {
        assert!(!text.contains(forbidden), "{forbidden} leaked");
    }
    let kinds: Vec<&str> = events.iter().map(|e| e["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds.first(), Some(&"capture_state"));
    assert_eq!(events[0]["state"], "started");
    assert_eq!(events.last().unwrap()["state"], "stopped");
    // 1Password then the private window form one excluded stretch; chase is a second one.
    let excluded = events.iter().filter(|e| e["state"] == "excluded_app_active").count();
    assert_eq!(excluded, 2, "1Password+private window is one stretch, chase is another");
    for e in events.iter().filter(|e| e["state"] == "excluded_app_active") {
        assert_eq!(e["reason"], Value::Null);
        assert!(e.get("app").is_none());
    }
    // ids unique UUIDv7, seq strictly increasing
    let ids: HashSet<&str> = events.iter().map(|e| e["id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), events.len());
    assert!(events.iter().all(|e| e["id"].as_str().unwrap().as_bytes()[14] == b'7'));
    let seqs: Vec<u64> = events.iter().map(|e| e["seq"].as_u64().unwrap()).collect();
    assert!(seqs.windows(2).all(|w| w[0] < w[1]));
    // app keys resolved
    let keys: Vec<&str> = events.iter().filter_map(|e| e["app"]["key"].as_str()).collect();
    for k in ["excel", "gmail", "hubspot", "slack", "other:com.example.widgetpro"] {
        assert!(keys.contains(&k), "{k} missing in {keys:?}");
    }
    let hubspot = events.iter().find(|e| e["app"]["key"] == "hubspot" && e["kind"] == "app_focus").unwrap();
    assert_eq!(hubspot["urlHost"], "app.hubspot.com");
    assert_eq!(hubspot["redactions"]["url_path"], 1);
    let secure = events.iter().find(|e| e["kind"] == "text_digest" && e["app"]["key"] == "browser").unwrap();
    assert_eq!(secure["digest"]["text"], "[REDACTED:password_field]");
}

#[test]
fn dry_run_auto_stops_at_window_end() {
    let events = dry_run(&["--capture-until", "2026-11-17T00:00:00Z"]);
    let last = events.last().unwrap();
    assert_eq!(last["kind"], "capture_state");
    assert_eq!(last["state"], "auto_stopped");
    assert_eq!(last["ts"], "2026-11-17T00:00:00.000Z");
    assert!(events.iter().all(|e| e["ts"].as_str().unwrap() <= "2026-11-17T00:00:00.000Z"), "nothing captured after the window");
    assert!(!events.iter().any(|e| e["state"] == "stopped"));
}

#[test]
fn dry_run_validates_against_zod_when_node_available() {
    let repo = manifest().join("../../..");
    let dist = repo.join("packages/schema/dist/index.js");
    if !dist.exists() || Command::new("node").arg("--version").output().is_err() {
        eprintln!("skipping zod validation: node or {} not available", dist.display());
        return;
    }
    let events = dry_run(&[]);
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("batch.json");
    let batch = serde_json::json!({
        "batchId": "6f1c1d64-3f0e-4a8e-9a43-0d5c2d0e9b11",
        "sentAt": "2026-11-20T09:00:00.000Z",
        "agentVersion": tracer_core::api::AGENT_VERSION,
        "platform": "simulated",
        "events": events,
    });
    std::fs::write(&file, batch.to_string()).unwrap();
    let script = format!(
        "const s = await import({dist:?}); const fs = await import('node:fs'); \
         const b = JSON.parse(fs.readFileSync({file:?}, 'utf8')); \
         const r = s.IngestBatch.safeParse(b); \
         if (!r.success) {{ console.error(JSON.stringify(r.error.issues.slice(0, 5))); process.exit(1); }} \
         const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v; \
         const out = JSON.stringify(canon(r.data.events)); const inp = JSON.stringify(canon(b.events)); \
         if (out !== inp) {{ console.error('zod changed the payload (unknown or defaulted keys)'); process.exit(1); }}",
        dist = format!("file://{}", dist.canonicalize().unwrap().display()),
        file = file.display().to_string(),
    );
    let out = Command::new("node").args(["--input-type=module", "-e", &script]).output().unwrap();
    assert!(out.status.success(), "zod rejected: {}", String::from_utf8_lossy(&out.stderr));
}

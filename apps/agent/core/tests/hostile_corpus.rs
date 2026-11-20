//! Hostile corpus: secrets that must never survive redaction, and benign look-alikes that
//! must. Runs our own corpus, plus `packages/fixtures/data/hostile-corpus.json` when present.
//! Every case is checked both through `redact()` and through the full pipeline (as a
//! window title and as accessibility text), on the serialized event JSON.

use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Deserialize;
use tracer_core::exclude::default_exclusions;
use tracer_core::model::{Exclusions, RawSample};
use tracer_core::pipeline::Pipeline;
use tracer_core::redact::redact;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    input: String,
    #[serde(default)]
    must_not_contain: Vec<String>,
    #[serde(default)]
    must_contain: Vec<String>,
}

/// Secret-shaped literals in `hostile_corpus.json` carry a `§` inside their prefix
/// (`sk_§live_…`, `gh§p_…`) so the repository never contains a string that secret
/// scanners / push protection treat as a credential. The marker is stripped at load time,
/// so the redactor sees the real shape.
const SPLIT_MARKER: char = '§';

fn unsplit(s: &str) -> String {
    s.replace(SPLIT_MARKER, "")
}

fn load(path: &Path) -> Vec<Case> {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let cases: Vec<Case> = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    cases
        .into_iter()
        .map(|c| Case {
            input: unsplit(&c.input),
            must_not_contain: c.must_not_contain.iter().map(|s| unsplit(s)).collect(),
            must_contain: c.must_contain.iter().map(|s| unsplit(s)).collect(),
        })
        .collect()
}

/// Exclusions that never fire, so redaction (not exclusion) is what is under test.
fn no_exclusions() -> Exclusions {
    Exclusions { apps: vec![], domains: vec![], title_keywords: vec![], private_browsing: true }
}

fn check(cases: &[Case], source: &str) -> Vec<String> {
    let mut failures = Vec::new();
    let mut p = Pipeline::new(no_exclusions(), 0);
    for (i, c) in cases.iter().enumerate() {
        let out = redact(&c.input).text;
        let focus = p.process(&RawSample::Focus {
            t: Utc::now(),
            bundle_id: "com.microsoft.Word".into(),
            app_name: "Word".into(),
            title: Some(c.input.clone()),
            url: None,
            private: false,
        });
        let ax = p.process(&RawSample::Ax {
            t: Utc::now(),
            bundle_id: "com.microsoft.Word".into(),
            app_name: "Word".into(),
            headings: vec![c.input.clone()],
            labels: vec![],
            text: c.input.clone(),
            secure_field: false,
        });
        let json = serde_json::to_string(&(focus, ax)).unwrap();
        for bad in &c.must_not_contain {
            if bad.is_empty() {
                continue;
            }
            if out.contains(bad.as_str()) {
                failures.push(format!("[{source} #{i}] {:?} -> {:?} still contains {:?}", c.input, out, bad));
            }
            let escaped = serde_json::to_string(bad).unwrap();
            if json.contains(escaped.trim_matches('"')) {
                failures.push(format!("[{source} #{i}] pipeline JSON still contains {:?}", bad));
            }
        }
        for good in &c.must_contain {
            if !out.contains(good.as_str()) {
                failures.push(format!("[{source} #{i}] {:?} -> {:?} lost benign {:?}", c.input, out, good));
            }
        }
    }
    failures
}

#[test]
fn own_hostile_corpus() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/hostile_corpus.json");
    let cases = load(&path);
    assert!(cases.len() >= 60, "corpus has {} cases", cases.len());
    assert!(cases.iter().filter(|c| c.must_not_contain.is_empty()).count() >= 15, "need benign look-alikes");
    let failures = check(&cases, "core");
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn fixtures_hostile_corpus_if_present() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../packages/fixtures/data/hostile-corpus.json");
    if !path.exists() {
        eprintln!("skipping: {} not found", path.display());
        return;
    }
    let failures = check(&load(&path), "fixtures");
    assert!(failures.is_empty(), "{} failures:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn default_exclusions_still_hide_password_titles() {
    // With real defaults, a title mentioning "password" is excluded outright.
    let mut p = Pipeline::new(default_exclusions(), 0);
    let ev = p.process(&RawSample::Focus {
        t: Utc::now(),
        bundle_id: "com.google.Chrome".into(),
        app_name: "Chrome".into(),
        title: Some("Reset password for jane@x.com".into()),
        url: Some("https://accounts.example.com/reset?u=jane".into()),
        private: false,
    });
    let json = serde_json::to_string(&ev).unwrap();
    assert!(json.contains("excluded_app_active"));
    assert!(!json.contains("jane") && !json.contains("example.com"));
}

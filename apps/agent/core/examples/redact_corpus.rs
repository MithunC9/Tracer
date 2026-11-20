//! Prints redaction output for every hostile-corpus case: `cargo run --example redact_corpus`.
fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/hostile_corpus.json");
    let cases: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    for c in cases {
        let input = c["input"].as_str().unwrap().replace('§', ""); // see tests/hostile_corpus.rs
        let r = tracer_core::redact::redact(&input);
        println!("{:?}\n  -> {:?}", input, r.text);
    }
}

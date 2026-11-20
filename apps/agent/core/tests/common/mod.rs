//! Tiny blocking HTTP/1.1 mock server for agent tests (no extra dependencies).
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Debug, Clone)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).expect("json body")
    }
}

pub struct Response {
    pub status: u16,
    pub body: String,
}

impl Response {
    pub fn json(status: u16, v: serde_json::Value) -> Self {
        Response { status, body: v.to_string() }
    }
}

pub type Handler = dyn Fn(&Request, usize) -> Response + Send + Sync;

pub struct MockServer {
    pub base: String,
    pub requests: Arc<Mutex<Vec<Request>>>,
}

impl MockServer {
    /// `handler(request, index_of_request)`.
    pub fn start(handler: impl Fn(&Request, usize) -> Response + Send + Sync + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let requests: Arc<Mutex<Vec<Request>>> = Arc::default();
        let reqs = requests.clone();
        let handler: Arc<Handler> = Arc::new(handler);
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let reqs = reqs.clone();
                let handler = handler.clone();
                thread::spawn(move || serve(stream, &reqs, &*handler));
            }
        });
        MockServer { base, requests }
    }

    pub fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }

    pub fn ingests(&self) -> Vec<Request> {
        self.requests().into_iter().filter(|r| r.path == "/v1/agent/events").collect()
    }
}

fn serve(stream: TcpStream, reqs: &Mutex<Vec<Request>>, handler: &Handler) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            return;
        }
        let mut parts = line.split_whitespace();
        let method = parts.next().unwrap_or("").to_string();
        let path = parts.next().unwrap_or("").to_string();
        let mut headers = Vec::new();
        loop {
            let mut h = String::new();
            reader.read_line(&mut h).unwrap();
            let h = h.trim_end();
            if h.is_empty() {
                break;
            }
            if let Some((k, v)) = h.split_once(':') {
                headers.push((k.trim().to_string(), v.trim().to_string()));
            }
        }
        let len: usize = headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
            .and_then(|(_, v)| v.parse().ok())
            .unwrap_or(0);
        let mut body = vec![0; len];
        reader.read_exact(&mut body).unwrap();
        let req = Request { method, path, headers, body };
        let idx = {
            let mut r = reqs.lock().unwrap();
            r.push(req.clone());
            r.len() - 1
        };
        let resp = handler(&req, idx);
        let mut s = &stream;
        let _ = write!(
            s,
            "HTTP/1.1 {} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            resp.status,
            resp.body.len(),
            resp.body
        );
        let _ = s.flush();
    }
}

pub const DEVICE_ID: &str = "0190c6a0-0000-7000-8000-0000000000d1";
pub const AUDIT_ID: &str = "0190c6a0-0000-7000-8000-0000000000a1";

pub fn agent_config(capture_allowed: bool, paused: bool, until: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "deviceId": DEVICE_ID,
        "auditId": AUDIT_ID,
        "captureAllowed": capture_allowed,
        "captureFrom": "2026-01-01T00:00:00.000Z",
        "captureUntil": until,
        "paused": paused,
        "exclusions": {
            "apps": ["password_manager", "bank_portal", "health_portal"],
            "domains": ["chase.com"],
            "titleKeywords": ["password", "bank", "therapy"],
            "privateBrowsing": true
        },
        "uploadIntervalSeconds": 30,
        "idleThresholdSeconds": 120
    })
}

/// Accept every event of a batch.
pub fn accept(req: &Request, capture_allowed: bool, until: Option<&str>) -> Response {
    let v = req.json();
    let n = v["events"].as_array().map(|a| a.len()).unwrap_or(0);
    Response::json(
        202,
        serde_json::json!({
            "batchId": v["batchId"],
            "accepted": n,
            "duplicates": 0,
            "rejected": [],
            "captureAllowed": capture_allowed,
            "captureUntil": until
        }),
    )
}

pub fn sample_raw_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/sample.raw.jsonl")
}

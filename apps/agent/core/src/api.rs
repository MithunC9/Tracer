//! HTTPS client for the three agent endpoints in `packages/schema/src/routes.ts`:
//! `POST /v1/devices/pair`, `GET /v1/agent/config`, `POST /v1/agent/events`.
//! reqwest (blocking) with rustls; no OpenSSL.

use std::time::Duration;

use crate::model::{AgentConfig, ApiErrorEnvelope, IngestResult, PairDeviceRequest, PairDeviceResponse};

pub const AGENT_VERSION: &str = concat!("tracer-agent/", env!("CARGO_PKG_VERSION"));

#[derive(Debug, Clone, thiserror::Error)]
pub enum ApiError {
    #[error("network: {0}")]
    Network(String),
    #[error("HTTP {status} {code}: {message}")]
    Http { status: u16, code: String, message: String },
    #[error("unexpected response: {0}")]
    Decode(String),
    #[error("not paired: no device token")]
    NotPaired,
}

impl ApiError {
    pub fn status(&self) -> Option<u16> {
        match self {
            ApiError::Http { status, .. } => Some(*status),
            _ => None,
        }
    }
    pub fn code(&self) -> Option<&str> {
        match self {
            ApiError::Http { code, .. } => Some(code),
            _ => None,
        }
    }
    /// Retrying later may succeed (network, 5xx, 429).
    pub fn is_transient(&self) -> bool {
        match self {
            ApiError::Network(_) => true,
            ApiError::Http { status, .. } => *status >= 500 || *status == 429 || *status == 408,
            _ => false,
        }
    }
    /// Device token revoked or unknown.
    pub fn is_unauthorized(&self) -> bool {
        matches!(self.status(), Some(401) | Some(403))
    }
    /// The audit window has closed server-side.
    pub fn is_window_closed(&self) -> bool {
        self.code() == Some("audit_window_closed")
    }
}

#[derive(Clone)]
pub struct ApiClient {
    base: String,
    token: Option<String>,
    http: reqwest::blocking::Client,
}

impl std::fmt::Debug for ApiClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApiClient").field("base", &self.base).field("token", &self.token.as_ref().map(|_| "<redacted>")).finish()
    }
}

impl ApiClient {
    pub fn new(base: &str, token: Option<String>) -> Result<Self, ApiError> {
        let http = reqwest::blocking::Client::builder()
            .user_agent(AGENT_VERSION)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .https_only(!is_local(base))
            .build()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Ok(ApiClient { base: base.trim_end_matches('/').to_string(), token, http })
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn has_token(&self) -> bool {
        self.token.is_some()
    }

    pub fn set_token(&mut self, token: Option<String>) {
        self.token = token;
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    fn auth(&self, rb: reqwest::blocking::RequestBuilder) -> Result<reqwest::blocking::RequestBuilder, ApiError> {
        let t = self.token.as_ref().ok_or(ApiError::NotPaired)?;
        Ok(rb.bearer_auth(t))
    }

    fn handle<T: serde::de::DeserializeOwned>(resp: reqwest::blocking::Response) -> Result<T, ApiError> {
        let status = resp.status();
        let body = resp.bytes().map_err(|e| ApiError::Network(e.to_string()))?;
        if status.is_success() {
            return serde_json::from_slice(&body).map_err(|e| ApiError::Decode(e.to_string()));
        }
        let (code, message) = match serde_json::from_slice::<ApiErrorEnvelope>(&body) {
            Ok(env) => (env.error.code, env.error.message),
            Err(_) => ("unknown".to_string(), String::from_utf8_lossy(&body).chars().take(200).collect()),
        };
        Err(ApiError::Http { status: status.as_u16(), code, message })
    }

    pub fn pair(&self, req: &PairDeviceRequest) -> Result<PairDeviceResponse, ApiError> {
        let resp = self
            .http
            .post(self.url("/v1/devices/pair"))
            .json(req)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Self::handle(resp)
    }

    pub fn config(&self) -> Result<AgentConfig, ApiError> {
        let resp = self.auth(self.http.get(self.url("/v1/agent/config")))?.send().map_err(|e| ApiError::Network(e.to_string()))?;
        Self::handle(resp)
    }

    /// Body is a pre-serialized IngestBatch (so the caller controls the byte cap).
    pub fn ingest(&self, body: Vec<u8>) -> Result<IngestResult, ApiError> {
        let resp = self
            .auth(self.http.post(self.url("/v1/agent/events")))?
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .map_err(|e| ApiError::Network(e.to_string()))?;
        Self::handle(resp)
    }
}

/// Plain HTTP is only allowed to loopback (local dev and tests).
fn is_local(base: &str) -> bool {
    let rest = base.strip_prefix("http://").unwrap_or("");
    let host = rest.split(['/', ':']).next().unwrap_or("");
    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_http_only_to_loopback() {
        assert!(is_local("http://localhost:4000"));
        assert!(is_local("http://127.0.0.1:4000/"));
        assert!(!is_local("http://api.example.com"));
        assert!(!is_local("https://localhost"));
    }
}

//! Pairing (code -> device token) and AgentConfig polling.

use crate::api::{ApiClient, ApiError, AGENT_VERSION};
use crate::model::{AgentConfig, PairDeviceRequest, PairDeviceResponse, Platform};
use crate::secrets::{SecretError, SecretStore, DEVICE_TOKEN};

#[derive(Debug, thiserror::Error)]
pub enum PairError {
    #[error("pairing code must look like XXXX-XXXX (Crockford base32)")]
    BadCode,
    #[error(transparent)]
    Api(#[from] ApiError),
    #[error(transparent)]
    Secret(#[from] SecretError),
}

/// Normalize user input to the `XXXX-XXXX` Crockford form the API expects
/// (uppercase; I/L -> 1, O -> 0; spaces and dashes ignored).
pub fn normalize_code(input: &str) -> Result<String, PairError> {
    let chars: Vec<char> = input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| match c.to_ascii_uppercase() {
            'I' | 'L' => '1',
            'O' => '0',
            c => c,
        })
        .collect();
    let ok = chars.len() == 8 && chars.iter().all(|c| c.is_ascii_digit() || (c.is_ascii_uppercase() && !matches!(c, 'I' | 'L' | 'O' | 'U')));
    if !ok {
        return Err(PairError::BadCode);
    }
    let s: String = chars.into_iter().collect();
    Ok(format!("{}-{}", &s[..4], &s[4..]))
}

/// Exchange a pairing code for a device token and store it in `secrets`.
pub fn pair(
    api: &mut ApiClient,
    secrets: &dyn SecretStore,
    code: &str,
    device_name: &str,
    platform: Platform,
) -> Result<PairDeviceResponse, PairError> {
    let code = normalize_code(code)?;
    let name: String = device_name.chars().take(80).collect();
    let resp = api.pair(&PairDeviceRequest {
        code,
        device_name: if name.trim().is_empty() { "Tracer device".into() } else { name },
        platform,
        agent_version: AGENT_VERSION.chars().take(40).collect(),
    })?;
    secrets.set(DEVICE_TOKEN, resp.device_token.as_bytes())?;
    api.set_token(Some(resp.device_token.clone()));
    Ok(resp)
}

pub fn load_token(secrets: &dyn SecretStore) -> Result<Option<String>, SecretError> {
    Ok(secrets.get(DEVICE_TOKEN)?.and_then(|b| String::from_utf8(b).ok()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

pub fn fetch_config(api: &ApiClient) -> Result<AgentConfig, ApiError> {
    api.config()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes() {
        assert_eq!(normalize_code("abcd-efgh").unwrap(), "ABCD-EFGH");
        assert_eq!(normalize_code(" 0o1l 2345 ").unwrap(), "0011-2345");
        assert!(normalize_code("ABCD-EFG").is_err());
        assert!(normalize_code("ABCD-EFGU").is_err());
    }
}

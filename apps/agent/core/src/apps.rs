//! AppKey resolution, ported from `packages/schema/src/apps.ts`.
//!
//! The table itself is not hand-copied: `src/contract/apps.json` is generated from the
//! schema package by `scripts/gen-contract.mjs` and embedded at compile time.

use std::sync::LazyLock;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDef {
    pub key: String,
    pub name: String,
    pub bundle_ids: Vec<String>,
    pub hosts: Vec<String>,
    pub excluded_by_default: bool,
}

pub static APPS: LazyLock<Vec<AppDef>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("contract/apps.json")).expect("embedded apps.json is valid")
});

pub const BROWSER_KEY: &str = "browser";

fn strip_www(s: &str) -> &str {
    s.strip_prefix("www.").unwrap_or(s)
}

/// Resolve a URL host (+ optional path) to an AppKey. Mirrors `appKeyForHost`.
pub fn app_key_for_host(host: &str, path: &str) -> Option<&'static str> {
    let host = host.to_ascii_lowercase();
    let h = strip_www(&host);
    let first_seg = path.split('/').find(|s| !s.is_empty()).unwrap_or("");
    for app in APPS.iter() {
        for ah in &app.hosts {
            let ah = strip_www(ah);
            // JS `split('/', 2)`: host and first path segment only.
            let mut parts = ah.split('/');
            let ah_host = parts.next().unwrap_or("");
            let ah_path = parts.next();
            let host_match = h == ah_host || h.ends_with(&format!(".{ah_host}"));
            if host_match && ah_path.is_none_or(|p| p == first_seg) {
                return Some(app.key.as_str());
            }
        }
    }
    None
}

/// Mirrors `appKeyForBundleId` (exact, case-sensitive match like the TS `includes`).
pub fn app_key_for_bundle_id(bundle_id: &str) -> Option<&'static str> {
    APPS.iter()
        .find(|a| a.bundle_ids.iter().any(|b| b == bundle_id))
        .map(|a| a.key.as_str())
}

pub fn is_browser_bundle(bundle_id: &str) -> bool {
    app_key_for_bundle_id(bundle_id) == Some(BROWSER_KEY)
}

pub fn app_def(key: &str) -> Option<&'static AppDef> {
    APPS.iter().find(|a| a.key == key)
}

/// `other:<slug>` for apps not in the table. Slug charset per the AppKey regex
/// `^other:[a-z0-9._-]{1,64}$`.
pub fn other_key(bundle_id: &str, app_name: &str) -> String {
    let source = if bundle_id.trim().is_empty() { app_name } else { bundle_id };
    let mut slug: String = source
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '-' })
        .collect();
    slug = slug.trim_matches('-').to_string();
    slug.truncate(64);
    if slug.is_empty() {
        slug = "unknown".into();
    }
    format!("other:{slug}")
}

/// Parsed browser URL, device-local only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UrlParts {
    pub host: String,
    /// Path + query + fragment is non-trivial (anything beyond `/`).
    pub has_path: bool,
    pub path: String,
}

/// Extract host and path from a URL. Returns None for non-network URLs (file:, about:,
/// data:, chrome:) so they never produce a host.
pub fn parse_url(raw: &str) -> Option<UrlParts> {
    let u = url::Url::parse(raw.trim()).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    let host = u.host_str()?.trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }
    let path = u.path().to_string();
    let has_path = path != "/" && !path.is_empty() || u.query().is_some() || u.fragment().is_some();
    Some(UrlParts { host, has_path, path })
}

/// Resolution result for a frontmost app/window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub key: String,
    pub url_host: Option<String>,
    /// The URL carried a path/query that was dropped (counts as a `url_path` redaction).
    pub dropped_path: bool,
}

/// Resolve an AppKey for a frontmost window: browser URL host first (host+path is used
/// on-device only), then bundle id, else `other:<slug>`.
pub fn resolve(bundle_id: &str, app_name: &str, url: Option<&str>) -> Resolved {
    let parsed = url.and_then(parse_url);
    let by_bundle = app_key_for_bundle_id(bundle_id);
    if let Some(p) = &parsed {
        let key = app_key_for_host(&p.host, &p.path)
            .map(str::to_string)
            .or_else(|| by_bundle.map(str::to_string))
            .unwrap_or_else(|| BROWSER_KEY.to_string());
        let mut host = p.host.clone();
        host.truncate(crate::model::limits::MAX_HOST_CHARS);
        return Resolved { key, url_host: Some(host), dropped_path: p.has_path };
    }
    let key = by_bundle.map(str::to_string).unwrap_or_else(|| other_key(bundle_id, app_name));
    Resolved { key, url_host: None, dropped_path: false }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_loads_with_unique_keys() {
        let mut keys: Vec<_> = APPS.iter().map(|a| a.key.clone()).collect();
        let n = keys.len();
        keys.sort();
        keys.dedup();
        assert_eq!(keys.len(), n);
        assert!(n >= 40);
    }

    #[test]
    fn host_resolution_matches_ts_contract_cases() {
        // packages/schema/test/contract.test.ts
        assert_eq!(app_key_for_host("docs.google.com", "/spreadsheets/d/abc"), Some("google_sheets"));
        assert_eq!(app_key_for_host("docs.google.com", "/document/d/abc"), Some("google_docs"));
        assert_eq!(app_key_for_host("www.figma.com", ""), Some("figma"));
        assert_eq!(app_key_for_host("eu1.app.hubspot.com", ""), Some("hubspot"));
        assert_eq!(app_key_for_host("docs.google.com", "/presentation/d/x"), None);
        assert_eq!(app_key_for_host("acme.atlassian.net", "/browse/X-1"), Some("jira"));
        assert_eq!(app_key_for_host("notgithub.com", ""), None);
    }

    #[test]
    fn bundle_and_other() {
        assert_eq!(app_key_for_bundle_id("com.microsoft.Excel"), Some("excel"));
        assert_eq!(app_key_for_bundle_id("com.microsoft.excel"), None);
        assert!(is_browser_bundle("com.google.Chrome"));
        assert_eq!(other_key("com.Example.My App!", "x"), "other:com.example.my-app");
        assert_eq!(other_key("", "  "), "other:unknown");
    }

    #[test]
    fn resolve_browser_url() {
        let r = resolve("com.google.Chrome", "Google Chrome", Some("https://docs.google.com/spreadsheets/d/abc/edit#gid=0"));
        assert_eq!(r.key, "google_sheets");
        assert_eq!(r.url_host.as_deref(), Some("docs.google.com"));
        assert!(r.dropped_path);
        let r = resolve("com.google.Chrome", "Google Chrome", Some("https://example.org/"));
        assert_eq!(r.key, "browser");
        assert!(!r.dropped_path);
        let r = resolve("com.google.Chrome", "Google Chrome", Some("chrome://settings"));
        assert_eq!(r.key, "browser");
        assert_eq!(r.url_host, None);
        let r = resolve("com.apple.Safari", "Safari", Some("https://user:pw@Mail.Google.com:443/mail?x=1"));
        assert_eq!(r.key, "gmail");
        assert_eq!(r.url_host.as_deref(), Some("mail.google.com"));
    }
}

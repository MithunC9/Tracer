//! Exclusion rules, an exact port of `isExcluded` / `DEFAULT_EXCLUSIONS` in
//! `packages/schema/src/exclusions.ts`. Applied before anything is redacted, stored or sent.

use crate::apps::APPS;
use crate::model::Exclusions;

/// Defaults derived from the app table, identical to the TS derivation. A test asserts
/// equality with the generated `src/contract/default-exclusions.json`.
pub fn default_exclusions() -> Exclusions {
    let excluded = || APPS.iter().filter(|a| a.excluded_by_default);
    Exclusions {
        apps: excluded().map(|a| a.key.clone()).collect(),
        domains: excluded().flat_map(|a| a.hosts.iter().cloned()).collect(),
        title_keywords: ["incognito", "private browsing", "inprivate", "password", "bank", "medical", "therapy"]
            .into_iter()
            .map(String::from)
            .collect(),
        private_browsing: true,
    }
}

impl Default for Exclusions {
    fn default() -> Self {
        default_exclusions()
    }
}

#[derive(Debug, Clone, Default)]
pub struct ExclusionTarget<'a> {
    pub app_key: &'a str,
    pub bundle_id: Option<&'a str>,
    pub url_host: Option<&'a str>,
    pub window_title: Option<&'a str>,
    pub is_private_window: bool,
}

/// Pure predicate; same semantics as the TS version (including: empty strings are falsy,
/// so an empty bundle id / host / title never matches).
pub fn is_excluded(ex: &Exclusions, t: &ExclusionTarget<'_>) -> bool {
    if t.is_private_window {
        return true;
    }
    let in_apps = |s: &str| {
        let s = s.to_lowercase();
        ex.apps.iter().any(|a| a.to_lowercase() == s)
    };
    if in_apps(t.app_key) {
        return true;
    }
    if let Some(b) = t.bundle_id.filter(|b| !b.is_empty()) {
        if in_apps(b) {
            return true;
        }
    }
    if let Some(h) = t.url_host.filter(|h| !h.is_empty()) {
        let h = h.to_lowercase();
        if ex.domains.iter().any(|d| {
            let d = d.to_lowercase();
            h == d || h.ends_with(&format!(".{d}"))
        }) {
            return true;
        }
    }
    if let Some(title) = t.window_title.filter(|s| !s.is_empty()) {
        let title = title.to_lowercase();
        if ex.title_keywords.iter().any(|k| title.contains(&k.to_lowercase())) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d() -> Exclusions {
        default_exclusions()
    }

    #[test]
    fn defaults_match_generated_contract() {
        let generated: Exclusions =
            serde_json::from_str(include_str!("contract/default-exclusions.json")).unwrap();
        assert_eq!(generated, d());
    }

    // Mirrors packages/schema/test/contract.test.ts
    #[test]
    fn ts_contract_parity() {
        assert!(is_excluded(&d(), &ExclusionTarget { app_key: "password_manager", ..Default::default() }));
        assert!(is_excluded(
            &d(),
            &ExclusionTarget { app_key: "browser", url_host: Some("secure.chase.com"), ..Default::default() }
        ));
        assert!(is_excluded(&d(), &ExclusionTarget { app_key: "browser", is_private_window: true, ..Default::default() }));
        assert!(!is_excluded(
            &d(),
            &ExclusionTarget { app_key: "gmail", window_title: Some("Inbox"), ..Default::default() }
        ));
    }

    #[test]
    fn more_parity_cases() {
        let ex = d();
        let t = |app: &'static str, bundle: Option<&'static str>, host: Option<&'static str>, title: Option<&'static str>| {
            is_excluded(&ex, &ExclusionTarget { app_key: app, bundle_id: bundle, url_host: host, window_title: title, is_private_window: false })
        };
        // case-insensitive app key and bundle id
        assert!(t("PASSWORD_MANAGER", None, None, None));
        // subdomain match but not suffix-without-dot
        assert!(t("browser", None, Some("CHASE.com"), None));
        assert!(!t("browser", None, Some("notchase.com"), None));
        assert!(t("browser", None, Some("a.b.mercury.com"), None));
        // title keywords, case-insensitive substring
        assert!(t("browser", None, None, Some("Reset your PASSWORD - Acme")));
        assert!(t("word", None, None, Some("Therapy notes.docx")));
        assert!(t("browser", None, None, Some("Embankment walk")), "substring semantics, like TS");
        assert!(!t("excel", None, None, Some("Q3 invoices.xlsx")));
        // empty strings never match
        assert!(!t("excel", Some(""), Some(""), Some("")));

        let custom = Exclusions {
            apps: vec!["com.tinyspeck.slackmacgap".into()],
            domains: vec!["Example.org".into()],
            title_keywords: vec!["secret project".into()],
            private_browsing: true,
        };
        let c = |t: ExclusionTarget| is_excluded(&custom, &t);
        assert!(c(ExclusionTarget { app_key: "slack", bundle_id: Some("com.tinyspeck.SlackMacGap"), ..Default::default() }));
        assert!(c(ExclusionTarget { app_key: "browser", url_host: Some("app.example.org"), ..Default::default() }));
        assert!(c(ExclusionTarget { app_key: "notion", window_title: Some("The Secret Project plan"), ..Default::default() }));
        assert!(!c(ExclusionTarget { app_key: "password_manager", ..Default::default() }), "custom list replaces defaults");
        assert!(c(ExclusionTarget { app_key: "gmail", is_private_window: true, ..Default::default() }));
    }
}

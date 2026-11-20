//! On-device redaction. Every free-text field (window titles, app names, digest headings,
//! labels and text) passes through [`redact`] before it is stored or sent.
//!
//! Detectors run in a fixed order over the progressively redacted string, so a span
//! consumed by an earlier detector (e.g. a URL) is not re-examined by a later one. Each
//! replaced span becomes `[REDACTED:<kind>]` and increments that kind's count.
//!
//! Order: URLs -> PEM keys -> JWTs -> known key prefixes -> bearer tokens ->
//! `password=`/`token=` assignments -> emails -> IBANs (mod-97) -> card numbers (Luhn) ->
//! SSNs -> phone numbers -> long hex -> high-entropy tokens.
//!
//! Bias: when in doubt, redact. Benign look-alikes (dates, versions, order numbers,
//! non-Luhn 16-digit numbers, short git hashes, UUIDs) are covered by the hostile corpus
//! test so over-redaction stays visible.

use std::sync::LazyLock;

use regex::{Captures, Regex};

use crate::apps::parse_url;
use crate::model::{RedactionCounts, RedactionKind};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Redacted {
    pub text: String,
    pub counts: RedactionCounts,
}

macro_rules! re {
    ($name:ident, $pat:expr) => {
        static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($pat).expect(stringify!($name)));
    };
}

// URLs with a scheme, `www.` hosts, and bare `host.tld/path`.
re!(URL_SCHEME, r#"(?i)\b(?:https?|ftp|wss?)://[^\s<>"'`\[\]{}|\\^]+"#);
re!(URL_WWW, r#"(?i)\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#][^\s<>"'`\[\]{}|\\^]*)?"#);
re!(URL_BARE_PATH, r#"(?i)\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}(?::\d+)?[/?#][^\s<>"'`\[\]{}|\\^]+"#);

re!(PEM, r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)");
re!(JWT, r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]*)?");
re!(
    KEY_PREFIX,
    concat!(
        r"\b(?:",
        r"sk-ant-[A-Za-z0-9_-]{8,}",
        r"|sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{8,}",
        r"|sk-[A-Za-z0-9]{20,}",
        r"|(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}",
        r"|whsec_[A-Za-z0-9]{16,}",
        r"|gh[pousr]_[A-Za-z0-9]{20,}",
        r"|github_pat_[A-Za-z0-9_]{20,}",
        r"|glpat-[A-Za-z0-9_-]{16,}",
        r"|xox[abposre]-[A-Za-z0-9-]{8,}",
        r"|xapp-[A-Za-z0-9-]{8,}",
        r"|(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}",
        r"|AIza[0-9A-Za-z_-]{30,}",
        r"|ya29\.[0-9A-Za-z_-]{20,}",
        r"|npm_[A-Za-z0-9]{30,}",
        r"|pypi-[A-Za-z0-9_-]{30,}",
        r"|shp(?:at|ss|ca|pa)_[a-fA-F0-9]{20,}",
        r"|SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}",
        r"|hf_[A-Za-z0-9]{30,}",
        r"|dop_v1_[a-f0-9]{40,}",
        r"|sq0(?:atp|csp)-[A-Za-z0-9_-]{20,}",
        r")"
    )
);
re!(BEARER, r"(?i)\b(bearer|token|basic)(\s+)([A-Za-z0-9._~+/-]{12,}=*)");
re!(
    ASSIGNMENT,
    r#"(?i)\b(password|passwd|passcode|pwd|pin|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token)(\s*[:=]\s*|\s+is\s+)("[^"]{1,200}"|'[^']{1,200}'|[^\s,;]{1,200})"#
);
re!(EMAIL, r"(?i)\b[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b");
re!(EMAIL_OBFUSCATED, r"(?i)\b[a-z0-9._%+-]+\s*(?:\[at\]|\(at\)|\{at\})\s*[a-z0-9-]+(?:\s*(?:\[dot\]|\(dot\)|\{dot\}|\.)\s*[a-z0-9-]+)+");
re!(IBAN, r"(?i)\b[a-z]{2}[0-9]{2}(?:[ \u{00A0}-]?[a-z0-9]{4}){2,7}(?:[ \u{00A0}-]?[a-z0-9]{1,4})?\b");
re!(CARD, r"\b[0-9](?:[ \u{00A0}-]?[0-9]){12,18}\b");
re!(CARD_DOTTED, r"\b[0-9]{4}\.[0-9]{4}\.[0-9]{4}\.[0-9]{1,7}\b");
re!(SSN, r"\b([0-9]{3})[- \u{00A0}]([0-9]{2})[- \u{00A0}]([0-9]{4})\b");
re!(SSN_CONTEXT, r"(?i)\b(ssn|ss#|social security(?: number| no\.?| #)?)(\D{0,15}?)([0-9]{9}|[0-9]{3}[- ][0-9]{2}[- ][0-9]{4})\b");
re!(PHONE_INTL, r"\+[0-9]{1,3}(?:[ \u{00A0}.-]?\(?[0-9]{1,4}\)?)(?:[ \u{00A0}.-]?[0-9]{1,5}){1,5}\b");
re!(PHONE_NANP, r"(?:\([0-9]{3}\)[ \u{00A0}]?|\b[0-9]{3}[ \u{00A0}.-])[0-9]{3}[ \u{00A0}.-][0-9]{4}\b");
re!(PHONE_TRUNK, r"\b0[0-9]{2,4}[ \u{00A0}-][0-9]{3,4}[ \u{00A0}-]?[0-9]{3,4}\b");
re!(PHONE_CONTEXT, r"(?i)\b(phone|tel|telephone|mobile|cell|call me at|whatsapp|fax)(\s*(?:no\.?|number|#)?\s*[:.]?\s*)(\+?[0-9][0-9 ().\u{00A0}-]{6,20}[0-9])");
re!(LONG_HEX, r"\b[0-9a-fA-F]{32,}\b");
// AWS-style 40-char base64 secret (contains / or +): structure, not entropy, gives it away.
re!(BASE64_40, r"(?:^|[^A-Za-z0-9/+=])([A-Za-z0-9/+]{40})(?:[^A-Za-z0-9/+=]|$)");
re!(TOKEN, r"[A-Za-z0-9+/=_.-]{16,}");

fn digits(s: &str) -> String {
    s.chars().filter(char::is_ascii_digit).collect()
}

/// Luhn checksum over an all-digit string.
pub fn luhn_valid(number: &str) -> bool {
    let ds: Vec<u32> = number.chars().filter_map(|c| c.to_digit(10)).collect();
    if ds.len() < 2 || ds.len() != number.len() {
        return false;
    }
    let sum: u32 = ds
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &d)| {
            if i % 2 == 1 {
                let x = d * 2;
                if x > 9 { x - 9 } else { x }
            } else {
                d
            }
        })
        .sum();
    sum % 10 == 0
}

/// ISO 13616 mod-97 check. Accepts spaces/dashes and either case.
pub fn iban_valid(s: &str) -> bool {
    let compact: String = s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect();
    if !(15..=34).contains(&compact.len()) {
        return false;
    }
    let b = compact.as_bytes();
    if !(b[0].is_ascii_alphabetic() && b[1].is_ascii_alphabetic() && b[2].is_ascii_digit() && b[3].is_ascii_digit()) {
        return false;
    }
    let rearranged = compact[4..].chars().chain(compact[..4].chars());
    let mut rem: u32 = 0;
    for c in rearranged {
        let v = if c.is_ascii_digit() { c as u32 - '0' as u32 } else { c as u32 - 'A' as u32 + 10 };
        rem = if v >= 10 { (rem * 100 + v) % 97 } else { (rem * 10 + v) % 97 };
    }
    rem == 1
}

fn ssn_plausible(area: &str, group: &str, serial: &str) -> bool {
    area != "000" && area != "666" && !area.starts_with('9') && group != "00" && serial != "0000"
}

/// Shannon entropy in bits per char.
pub fn shannon_entropy(s: &str) -> f64 {
    let mut counts = std::collections::HashMap::new();
    let n = s.chars().count() as f64;
    if n == 0.0 {
        return 0.0;
    }
    for c in s.chars() {
        *counts.entry(c).or_insert(0usize) += 1;
    }
    counts.values().map(|&c| {
        let p = c as f64 / n;
        -p * p.log2()
    }).sum()
}

fn is_vowel(c: char) -> bool {
    matches!(c.to_ascii_lowercase(), 'a' | 'e' | 'i' | 'o' | 'u' | 'y')
}

/// True when most letters sit in pronounceable word-like runs (CamelCase words,
/// `invoice_final`), which random tokens almost never do.
fn wordy(piece: &str) -> bool {
    let mut runs: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in piece.chars() {
        if c.is_ascii_alphabetic() {
            if c.is_ascii_uppercase() && prev_lower && !cur.is_empty() {
                runs.push(std::mem::take(&mut cur));
            }
            prev_lower = c.is_ascii_lowercase();
            cur.push(c);
        } else {
            if !cur.is_empty() {
                runs.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
        }
    }
    if !cur.is_empty() {
        runs.push(cur);
    }
    let letters: usize = runs.iter().map(String::len).sum();
    if letters == 0 {
        return false;
    }
    let word_letters: usize = runs
        .iter()
        .filter(|r| {
            if r.len() < 3 || !r.chars().any(is_vowel) {
                return false;
            }
            let mut run = 0;
            let mut max_cons = 0;
            for c in r.chars() {
                if is_vowel(c) { run = 0 } else { run += 1; max_cons = max_cons.max(run) }
            }
            max_cons <= 3
        })
        .map(String::len)
        .sum();
    word_letters * 10 >= letters * 6
}

fn piece_is_secret(piece: &str) -> bool {
    let len = piece.chars().count();
    if len < 16 {
        return false;
    }
    let has_digit = piece.chars().any(|c| c.is_ascii_digit());
    let has_upper = piece.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = piece.chars().any(|c| c.is_ascii_lowercase());
    if !(has_upper || has_lower) {
        return false; // all digits: card/phone detectors own those
    }
    if !(has_digit || (has_upper && has_lower && len >= 24)) {
        return false;
    }
    shannon_entropy(piece) >= 3.0 && !wordy(piece)
}

/// High-entropy backstop for tokens without a known prefix.
pub fn looks_like_secret_token(tok: &str) -> bool {
    tok.split(['-', '_', '.']).any(piece_is_secret)
}

/// Strip zero-width characters and fold common non-ASCII decimal digits to ASCII so that
/// `４１１１…` or `4111\u{200B}1111…` cannot slip past the digit-based detectors.
fn normalize(input: &str) -> String {
    input
        .chars()
        .filter(|c| !matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}'))
        .map(|c| {
            let cp = c as u32;
            for base in [0xFF10u32, 0x0660, 0x06F0, 0x0966, 0x09E6, 0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6] {
                if (base..base + 10).contains(&cp) {
                    return char::from_digit(cp - base, 10).unwrap_or(c);
                }
            }
            c
        })
        .collect()
}

struct Pass<'a> {
    counts: &'a mut RedactionCounts,
}

impl Pass<'_> {
    /// Replace every match for which `f` returns Some(replacement, kind).
    fn run(&mut self, text: String, re: &Regex, mut f: impl FnMut(&Captures) -> Option<(String, RedactionKind)>) -> String {
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        let mut changed = false;
        for caps in re.captures_iter(&text) {
            let m = caps.get(0).expect("group 0");
            if let Some((rep, kind)) = f(&caps) {
                out.push_str(&text[last..m.start()]);
                out.push_str(&rep);
                last = m.end();
                changed = true;
                *self.counts.entry(kind).or_insert(0) += 1;
            }
        }
        if !changed {
            return text;
        }
        out.push_str(&text[last..]);
        out
    }

    fn whole(&mut self, text: String, re: &Regex, kind: RedactionKind) -> String {
        self.run(text, re, |_| Some((kind.placeholder(), kind)))
    }
}

fn url_replacement(raw: &str, assume_http: bool) -> (String, RedactionKind) {
    // Trailing sentence punctuation is not part of the URL.
    let trimmed = raw.trim_end_matches(['.', ',', ';', ':', '!', '?', ')']);
    let tail = &raw[trimmed.len()..];
    let candidate = if assume_http { format!("http://{trimmed}") } else { trimmed.to_string() };
    let ph = RedactionKind::UrlPath.placeholder();
    match parse_url(&candidate) {
        Some(p) if p.has_path || candidate.contains('@') => (format!("{}/{}{}", p.host, ph, tail), RedactionKind::UrlPath),
        Some(p) => (format!("{}{}", p.host, tail), RedactionKind::UrlPath),
        None => (format!("{ph}{tail}"), RedactionKind::UrlPath),
    }
}

/// Redact a free-text field.
pub fn redact(input: &str) -> Redacted {
    let mut counts = RedactionCounts::new();
    let mut p = Pass { counts: &mut counts };
    let mut t = normalize(input);

    // URLs -> host only. Host-only URLs are rewritten but not counted (nothing removed).
    for (re, assume_http) in [(&*URL_SCHEME, false), (&*URL_WWW, true), (&*URL_BARE_PATH, true)] {
        let mut uncounted = 0u32;
        t = p.run(t, re, |c| {
            let raw = c.get(0).unwrap().as_str();
            if raw.contains("[REDACTED:") {
                return None;
            }
            let (rep, kind) = url_replacement(raw, assume_http);
            if !rep.contains("[REDACTED:") {
                uncounted += 1;
            }
            Some((rep, kind))
        });
        if uncounted > 0 {
            if let Some(n) = p.counts.get_mut(&RedactionKind::UrlPath) {
                *n -= uncounted;
                if *n == 0 {
                    p.counts.remove(&RedactionKind::UrlPath);
                }
            }
        }
    }

    t = p.whole(t, &PEM, RedactionKind::ApiKey);
    t = p.whole(t, &JWT, RedactionKind::ApiKey);
    t = p.whole(t, &KEY_PREFIX, RedactionKind::ApiKey);
    t = p.run(t, &BEARER, |c| {
        let tok = &c[3];
        // `Token` / `Basic` followed by an English word is not a credential.
        if !tok.chars().any(|ch| ch.is_ascii_digit()) && tok.len() < 20 {
            return None;
        }
        Some((format!("{}{}{}", &c[1], &c[2], RedactionKind::ApiKey.placeholder()), RedactionKind::ApiKey))
    });
    t = p.run(t, &ASSIGNMENT, |c| {
        let val = &c[3];
        if val.starts_with("[REDACTED:") {
            return None;
        }
        let key = c[1].to_ascii_lowercase();
        let kind = if key.starts_with("pass") || key == "pwd" || key == "pin" {
            RedactionKind::PasswordField
        } else {
            RedactionKind::ApiKey
        };
        Some((format!("{}{}{}", &c[1], &c[2], kind.placeholder()), kind))
    });
    t = p.whole(t, &EMAIL, RedactionKind::Email);
    t = p.whole(t, &EMAIL_OBFUSCATED, RedactionKind::Email);
    t = p.run(t, &IBAN, |c| {
        let s = c.get(0).unwrap().as_str();
        iban_valid(s).then(|| (RedactionKind::Iban.placeholder(), RedactionKind::Iban))
    });
    t = p.run(t, &CARD, |c| card_replacement(c.get(0).unwrap().as_str()));
    t = p.run(t, &CARD_DOTTED, |c| {
        let d = digits(c.get(0).unwrap().as_str());
        ((13..=19).contains(&d.len()) && luhn_valid(&d)).then(|| (RedactionKind::CardNumber.placeholder(), RedactionKind::CardNumber))
    });
    t = p.run(t, &SSN_CONTEXT, |c| {
        Some((format!("{}{}{}", &c[1], &c[2], RedactionKind::Ssn.placeholder()), RedactionKind::Ssn))
    });
    t = p.run(t, &SSN, |c| {
        ssn_plausible(&c[1], &c[2], &c[3]).then(|| (RedactionKind::Ssn.placeholder(), RedactionKind::Ssn))
    });
    t = p.run(t, &PHONE_CONTEXT, |c| {
        let n = digits(&c[3]).len();
        (7..=15).contains(&n).then(|| (format!("{}{}{}", &c[1], &c[2], RedactionKind::Phone.placeholder()), RedactionKind::Phone))
    });
    t = p.run(t, &PHONE_INTL, |c| {
        let n = digits(c.get(0).unwrap().as_str()).len();
        (8..=15).contains(&n).then(|| (RedactionKind::Phone.placeholder(), RedactionKind::Phone))
    });
    t = p.whole(t, &PHONE_NANP, RedactionKind::Phone);
    t = p.run(t, &PHONE_TRUNK, |c| {
        let n = digits(c.get(0).unwrap().as_str()).len();
        (10..=11).contains(&n).then(|| (RedactionKind::Phone.placeholder(), RedactionKind::Phone))
    });
    t = p.whole(t, &LONG_HEX, RedactionKind::HighEntropyToken);
    t = p.run(t, &BASE64_40, |c| {
        let whole = c.get(0).unwrap().as_str();
        let tok = &c[1];
        let structured = tok.contains(['/', '+'])
            && tok.chars().any(|ch| ch.is_ascii_digit())
            && tok.chars().any(|ch| ch.is_ascii_uppercase())
            && tok.chars().any(|ch| ch.is_ascii_lowercase());
        structured.then(|| (whole.replacen(tok, &RedactionKind::ApiKey.placeholder(), 1), RedactionKind::ApiKey))
    });
    t = p.run(t, &TOKEN, |c| {
        let tok = c.get(0).unwrap().as_str();
        looks_like_secret_token(tok).then(|| (RedactionKind::HighEntropyToken.placeholder(), RedactionKind::HighEntropyToken))
    });

    Redacted { text: t, counts }
}

/// A digit run with separators: redact if the whole run, or any contiguous run of its
/// separator-delimited groups, is a 13-19 digit Luhn-valid number.
fn card_replacement(s: &str) -> Option<(String, RedactionKind)> {
    let d = digits(s);
    let kind = RedactionKind::CardNumber;
    if (13..=19).contains(&d.len()) && luhn_valid(&d) {
        return Some((kind.placeholder(), kind));
    }
    let groups: Vec<&str> = s.split([' ', '\u{00A0}', '-']).filter(|g| !g.is_empty()).collect();
    if groups.len() < 2 {
        return None;
    }
    for i in 0..groups.len() {
        for j in (i + 1..=groups.len()).rev() {
            let joined: String = groups[i..j].concat();
            if (13..=19).contains(&joined.len()) && luhn_valid(&joined) {
                let before = groups[..i].join(" ");
                let after = groups[j..].join(" ");
                let mut out = String::new();
                if !before.is_empty() {
                    out.push_str(&before);
                    out.push(' ');
                }
                out.push_str(&kind.placeholder());
                if !after.is_empty() {
                    out.push(' ');
                    out.push_str(&after);
                }
                return Some((out, kind));
            }
        }
    }
    None
}

/// Text of a secure/password field is dropped entirely, never inspected.
pub fn secure_field() -> Redacted {
    let kind = RedactionKind::PasswordField;
    Redacted { text: kind.placeholder(), counts: [(kind, 1)].into_iter().collect() }
}

/// Truncate to at most `max` chars (not bytes), on a char boundary.
pub fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> String {
        redact(s).text
    }

    #[test]
    fn luhn_and_iban() {
        assert!(luhn_valid("4111111111111111"));
        assert!(luhn_valid("5555555555554444"));
        assert!(luhn_valid("378282246310005"));
        assert!(!luhn_valid("4111111111111112"));
        assert!(!luhn_valid("1234567812345678"));
        assert!(iban_valid("GB82 WEST 1234 5698 7654 32"));
        assert!(iban_valid("DE89370400440532013000"));
        assert!(iban_valid("fr1420041010050500013m02606"));
        assert!(!iban_valid("GB82 WEST 1234 5698 7654 33"));
        assert!(!iban_valid("GB82"));
    }

    #[test]
    fn cards() {
        assert_eq!(r("card 4111 1111 1111 1111 exp 12/27"), "card [REDACTED:card_number] exp 12/27");
        assert_eq!(r("4111-1111-1111-1111"), "[REDACTED:card_number]");
        assert_eq!(r("amex 3782 822463 10005"), "amex [REDACTED:card_number]");
        assert_eq!(r("4111.1111.1111.1111"), "[REDACTED:card_number]");
        assert_eq!(r("not a card 1234 5678 1234 5678"), "not a card 1234 5678 1234 5678");
        assert_eq!(r("qty 3 4111 1111 1111 1111"), "qty 3 [REDACTED:card_number]");
        assert_eq!(redact("4111111111111111").counts[&RedactionKind::CardNumber], 1);
    }

    #[test]
    fn ssn_email_phone() {
        assert_eq!(r("SSN 123-45-6789"), "SSN [REDACTED:ssn]");
        assert_eq!(r("ssn: 123456789"), "ssn: [REDACTED:ssn]");
        assert_eq!(r("000-12-3456 is invalid"), "000-12-3456 is invalid");
        assert_eq!(r("mail jane.doe+x@example.co.uk now"), "mail [REDACTED:email] now");
        assert_eq!(r("call +44 20 7946 0958"), "call [REDACTED:phone]");
        assert_eq!(r("(415) 555-0132"), "[REDACTED:phone]");
        assert_eq!(r("415-555-0132"), "[REDACTED:phone]");
        assert_eq!(r("Released 2026-11-20"), "Released 2026-11-20");
    }

    #[test]
    fn keys() {
        // Assembled from fragments so the source never holds a secret-shaped literal
        // (repository push protection scans for these prefixes).
        for k in [
            concat!("sk_", "live_", "51FAKEfakeFAKEfake0123"),
            concat!("gh", "p_", "FAKEfakeFAKEfake0123456789abcdefghij"),
            concat!("xo", "xb-", "123456789012-FAKEfakeFAKE"),
            concat!("AK", "IA", "FAKEFAKEFAKE7FAK"),
            concat!("AI", "za", "SyFAKE-fakeFAKEfake0123456789abcdef"),
            concat!("sk-", "ant-", "api03-FAKEfakeFAKEfake"),
        ] {
            let out = r(&format!("key {k} end"));
            assert_eq!(out, "key [REDACTED:api_key] end", "{k}");
        }
        assert_eq!(r("password: hunter2"), "password: [REDACTED:password_field]");
        assert_eq!(r("Authorization: Bearer abc123def456ghi789"), "Authorization: Bearer [REDACTED:api_key]");
    }

    #[test]
    fn urls() {
        let x = redact("see https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing.");
        assert_eq!(x.text, "see docs.google.com/[REDACTED:url_path].");
        assert_eq!(x.counts[&RedactionKind::UrlPath], 1);
        let y = redact("open https://github.com");
        assert_eq!(y.text, "open github.com");
        assert!(y.counts.is_empty());
        assert_eq!(r("acme.zendesk.com/agent/tickets/123"), "acme.zendesk.com/[REDACTED:url_path]");
    }

    #[test]
    fn entropy() {
        assert!(looks_like_secret_token("aZ3kP9xQmW2rT7vB1nY5cL8d"));
        assert!(!looks_like_secret_token("invoice_2026_11_20_final_v2"));
        assert!(!looks_like_secret_token("ProjectPhoenix2026Q3Roadmap"));
        assert!(!looks_like_secret_token("123e4567-e89b-12d3-a456-426614174000"));
        assert_eq!(r("token aZ3kP9xQmW2rT7vB1nY5cL8d"), "token [REDACTED:api_key]");
        assert_eq!(r("id aZ3kP9xQmW2rT7vB1nY5cL8d"), "id [REDACTED:high_entropy_token]");
    }

    #[test]
    fn unicode_tricks() {
        assert_eq!(r("４１１１ １１１１ １１１１ １１１１"), "[REDACTED:card_number]");
        assert_eq!(r("4111\u{200B}1111\u{200B}1111\u{200B}1111"), "[REDACTED:card_number]");
    }

    #[test]
    fn truncation_is_char_safe() {
        assert_eq!(truncate_chars("héllo", 2), "hé");
        assert_eq!(truncate_chars("hi", 10), "hi");
    }
}

//! macOS capture source.
//!
//! STATUS: type-checked against the aarch64-apple-darwin target only (see README "Known
//! limitations"). It has NOT been run on real hardware in CI. Never compiled on other OSes.
//!
//! What it reads, and nothing else:
//! - frontmost app: `NSWorkspace.frontmostApplication` (bundle id, localized name, pid)
//! - window title: AX `AXFocusedWindow` -> `AXTitle`
//! - browser URL (Chrome, Safari, Arc, Brave, Edge): AX `AXURL` of the web area, else the
//!   address bar's `AXValue`. The full URL stays in memory only until the pipeline reduces
//!   it to host + AppKey.
//! - private windows: best-effort AX label scan for "Incognito"/"Private"/"InPrivate".
//! - text digest: a bounded walk of the focused window's AX tree collecting headings,
//!   control labels and static text. Editable fields' values are never read;
//!   `AXSecureTextField` elements are skipped entirely, and a focused secure field marks the
//!   sample `secureField` (the pipeline drops its text).
//! - clipboard: `NSPasteboard.changeCount` polling plus the pasteboard *types* for a coarse
//!   kind. The pasteboard contents are never read.
//! - idle: `CGEventSourceSecondsSinceLastEventType`.
//!
//! Requires the Accessibility permission (System Settings > Privacy & Security >
//! Accessibility). No Screen Recording permission is requested or needed.

#![allow(unused_unsafe)]

use std::ffi::c_void;
use std::time::{Duration, Instant};

use chrono::Utc;
use core_foundation::array::CFArray;
use core_foundation::base::{CFType, CFTypeRef, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::url::CFURL;
use objc2_app_kit::{NSPasteboard, NSWorkspace};

use super::{CaptureError, CaptureSource, SourcePoll};
use crate::apps;
use crate::exclude::{is_excluded, ExclusionTarget};
use crate::model::{ContentKind, Exclusions, Platform, RawSample};

type AXUIElementRef = *const c_void;
type AXError = i32;
const AX_ERROR_SUCCESS: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFStringRef, value: *mut CFTypeRef) -> AXError;
    fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout_seconds: f32) -> AXError;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: CFStringRef;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
}

const KCG_EVENT_SOURCE_STATE_HID_SYSTEM: i32 = 1;
const KCG_ANY_INPUT_EVENT_TYPE: u32 = u32::MAX;

const POLL_EVERY: Duration = Duration::from_secs(1);
const DIGEST_EVERY: Duration = Duration::from_secs(10);
const MAX_AX_NODES: usize = 1500;
const MAX_AX_DEPTH: usize = 30;
const MAX_RAW_TEXT_CHARS: usize = 4000;
const MAX_RAW_ITEMS: usize = 80;

const BROWSERS: &[&str] = &[
    "com.google.Chrome",
    "com.apple.Safari",
    "company.thebrowser.Browser",
    "com.brave.Browser",
    "com.microsoft.edgemac",
    "org.mozilla.firefox",
];

/// An owned AX element (released on drop via CFType).
struct Ax(CFType);

impl Ax {
    fn raw(&self) -> AXUIElementRef {
        self.0.as_CFTypeRef()
    }

    fn app(pid: i32) -> Option<Ax> {
        let r = unsafe { AXUIElementCreateApplication(pid) };
        if r.is_null() {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(r, 0.25) };
        Some(Ax(unsafe { CFType::wrap_under_create_rule(r) }))
    }

    fn attr(&self, name: &str) -> Option<CFType> {
        let key = CFString::new(name);
        let mut value: CFTypeRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(self.raw(), key.as_concrete_TypeRef(), &mut value) };
        if err != AX_ERROR_SUCCESS || value.is_null() {
            return None;
        }
        Some(unsafe { CFType::wrap_under_create_rule(value) })
    }

    fn element(&self, name: &str) -> Option<Ax> {
        self.attr(name).map(Ax)
    }

    fn string(&self, name: &str) -> Option<String> {
        let v = self.attr(name)?;
        let s = v.downcast::<CFString>()?.to_string();
        let s = s.trim().to_string();
        (!s.is_empty()).then_some(s)
    }

    fn url(&self, name: &str) -> Option<String> {
        let v = self.attr(name)?;
        if let Some(u) = v.downcast::<CFURL>() {
            return Some(u.get_string().to_string());
        }
        v.downcast::<CFString>().map(|s| s.to_string())
    }

    fn children(&self) -> Vec<Ax> {
        let Some(v) = self.attr("AXChildren") else { return vec![] };
        let Some(arr) = v.downcast::<CFArray>() else { return vec![] };
        arr.iter()
            .map(|item| *item)
            .filter(|p| !p.is_null())
            // children are borrowed from the array: retain them (get rule)
            .map(|p| Ax(unsafe { CFType::wrap_under_get_rule(p) }))
            .collect()
    }

    fn role(&self) -> String {
        self.string("AXRole").unwrap_or_default()
    }

    fn is_secure(&self) -> bool {
        self.role() == "AXSecureTextField" || self.string("AXSubrole").as_deref() == Some("AXSecureTextField")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Front {
    bundle_id: String,
    app_name: String,
    pid: i32,
}

fn frontmost() -> Option<Front> {
    unsafe {
        let ws = NSWorkspace::sharedWorkspace();
        let app = ws.frontmostApplication()?;
        let bundle_id = app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default();
        let app_name = app.localizedName().map(|s| s.to_string()).unwrap_or_default();
        let pid = app.processIdentifier();
        Some(Front { bundle_id, app_name, pid })
    }
}

fn pasteboard_state() -> (isize, ContentKind) {
    unsafe {
        let pb = NSPasteboard::generalPasteboard();
        let count = pb.changeCount();
        let mut kind = ContentKind::Other;
        if let Some(types) = pb.types() {
            let names: Vec<String> = types.iter().map(|t| t.to_string()).collect();
            kind = if names.iter().any(|t| t == "public.file-url" || t == "NSFilenamesPboardType") {
                ContentKind::File
            } else if names.iter().any(|t| t == "public.png" || t == "public.tiff" || t == "public.jpeg") {
                ContentKind::Image
            } else if names.iter().any(|t| t == "public.utf8-plain-text" || t == "public.rtf" || t == "public.html") {
                ContentKind::Text
            } else {
                ContentKind::Other
            };
        }
        (count, kind)
    }
}

fn idle_seconds() -> f64 {
    unsafe { CGEventSourceSecondsSinceLastEventType(KCG_EVENT_SOURCE_STATE_HID_SYSTEM, KCG_ANY_INPUT_EVENT_TYPE) }
}

/// Ask for (and check) the Accessibility permission. Shows the system prompt once.
pub fn accessibility_trusted(prompt: bool) -> bool {
    unsafe {
        let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let value = if prompt { CFBoolean::true_value() } else { CFBoolean::false_value() };
        let dict = CFDictionary::from_CFType_pairs(&[(key.as_CFType(), value.as_CFType())]);
        AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef() as *const c_void)
    }
}

/// Bounded breadth-first collection over the focused window.
fn find_url_and_private(window: &Ax) -> (Option<String>, bool) {
    let mut queue = vec![(Ax(window.0.clone()), 0usize)];
    let mut seen = 0;
    let mut url = None;
    let mut private = false;
    while let Some((el, depth)) = queue.pop() {
        seen += 1;
        if seen > 400 {
            break;
        }
        let role = el.role();
        if url.is_none() && role == "AXWebArea" {
            url = el.url("AXURL");
        }
        if url.is_none() && (role == "AXTextField" || role == "AXComboBox") {
            let desc = el.string("AXDescription").unwrap_or_default().to_lowercase();
            if desc.contains("address") || desc.contains("search bar") || desc.contains("url") {
                url = el.string("AXValue").map(|v| if v.contains("://") { v } else { format!("https://{v}") });
            }
        }
        for attr in ["AXTitle", "AXDescription"] {
            if let Some(s) = el.string(attr) {
                let l = s.to_lowercase();
                if l.contains("incognito") || l.contains("private browsing") || l.contains("inprivate") {
                    private = true;
                }
            }
        }
        if depth < 8 && role != "AXWebArea" {
            queue.extend(el.children().into_iter().map(|c| (c, depth + 1)));
        }
    }
    (url, private)
}

struct Digest {
    headings: Vec<String>,
    labels: Vec<String>,
    text: String,
}

fn collect_digest(window: &Ax) -> Digest {
    let mut d = Digest { headings: vec![], labels: vec![], text: String::new() };
    let mut queue = std::collections::VecDeque::from([(Ax(window.0.clone()), 0usize)]);
    let mut visited = 0;
    while let Some((el, depth)) = queue.pop_front() {
        visited += 1;
        if visited > MAX_AX_NODES {
            break;
        }
        if el.is_secure() {
            continue; // never read, never descend
        }
        let role = el.role();
        match role.as_str() {
            "AXHeading" => {
                if let Some(s) = el.string("AXTitle").or_else(|| el.string("AXDescription")).or_else(|| el.string("AXValue")) {
                    if d.headings.len() < MAX_RAW_ITEMS {
                        d.headings.push(s);
                    }
                }
            }
            "AXStaticText" => {
                if let Some(s) = el.string("AXValue") {
                    if d.text.chars().count() < MAX_RAW_TEXT_CHARS {
                        if !d.text.is_empty() {
                            d.text.push(' ');
                        }
                        d.text.push_str(&s);
                    }
                }
            }
            "AXButton" | "AXCheckBox" | "AXRadioButton" | "AXMenuButton" | "AXPopUpButton" | "AXTab" | "AXLink"
            | "AXMenuItem" => {
                if let Some(s) = el.string("AXTitle").or_else(|| el.string("AXDescription")) {
                    if d.labels.len() < MAX_RAW_ITEMS {
                        d.labels.push(s);
                    }
                }
            }
            // Editable fields: only their label/placeholder, never their value.
            "AXTextField" | "AXTextArea" | "AXComboBox" | "AXSearchField" => {
                if let Some(s) = el.string("AXPlaceholderValue").or_else(|| el.string("AXDescription")) {
                    if d.labels.len() < MAX_RAW_ITEMS {
                        d.labels.push(s);
                    }
                }
                continue;
            }
            _ => {}
        }
        if depth < MAX_AX_DEPTH {
            for c in el.children() {
                queue.push_back((c, depth + 1));
            }
        }
    }
    d.text = d.text.chars().take(MAX_RAW_TEXT_CHARS).collect();
    d
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FocusKey {
    bundle_id: String,
    title: Option<String>,
    url: Option<String>,
    private: bool,
}

pub struct MacosSource {
    idle_threshold: f64,
    exclusions: Exclusions,
    last_focus: Option<FocusKey>,
    last_digest_at: Option<Instant>,
    last_digest_sig: Option<u64>,
    last_change_count: Option<isize>,
    idle: bool,
    next_poll: Instant,
}

impl MacosSource {
    pub fn new(idle_threshold_seconds: u32) -> Result<Self, CaptureError> {
        if !accessibility_trusted(true) {
            return Err(CaptureError::PermissionDenied(
                "Tracer needs the Accessibility permission (System Settings > Privacy & Security > Accessibility)".into(),
            ));
        }
        Ok(MacosSource {
            idle_threshold: idle_threshold_seconds.max(1) as f64,
            exclusions: Exclusions::default(),
            last_focus: None,
            last_digest_at: None,
            last_digest_sig: None,
            last_change_count: None,
            idle: false,
            next_poll: Instant::now(),
        })
    }

    fn poll(&mut self) -> Vec<RawSample> {
        let mut out = Vec::new();
        let now = Utc::now();

        // idle
        let idle_for = idle_seconds();
        if !self.idle && idle_for >= self.idle_threshold {
            self.idle = true;
            out.push(RawSample::IdleStart { t: now, threshold_seconds: self.idle_threshold as u32 });
        } else if self.idle && idle_for < self.idle_threshold {
            self.idle = false;
            out.push(RawSample::IdleEnd { t: now });
        }

        let Some(front) = frontmost() else { return out };
        let app_el = Ax::app(front.pid);
        let window = app_el.as_ref().and_then(|a| a.element("AXFocusedWindow"));
        let title = window.as_ref().and_then(|w| w.string("AXTitle"));
        let (url, private) = match (&window, BROWSERS.contains(&front.bundle_id.as_str())) {
            (Some(w), true) => find_url_and_private(w),
            _ => (None, false),
        };
        let key = FocusKey { bundle_id: front.bundle_id.clone(), title: title.clone(), url: url.clone(), private };
        let focus_changed = self.last_focus.as_ref() != Some(&key);
        if focus_changed {
            out.push(RawSample::Focus {
                t: now,
                bundle_id: front.bundle_id.clone(),
                app_name: front.app_name.clone(),
                title: title.clone(),
                url: url.clone(),
                private,
            });
            self.last_focus = Some(key);
        }

        // Do not even collect text from excluded/private windows.
        let resolved = apps::resolve(&front.bundle_id, &front.app_name, url.as_deref());
        let excluded = is_excluded(
            &self.exclusions,
            &ExclusionTarget {
                app_key: &resolved.key,
                bundle_id: Some(&front.bundle_id),
                url_host: resolved.url_host.as_deref(),
                window_title: title.as_deref(),
                is_private_window: private,
            },
        );
        let digest_due = focus_changed || self.last_digest_at.is_none_or(|t| t.elapsed() >= DIGEST_EVERY);
        if !excluded && digest_due && !self.idle {
            if let Some(w) = &window {
                let focused_secure = app_el
                    .as_ref()
                    .and_then(|a| a.element("AXFocusedUIElement"))
                    .is_some_and(|el| el.is_secure());
                let d = collect_digest(w);
                use std::hash::{Hash, Hasher};
                let mut h = std::collections::hash_map::DefaultHasher::new();
                (&d.headings, &d.labels, &d.text, focused_secure).hash(&mut h);
                let sig = h.finish();
                self.last_digest_at = Some(Instant::now());
                if focus_changed || self.last_digest_sig != Some(sig) {
                    self.last_digest_sig = Some(sig);
                    out.push(RawSample::Ax {
                        t: now,
                        bundle_id: front.bundle_id.clone(),
                        app_name: front.app_name.clone(),
                        headings: d.headings,
                        labels: d.labels,
                        text: d.text,
                        secure_field: focused_secure,
                    });
                }
            }
        }

        // clipboard: change events + coarse type only
        let (count, kind) = pasteboard_state();
        match self.last_change_count {
            Some(prev) if prev != count && !excluded => out.push(RawSample::Clipboard {
                t: now,
                bundle_id: front.bundle_id.clone(),
                app_name: front.app_name.clone(),
                content_kind: kind,
            }),
            _ => {}
        }
        self.last_change_count = Some(count);
        out
    }
}

impl CaptureSource for MacosSource {
    fn platform(&self) -> Platform {
        Platform::Macos
    }

    fn next_samples(&mut self, max_wait: Duration) -> Result<SourcePoll, CaptureError> {
        let now = Instant::now();
        if self.next_poll > now {
            std::thread::sleep((self.next_poll - now).min(max_wait));
            if Instant::now() < self.next_poll {
                return Ok(SourcePoll::Idle);
            }
        }
        self.next_poll = Instant::now() + POLL_EVERY;
        let samples = self.poll();
        Ok(if samples.is_empty() { SourcePoll::Idle } else { SourcePoll::Samples(samples) })
    }

    fn set_idle_threshold(&mut self, seconds: u32) {
        self.idle_threshold = seconds.max(1) as f64;
    }

    fn set_exclusions(&mut self, exclusions: &Exclusions) {
        self.exclusions = exclusions.clone();
    }
}

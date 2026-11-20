//! Windows capture: NOT IMPLEMENTED. This is the documented starting point for a port.
//!
//! Suggested Win32 mapping (via the `windows` crate):
//! - Frontmost app: `GetForegroundWindow` -> `GetWindowThreadProcessId` -> process image
//!   name (`QueryFullProcessImageNameW`) as the "bundle id" (e.g. `excel.exe`); add those
//!   to `bundleIds` in packages/schema/src/apps.ts (contract change, regenerate JSON).
//! - Window title: `GetWindowTextW`.
//! - Text digest + browser URL: UI Automation (`IUIAutomation::ElementFromHandle`, walk
//!   with a `TreeWalker`, collect `Text`/`Header` control types; skip elements with
//!   `IsPassword`; read the address bar `ValuePattern` of Edge/Chrome for the URL).
//! - Private windows: Edge/Chrome InPrivate/Incognito windows carry it in the title suffix.
//! - Clipboard: `GetClipboardSequenceNumber` polling + `IsClipboardFormatAvailable`
//!   (CF_UNICODETEXT/CF_BITMAP/CF_HDROP) for the coarse kind. Never `GetClipboardData`.
//! - Idle: `GetLastInputInfo`.
//! - Secrets: Windows Credential Manager (the `keyring` crate's `windows-native` feature).

use super::CaptureError;

pub struct WindowsSource;

impl WindowsSource {
    pub fn unsupported() -> CaptureError {
        CaptureError::Unsupported("windows: capture not implemented yet")
    }
}

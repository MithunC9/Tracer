# Agent decisions

One line each, newest at the bottom.

- Contract data (app table, default exclusions, LIMITS, ActivityEvent/IngestBatch JSON Schema) is generated from the built `@tracer/schema` into `core/src/contract/*.json` by `core/scripts/gen-contract.mjs` and embedded with `include_str!`; no hand-copied tables.
- At-rest encryption is per-row AES-256-GCM (event id as AAD) on bundled SQLite, not SQLCipher: no OpenSSL/SQLCipher build per platform; plaintext columns are limited to id/seq/ts/kind/status.
- Secrets: macOS Keychain via `keyring` (service `ai.tracer.agent`); 0600 files under `<data-dir>/secrets` in simulated mode and elsewhere.
- reqwest blocking + rustls; the agent loop runs on its own thread, Tauri async commands use `spawn_blocking`. Plain HTTP is only allowed to loopback.
- Event ids are UUIDv7 (time-ordered, still random); batch ids UUIDv4, persisted before sending so retries are idempotent.
- `digestHash` = sha256 of the normalized digest (trim, collapse whitespace, lowercase; headings/labels/text joined with U+001E, items with U+001F).
- Truncation to LIMITS happens after redaction (the schema caps are "after redaction"), on char boundaries.
- Redaction is sequential detectors over the progressively redacted string, ordered URLs -> PEM -> JWT -> key prefixes -> bearer -> assignments -> email -> IBAN -> card -> SSN -> phone -> long hex -> AWS-style 40-char -> entropy; bias is to over-redact.
- URLs inside free text become `host/[REDACTED:url_path]`; host-only URLs are kept and not counted. Credentials in URLs (`user:pass@`) count as a path.
- High-entropy backstop: token pieces (split on `-_.`) ≥16 chars, with a digit (or mixed case ≥24), Shannon ≥3.0, and not "wordy" (most letters in pronounceable runs). Hex ≥32 chars is always redacted (SHA-256 / full git SHAs included); UUIDs and short git hashes survive.
- Non-ASCII digits (full-width, Arabic-Indic, Devanagari, …) are folded to ASCII and zero-width chars stripped before detection.
- Exclusion port is literal, including substring title matching ("Embankment" matches "bank") and empty strings never matching.
- While an excluded window is frontmost, all ax/clipboard samples are dropped (not only those of the excluded app); idle events still pass (no app details).
- The macOS source also honours exclusions before collecting AX text (via `CaptureSource::set_exclusions`), and is not polled at all unless the agent is capturing.
- AX digest reads static text, headings and control labels only; never values of editable fields (that would be typed text) and never secure fields.
- Simulated time shift: speed 0 shifts by whole days so the replay ends on/before now (time of day preserved); speed > 0 starts the replay now. Recorded spacing is kept in timestamps at any speed.
- Auto-stop is fail-closed: `captureAllowed: false` from ingest triggers a config fetch; if that fails or says not paused, auto-stop. Restart only for a different auditId.
- Sent events are kept until the end of their local day for the "what left this device today" view; "today" is by event timestamp in local time.
- 413/400/422 split the batch in half; a single-event batch that is still refused is marked rejected locally so it cannot block the queue.
- The workspace package `@tracer/agent-ui` lives at `apps/agent/package.json` (pnpm-workspace only matches `apps/*`), with sources in `apps/agent/ui` and output in `apps/agent/dist`.
- UI fonts come from `@fontsource` packages, bundled; the agent window makes no network requests except Tauri IPC.
- The Tauri crate is a separate Cargo package (not a workspace with core) so core CI never needs WebKit.
- `core/macos-check` type-checks the macOS source for aarch64-apple-darwin from Linux by including the pure-Rust modules by path (the full crate needs the macOS SDK for SQLite/ring C code).
- Secret-shaped test literals are split with a `§` marker in `tests/hostile_corpus.json` and assembled with `concat!` in unit tests, so repository push protection never sees a credential-shaped string.
- Rust MSRV set to 1.85 (uses `Option::is_none_or`, `LazyLock`).

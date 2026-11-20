# Tracer agent

The desktop app that observes **your own** work for a 1–14 day audit and uploads a redacted
activity log. Tracer only observes your own work, on this computer, with your consent.

```
apps/agent/
  core/        tracer-core: Rust library + tracer-sim CLI. No Tauri/WebKit. Builds and tests on Linux.
  src-tauri/   Tauri 2 shell: menu-bar icon, capture thread, commands for the settings window.
  ui/          Settings window (React + Vite). Package @tracer/agent-ui (package.json at apps/agent).
```

Data path, in this order, with no step skippable:

```
capture source ─▶ exclude ─▶ redact ─▶ AppKey ─▶ ActivityEvent ─▶ encrypted SQLite ─▶ uploader ─▶ POST /v1/agent/events
 (macOS AX or      (apps,     (cards,              (schema v1)     (AES-256-GCM        (≤1000 events,
  simulated         domains,   keys, …)                             per row)            ≤2 MB, idempotent)
  replay)           titles,
                    private)
```

## What is captured, and what is not

| Captured (after exclusion and redaction) | Never captured |
|---|---|
| Frontmost app (bundle id → AppKey, display name) | Screenshots or screen recordings |
| Window title (redacted, max 256 chars) | Audio, camera |
| Browser **host only** (e.g. `docs.google.com`); the path is used on-device to tell Sheets from Docs, then dropped | Keystrokes, typed text, values of editable fields |
| Idle start/end (no input for N seconds) | Clipboard **contents** (only "it changed" + text/image/file/other) |
| Clipboard changed + coarse kind | Password/secure fields (skipped; a focused one drops the digest text) |
| Capped digest of visible static text, headings and control labels of the focused window (redacted; ≤40 items, ≤2000 chars) | Anything from excluded apps/sites/titles and private/incognito windows |
| Agent lifecycle: started, paused, resumed, stopped, auto-stopped, "an excluded window was active" (no name) | Full URLs, query strings, fragments |

Redaction (on device, before anything is written to disk) replaces spans with
`[REDACTED:<kind>]` and counts them per event: card numbers (Luhn, 13–19 digits with spaces,
dashes, dots, NBSP, full-width digits, zero-width tricks), SSNs, emails (incl. `[at]`/`[dot]`),
phone numbers (international, NANP, trunk-prefixed, `tel:`-style context), API keys and
tokens (Stripe, GitHub, GitLab, Slack, AWS, Google, Anthropic, OpenAI, npm, SendGrid,
JWTs, PEM private keys, `Bearer …`, `password=`/`token:` assignments, AWS-style 40-char
secrets), long hex and high-entropy tokens, IBANs (mod-97), and URL paths. The hostile corpus
(`core/tests/hostile_corpus.json`, 86 cases, plus `packages/fixtures/data/hostile-corpus.json`
when generated) checks both leaks and over-redaction of benign look-alikes (dates, versions,
order numbers, non-Luhn 16-digit ids, UUIDs, short git hashes).

Excluded by default: password managers, bank and health portals (from the app table), titles
containing incognito / private browsing / inprivate / password / bank / medical / therapy,
and private browser windows (always; cannot be turned off). An excluded stretch produces one
`capture_state: excluded_app_active` event with no app, title or host.

## Run it without a Mac: `tracer-sim`

Replays a fixtures `raw.jsonl` through the real path (simulated source → exclude → redact →
encrypted buffer → uploader). Uploads are labelled `platform: "simulated"`.

```sh
cargo build --release --manifest-path apps/agent/core/Cargo.toml
SIM=apps/agent/core/target/release/tracer-sim

# What would leave the device (no network):
$SIM --raw packages/fixtures/data/<persona>/raw.jsonl --dry-run --out events.json

# Pair with a code from the web app, store the token, and backfill a week ending today:
$SIM --api http://localhost:4000 --pair-code ABCD-EFGH --device-token-file .tracer/device-token \
     --raw packages/fixtures/data/<persona>/raw.jsonl --time-shift-to-now

# Reuse the token; replay live at 60x speed, uploading every 30 s:
$SIM --api http://localhost:4000 --device-token-file .tracer/device-token \
     --raw packages/fixtures/data/<persona>/raw.jsonl --time-shift-to-now --speed 60 --upload-interval 30
```

| Flag | Meaning |
|---|---|
| `--raw FILE` | RawSample JSONL (required). |
| `--api URL` | API base. Plain `http` only to localhost. Required unless `--dry-run`. |
| `--pair-code CODE` | Pair first (`XXXX-XXXX`, Crockford; case/`I`/`L`/`O` tolerant). |
| `--device-token-file F` | Read the device token; with `--pair-code`, write it (mode 0600). |
| `--device-name NAME` | Sent when pairing (default `tracer-sim`). |
| `--speed 0\|N` | 0 = as fast as possible (default); N = N× real time. |
| `--time-shift-to-now` | Speed 0: shift by whole days so the replay ends today, time of day kept. Speed > 0: first sample = now, timestamps compressed by the speed (they follow the wall clock). |
| `--data-dir DIR` | Buffer + secrets dir; default is a temp dir removed on exit. Reuse it to resume an interrupted upload. |
| `--dry-run --out FILE\|-` | Write the ActivityEvents that would be sent (JSON array), contact nothing. |
| `--exclusions FILE` | Exclusions JSON for dry-run (the server's list wins when online). |
| `--capture-until TS` | Dry-run only: simulate the audit window end (tests auto-stop). |
| `--upload-interval SECS` | Override `AgentConfig.uploadIntervalSeconds`. |
| `--max-failures N` | Give up the final flush after N consecutive failures (default 8). |

Output: logs on stderr; one JSON summary on stdout (`pipeline` counts, `upload` totals,
`pending`, `finalState`). Exit codes: 0 ok, 1 error, 2 usage, 3 the server does not allow
capture (no active audit / paused), 4 events left pending after the final flush.

Behaviour that matters for seeding: the simulator calls `GET /v1/agent/config` first and
refuses to replay unless `captureAllowed` is true. Events are stamped with the (shifted)
sample times; with `--time-shift-to-now` at speed 0 they span the days *before* now.

## Build and run on macOS

Requirements: Xcode command line tools, Rust ≥ 1.85, Node 22 + pnpm.

```sh
pnpm install
cd apps/agent/src-tauri
cargo install tauri-cli --version '^2' --locked   # once
cargo tauri dev                                    # runs the UI dev server + the app
cargo tauri icon icons/icon.png                    # once, before `cargo tauri build` (generates .icns)
cargo tauri build                                  # .app + .dmg
```

- `TRACER_API_URL` selects the API (default `http://localhost:4000`).
- `TRACER_SIMULATE_RAW=/path/raw.jsonl` runs the app on a real-time replay instead of observing
  the Mac (useful for UI demos).

### Permissions on macOS

- **Accessibility** (System Settings → Privacy & Security → Accessibility) — required. Used
  for window titles, the browser URL and the text digest. The app prompts on first start.
- Nothing else. No Screen Recording, Input Monitoring, Full Disk Access, camera or microphone.
- Secrets (buffer key, device token) live in the login Keychain, service `ai.tracer.agent`.

### Settings window without a Mac

```sh
pnpm --filter @tracer/agent-ui dev     # http://localhost:5174, mock data
pnpm --filter @tracer/agent-ui build   # -> apps/agent/dist (what Tauri loads)
```

## Storage and upload

- SQLite (bundled) at the app data dir, every event payload encrypted with AES-256-GCM
  (random nonce, event id as associated data). Plaintext columns: id, seq, timestamp, kind,
  upload status. The 256-bit key is in the Keychain (macOS) or `secrets/buffer-key` with mode
  0600 (simulated mode / other platforms; protects against other users, not against you).
- A batch's id is persisted before the request; after a crash the same batch (same id, same
  events) is re-sent and the server counts it as duplicates. Failures back off exponentially
  (2 s → 15 min, jittered). 413 / validation errors split the batch; a single invalid event is
  marked rejected locally so it cannot wedge the queue.
- Sent events stay until the end of their local day (for "What left this device today"), then
  are purged. Pending events are capped (500k) and dropped after 21 days, counted.
- **Auto-stop**: when `captureUntil` passes (wall clock or sample time) or the server answers
  `captureAllowed: false` without `paused`, capture stops, a `capture_state: auto_stopped`
  event is recorded, and the capture source is no longer polled. It only restarts for a
  different audit. A revoked device token (401/403) stops capture too.
- "Delete everything" wipes the database (then VACUUMs), the device token and settings. It
  calls nothing server-side; server data is deleted from the web Privacy page.

## Adding a platform

The platform-specific part is only a `CaptureSource` (see `core/src/capture/mod.rs`):

1. Add `core/src/capture/<platform>.rs` with a struct implementing `CaptureSource`
   (`next_samples(max_wait)` returns `RawSample`s; poll the OS on your own cadence, emit on
   change) behind `#[cfg(target_os = "...")]`. Keep a non-gated stub that returns
   `CaptureError::Unsupported` (as `windows.rs` does; it also lists the Win32/UI Automation
   calls to use).
2. Emit only: `Focus` (bundle-id-like app id, name, title, full URL for browsers, `private`),
   `Ax` (static text, headings, labels; never editable or secure field values; set
   `secureField` when a password field is focused), `Clipboard` (coarse kind only),
   `IdleStart`/`IdleEnd`. Do not filter or redact in the source — the pipeline does both —
   but honour `set_exclusions` by not even collecting text from excluded windows.
3. Map the platform's app ids to AppKeys by adding them to `bundleIds` in
   `packages/schema/src/apps.ts` (a contract change), then regenerate
   `core/src/contract/*.json` with `node apps/agent/core/scripts/gen-contract.mjs`.
4. Store secrets in the OS credential store (`secrets.rs`; the `keyring` crate covers
   Windows Credential Manager and Secret Service).
5. Wire it into `capture::platform_source` and add a row to this README.

| Platform | Status |
|---|---|
| macOS | Implemented (`capture/macos.rs`). Type-checked for `aarch64-apple-darwin`; not run on hardware in CI. |
| Simulated | Implemented, tested (replays `raw.jsonl`). |
| Windows | Stub with an implementation guide (`capture/windows.rs`). |
| Linux | Not supported; `platform_source` returns "unsupported platform, use simulated mode". |

## Tests

```sh
cargo test   --manifest-path apps/agent/core/Cargo.toml
cargo clippy --manifest-path apps/agent/core/Cargo.toml --all-targets -- -D warnings
# macOS source type-check from Linux:
rustup target add aarch64-apple-darwin
cargo clippy --manifest-path apps/agent/core/macos-check/Cargo.toml --target aarch64-apple-darwin -- -D warnings
pnpm --filter @tracer/agent-ui build && pnpm --filter @tracer/agent-ui test
```

Covered: redaction units, Luhn/IBAN, the hostile corpus (through `redact` and through the
whole pipeline), exclusion parity with `packages/schema/test/contract.test.ts`, event JSON
validated against JSON Schema generated from the Zod types and (when node and
`packages/schema/dist` exist) against Zod itself, buffer encryption (the SQLite file and WAL
contain no plaintext titles/hosts), idempotent re-send after a crash, backoff, batch splitting,
auto-stop (by sample time, by `captureUntil`, by `captureAllowed: false`), pause/resume from
config, token revocation, and `tracer-sim` end-to-end against a mock API.

The contract JSON in `core/src/contract/` is generated from `packages/schema`; regenerate after
schema changes (`pnpm --filter @tracer/schema build && node apps/agent/core/scripts/gen-contract.mjs`,
`--check` to verify).

## Known limitations

- **The macOS capture source has not been run on real hardware.** It is type-checked against
  the macOS target from Linux (`core/macos-check`), but AX behaviour differs per app and
  browser; the URL lookup (`AXURL` of the web area, address bar fallback) and private-window
  detection (label scan for "Incognito"/"Private") are best-effort and need verification on
  Chrome, Safari and Arc. Firefox exposes little via AX.
- **The Tauri shell has not been compiled** in this environment (no WebKit dev libraries on
  the Linux build host). It is kept small and uses only stable Tauri 2 APIs; expect minor
  fixes on first macOS build. Bundling needs `cargo tauri icon` to produce the `.icns`.
- The capture thread holds the agent lock during config polls and uploads, so a settings
  command can wait for a slow request (bounded by the 60 s HTTP timeout).
- Local exclusion edits are replaced by the server's list at the next config poll (the API has
  no device-side write route for exclusions); edit exclusions on the web for them to stick.
- High-entropy detection is a heuristic. Random tokens that look pronounceable can survive;
  some identifiers (e.g. UPS tracking numbers, 32+ char hex such as SHA-256 hashes and full
  git SHAs) are redacted.
- File-based secrets in simulated mode protect against other OS users only.
- Windows and Linux real capture are not implemented.

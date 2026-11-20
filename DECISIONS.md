# Decisions

One line each: what, and why. Newest at the bottom of each section. Overrides of the original tech brief are marked **[override]**.
Package sections were merged from the former per-package `DECISIONS.local.md` files; add new lines here, under the package's heading.

## Cross-cutting

- Zod 4 (not 3) as the contract library: current major, native `z.toJSONSchema`, and `fastify-type-provider-zod@7` requires it.
- TypeScript pinned to 5.9 instead of 7.x: the 7.x native compiler is new; ecosystem plugins (Next, drizzle-kit) are verified against 5.x.
- Vitest 3.2 for all TS packages: stable, fast, same runner everywhere.
- API contract is a TS route table (`packages/schema/src/routes.ts`); OpenAPI is emitted from it and the web client is typed from it. **[override-lite]** "Generated client" = a typed client derived from the same table rather than codegen from openapi.json; one source of truth, no generated files to drift. `docs/openapi.json` is still emitted and contract-tested.
- Full URLs never leave the device. The agent resolves an `AppKey` on-device (using host+path locally) and sends only `urlHost` + `appKey`.
- Scoring formula lives in `packages/schema/src/scoring.ts` (not analysis) so pipeline, validator and the web "show calculation" panel run identical code.
- Weekly hours use a calendar-week basis (`minutes / (daysObserved/7)`), not a 5-day work-week: simpler to explain, no assumptions about weekends.
- Reclaimable hours apply a fixed 0.7 capture-rate haircut: automation never removes all of the time (review, exceptions). Stated in methodology.
- Embeddings: local deterministic feature-hashing embedder (256 dims) by default, no external embedding API. Works offline, in CI, and keeps redacted text on our servers only. pgvector column is `vector(256)`.
- `CatalogEntry` is `.strict()` and has no commission fields; affiliate data is a separate registry joined after ranking. Makes commission-blind ranking a type-level property, plus a fuzz test.
- Web auth: short-lived access JWT in memory + rotating refresh token in httpOnly SameSite=Strict cookie, CSRF double-submit on the cookie-authenticated endpoints (`refresh`, `logout`). Agent uses an opaque device bearer token (hashed at rest).
- Tenant isolation uses Postgres RLS with `app.user_id` set per transaction; app role has no BYPASSRLS. Pre-tenant lookups (login, pairing, device token) go through SECURITY DEFINER functions.
- Envelope encryption: per-user DEK (AES-256-GCM) wrapped by `MASTER_KEY` from env. Deleting the wrapped DEK crypto-shreds residual copies.
- Agent is split into a Tauri-free Rust crate (`tracer-core`: capture trait, redaction, buffer, uploader, simulator) and the Tauri shell, so the core builds and tests on Linux CI without WebKit.
- Fixtures live in `packages/fixtures` (TS generator + committed JSON outputs + ground truth), consumed by pipeline tests, the agent simulator and the seed script.
- Fixture raw captures and the hostile redaction corpus contain synthetic secret-shaped strings; GitHub push protection blocks them, so they are generated at build time (deterministic, ~2s) and gitignored. Redacted events.json + ground truth are committed.

## Integration (agent -> API -> pipeline -> web)

- The API engine is `@tracer/analysis.runPipeline` behind `adaptRunPipeline` (one pg-boss job per stage), with real deps: catalog `recommendTools` + `recipeFor`, `@tracer/llm` narrate helpers, `validateReport`, local `hashEmbed`. The stub engine remains for unit/integration tests only.
- A fresh `LlmClient` per stage job; the narrate job stores its usage inside its own (encrypted) stage output (`llmUsage`) and later jobs read it back, so `report.generation` reflects the narration even though `publish` runs in another job/process.
- Engine version = hash(analysis `STAGE_VERSIONS`, resolved analysis config, glue version) + `provider:model`, so changing the LLM provider or model invalidates cached stage outputs.
- `PipelineDeps.allowedNumbers` (new, optional): analysis filled `allowedNumbers` with a broader list than the validator's "derivable" set, so every report built with real deps failed validation. The API injects `@tracer/llm`'s `allowedNumbersFor`/`allowedNumbersForSummary` (the validator's own definition); analysis keeps its local lists for standalone/eval runs.
- The publish stage runs `assertValidReport` on the final report; a failure throws, the job retries and is dead-lettered (audit `failed`). An unvalidated report is never stored.
- `pnpm verify:reports` also fails when the pipeline had to swap LLM prose for template prose (the first validation failed), not only when the final report fails.
- LLM cache: `llm_cache` rows per (user, key), AES-256-GCM with the user's DEK, AAD `llm_cache:<user>:<key>`, RLS like every tenant table, deleted with the account. Cache errors are misses, never stage failures.
- Episode embeddings are NOT written to `episode_embeddings`: `hashEmbed` vectors are bags of hashed tokens, recoverable with a dictionary, so plaintext pgvector rows would bypass per-user encryption. They already live in the encrypted `segment` stage output; the table stays for a future non-invertible embedder.
- `/v1/catalog` serves `@tracer/catalog`'s `CATALOG`.
- Demo data goes through the public HTTP API only (typed client), never SQL or service calls: seed, live agent and e2e test share `apps/api/src/scripts/demo.ts`.
- The seed's backdated window starts at the fixture's local-midnight `startsAt` shifted by the same whole days `tracer-sim --time-shift-to-now` uses (`floor((now - last sample) / 1 day)`); `lengthDays` is the smallest that keeps the window open now (6 for the 6-day bookkeeper data). Then the audit is finished early, which is a normal user action.
- Seed fallback without cargo: the fixture's committed, already-redacted `events.json`, shifted by the same days, posted to `POST /v1/agent/events` with a freshly paired device token (same endpoint, same checks).
- Seed is idempotent: a completed audit whose report is not from the old placeholder engine means done; `analyzing` is awaited; `failed` is re-run; a leftover open audit is finished first (one open audit per user).
- The seed starts its own in-process API (random port, job workers) unless `SEED_API_URL` is set, so `pnpm seed` works without a running server.
- Live demo: a second simulated device (token in `.tracer/live-device-token`, re-paired when revoked) replays `LIVE_PERSONA` (default founder) at 60x into the open audit (created if missing). Restarting `pnpm dev` replays again into the same audit.
- `tracer-sim` live replay (speed > 0 with `--time-shift-to-now`) now compresses timestamps by the speed. Keeping recorded spacing at 60x stamped events hours ahead of the wall clock and the API rejected them as `future_timestamp` (found running `pnpm dev`).
- `pnpm dev` Postgres order: already reachable (local install or a running container) -> `docker compose up -d --wait postgres` -> `docker start tracer-pg` -> stop with instructions. Cargo build always runs when cargo exists (incremental, ~1 s when unchanged).
- `pnpm dev` compacts the API's pino JSON into one line per request; set `NO_COLOR=1` to drop colours.
- docker-compose `api` runs with `NODE_ENV=development` by default because `.env.example` holds dev-only secrets that production mode rejects; production needs real secrets and `API_NODE_ENV=production`.
- The web image lives in `docker/web.Dockerfile` (not `apps/web`, which the web workstream owns).
- The e2e test is a vitest project in `apps/api` (`test/e2e`), sharing the integration DB setup. `pnpm test` runs it with the HTTP fallback; the CI `e2e` job builds `tracer-sim` and runs it through the real agent core.
- Planted-workflow recall in the e2e test is computed from the report's evidence intervals (the analysis eval rule, >= 50% of a finding's time inside one planted workflow), because pipeline internals are not exposed by the API.
- Left as known limitations (not needed for the demo; bookkeeper recall stays 100%): the default `bank` title keyword also excludes QuickBooks "Banking - <client>" windows (23 in the bookkeeper fixture); Google Slides and Microsoft Edge are missing from the app table.

## packages/fixtures

- Fixture audit window starts at each persona's LOCAL Monday 2026-11-02 00:00 (stored as UTC in `startsAt`) so audit days align with local days; for the UTC-8 founder a Z-midnight start would push Sunday evening out of the window.
- Unknown apps resolve to `other:<slug>`: browser sites use the host minus `www.` (e.g. `other:track.toggl.com`), native apps the slugified OS app name (e.g. `other:toggl-track`); a browser with no URL stays `browser`.
- `AppRef.name` for browser sites is the resolved app's display name (e.g. "Stripe Dashboard"), not the browser's name, so per-event names match the AppKey.
- `digestHash` = sha256 hex of `JSON.stringify([headings, labels, text])` after NFC + whitespace-collapse + trim on each string (post-redaction, post-truncation).
- Event ids are uuid v5 of `<persona>:<seq>` under a fixed fixture namespace; `seq` starts at 1 and is gap-free; first event is `capture_state: started`.
- Excluded stretch = from an excluded focus until the next non-excluded focus; ax/clipboard samples inside it are dropped, idle events are kept; reason is `private_window` or `exclusion_rule` (never names the app).
- Secure-field digests replace the whole `text` with `[REDACTED:password_field]`; headings/labels still go through normal redaction.
- Redaction runs before truncation; truncation never leaves a half placeholder.
- URL handling in free text: keep scheme+host, replace path/query/fragment with `[REDACTED:url_path]`, URL userinfo credentials with `[REDACTED:api_key]`.
- `key=value` / `password: x` assignments are redacted by context (api_key / password_field) even when the value has no recognisable shape.
- events.json is a JSON array with one event per line (compact but diffable); raw.jsonl is JSONL; both byte-deterministic.
- Generated data is committed; a test regenerates every persona and compares sha256 with the committed files.
- Build script builds @tracer/schema only if its dist is missing (scripts/ensure-schema.mjs); tests alias @tracer/schema to its source so they need no prior build.
- Hostile corpus items carry an extra informational `category` field besides `{input, mustNotContain, mustContain?}`.

## packages/analysis

- Package depends only on `@tracer/schema`; catalog/llm are reached through `PipelineDeps` ports; `fallbackDeps` makes it runnable standalone.
- `tsx` (dev only) runs the eval script so it can import the synthetic generator from `test/` without shipping it in `dist`.
- Eval CLI lives in `scripts/eval.ts`; the evaluation logic (`evaluatePersona`, `matchClusters`, `summarize`) is in `src/eval/evaluate.ts` and exported.
- `idle_start` is emitted after the threshold elapsed, so the threshold is trimmed from the session (`trimIdleLeadIn`).
- "Gaps > idle threshold" interpreted as: no idle signal + no events for > 30 min = agent off, credit at most one idle threshold. Shorter silences without idle_start are activity (the agent would have reported idle).
- `stopped`/`auto_stopped` cut sessions but are not counted as user-paused minutes; only `paused`→`resumed` is.
- Sub-3s focus that moves on (not returning) is folded into the previous window as well (passing through on Cmd-Tab).
- Browser focus with a host resolves to the site's AppKey, else `other:<host>`.
- Action evidence order: title > clipboard > digest > short visit (navigate) > app-category default. Calendar default is `read` (viewing ≠ scheduling).
- Session/episode ids are sha256-derived from the first event id / first session id (stable across reruns).
- Segmentation is greedy with explicit rules (gap, restart-of-first-step, same-app different doc, text similarity, clipboard carry, habit hand-offs with lift >= 2, interruption excision); interruptions are dropped from the episode, not just from the path.
- Interruption runs may not contain a clipboard copy (copying is task work).
- Episode similarity = 0.3 sequence (weighted LCS) + 0.2 app overlap + 0.5 text; average linkage at 0.55.
- Text similarity uses embeddings centred on the audit's mean episode embedding (cheap IDF substitute for hashed features).
- Clusters need mean pairwise (centred) text similarity >= 0.4; separated planted (>= 0.58) from coincidental app sequences (<= 0.38) on synth.
- App names/hosts are stopwords for the embedder: app identity is compared by the app-overlap term, not the text term.
- Findings need >= 2 distinct canonical steps and at least one non-passive step (read/navigate/unknown only = not reported).
- Workflow id signature = ordered distinct apps of the canonical path (actions excluded: they wobble between audits); collisions get `#2`, `#3` by first appearance.
- `totalMinutes` = sum of member episodes' active seconds (interruptions already excluded).
- Repeatability = mean sequence similarity of occurrences to the canonical path; rule-based share = mean verb weight over canonical steps (det 1 / neutral 0.5 / judgement 0); integration = 0.5 mean + 0.5 min of app automation scores; risk = capped sum of tag weights.
- Score inputs are rounded (2 dp) before outputs are computed, so `automationPotential(inputs)` etc. recompute exactly from the persisted inputs.
- Days observed = first-to-last active day inclusive, minus ≥90%-paused empty days, capped at days planned (calendar-week basis per DECISIONS.md).
- Summary total = sum of rounded per-finding reclaimable hours (so the shown calculation adds up).
- Narrator/recommender failures fall back to templates/generic recipe with a limitation note instead of failing the run; a failed number validation re-renders all prose from templates and re-validates.
- Stage cache key = sha256(stable JSON of {stage, stage version, full config, input}); cache hit emits `succeeded` with `attempts: 0`.
- The validate/publish stage hashes exclude `generatedAt` and usage so cached reruns are reusable.
- Synth eval seeds 11/29/47 were inspected while tuning; 101-108 are held out and included in the default eval run.
- [real fixtures] Action verbs use window title + digest *headings* only; digest body (code, email text) and button labels ("Export", "Compose" always on screen) produced false verbs. Labels are also dropped from `digestText`.
- [real fixtures] Findings need >= 2 distinct apps (`minPathApps`): single-app loops (inbox read/compose, coding) are ordinary work, not cross-tool workflows.
- [real fixtures] Meetings (app category `meetings`) are hard episode boundaries: a call can trigger a workflow but its time is not workflow time.
- [real fixtures] Focus blocks: a same-app run >= 10 min spanning >= 2 documents. Leaving or entering one needs clear text carry-over (centered cos >= 0.4) or a copy made on a short (< 10 min) hand-off visit just before; habits and copies out of the block do not count. Single-document long steps are not blocks.
- [real fixtures] Restart (= next repetition) requires the same first-step action on a new item; "same item" = title word Jaccard >= 0.6 (returning to the same PR is not a restart).
- [real fixtures] Different-document-in-same-app compares against all of that app's sessions in the task, and goes through the detour check before splitting.
- [real fixtures] Clipboard carry only from the immediately previous step and within 2 min (was: any copy in the task within 5 min).
- [real fixtures] Habit lift >= 3 (was 2).
- [real fixtures] Session text vectors are centered on the audit mean before segmentation comparisons (company/user names in every title).
- [real fixtures] Detours stay excluded from the episode (time, path, topic); `keepDetourTime` exists but is off: including them hurt overlap on fixtures and did not fix the calendar-step miss.
- [real fixtures] Tuned on bookkeeper/ops_manager/freelancer; agency_am/founder held out and checked twice (87.5/87.5, then 62.5/75 after an overfit round); final round used all 5. Recorded in EVAL.md.
- `eval --write` writes EVAL.latest.md (untracked); EVAL.md is curated by hand because it carries the tuning history.

## packages/catalog

- `build`/`typecheck` scripts build `@tracer/schema` first, so `pnpm --filter @tracer/catalog build` works on a clean checkout without Turbo; tests alias `@tracer/schema` to its source.
- fast-check (devDependency) for property tests, with fixed seeds so CI is reproducible.
- Fit score is additive with a 100-point budget (capability 50, integration 25, budget 10, platform 5, skill 5, effort 5); penalties are negative deltas, so the reasons sum to the score.
- Open-source preference is a penalty on closed tools (-8) rather than a bonus, to keep the 100 ceiling meaningful.
- Trigger capabilities weigh half of work capabilities: most platforms can be triggered somehow; the work steps decide fit.
- Generic `*` integrations earn 0.6 of the integration credit: screen/browser automation works but is brittle.
- Native features are hard-filtered unless their host app (`integrations[0]`) is in the workflow; otherwise Xero rules showed up for QuickBooks users.
- CRM-category tools are hard-filtered unless `crm_sync` is needed; otherwise HubSpot Free CRM ranked high for plain Gmail templates.
- "LLM tool" = category `ai_assistant`. Penalty -10 when the workflow needs no judgement and an eligible non-AI tool covers all capabilities. Logged under factor `capability` because `FitReason.factor` has no better value (contract proposal filed).
- Meeting recorders and email clients with AI features are not treated as LLM tools; their core job is deterministic.
- All four AI assistants share one capability set and identical reliability copy, so no vendor gets a quiet edge.
- `rank.ts` may only mention the word "affiliate" in `Omit<RankedTool, 'affiliate'>`; the static test strips that one string and checks the rest.
- `recommendTools(req, constraints, opts)` takes `entries` and `affiliates` overrides in `opts` so the fuzz test can inject random registries.
- Duplicate affiliate records for one entry: first in registry order wins.
- Default result limit is 5.
- Recipe template selection: highest `match` score, ties to the earlier template; specific finance templates listed first.
- Risk checkpoints come from a fixed `RISK_CHECKPOINTS` map applied to every recipe; templates add their own on top (deduplicated).
- Priced paid-tier entries use approximate notes (“~$20/mo”, "one-time licence") rather than exact prices.
- Added entries beyond the brief for platform coverage: AutoHotkey, Power Automate for desktop, Windows Task Scheduler, Buffer (social scheduling).

## packages/llm

- `@anthropic-ai/sdk` ^1.11: it sends API version 2026-10-21, which rejects `temperature`/`top_p`/`top_k` on every model, so `AnthropicProvider` never sends `temperature` (the field stays on the interface as advisory).
- Default model `claude-sonnet-5-5` (repo `.env.example`; current Sonnet per the claude-api skill); override with `ANTHROPIC_MODEL`.
- Structured output uses native `output_config.format: {type: "json_schema"}`, not a forced tool: Sonnet 5.5 / Opus 5.5 return 400 on forced `tool_choice`.
- Unsupported JSON-schema keywords (min/maxLength, minimum, pattern, ...) are stripped before sending; Zod re-validates them client-side and the repair retry handles violations.
- `output_config.effort` defaults to `low`: narration is short prose and thinking cannot be disabled on Opus 5.5 / adaptive by default on Sonnet 5.5. `effort: null` omits it for older models.
- Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) on by default for models that support it; a remaining refusal throws `LlmError{code:'refusal'}` (non-transient).
- System prompt gets `cache_control: ephemeral`. It is shorter than the minimum cacheable prefix today, so it will silently not cache until it grows; harmless and correct once it does.
- SDK `maxRetries: 0`; `LlmClient` owns retries (exponential backoff, full-ish jitter in [exp/2, exp], honours `retry-after`, default 4 attempts) so retries are counted once.
- Transient = 408, 409, 429, 5xx, connection errors and timeouts. Everything else fails fast.
- Repair retry: exactly one, on JSON parse failure or Zod failure, by appending the bad output and the issue list (never an assistant-last prefill).
- Narrate helpers use a refined Narrative schema (allowed numbers + banned words), so a hallucinated number triggers the repair retry before it ever reaches the validator. `enforce:false` exists only to test the validator.
- Cache key = sha256(stable JSON of [provider, model, system, prompt, JSON schema, namespace]); namespace = prompt version + guard mode. Cached values are re-validated on read.
- Usage `calls` counts every provider attempt including failed ones; cache hits add no tokens or cost.
- Cost: `input_tokens` is uncached input only; cost = in*input + out*output + cacheRead*read + cacheWrite*5m-write rate. Unknown model -> cost 0 and `costUnknown: true` + `unpricedModels`.
- Pricing resolves exact id, then longest prefix (dated suffix / `anthropic.` prefix). Opus 5.5 and Fable 5.2 cache reads use their published $0.20; others 0.1x input.
- Number rule: exact numeric equality, no rounding ("3.9" does not match 3.94). Trailing zeros and thousands separators are fine.
- Number words: zero, two..nineteen, tens, dozen, hundred, thousand are checked like digits; "one" and ordinal words (first, second) are ignored. The prompt forbids spelling numbers anyway.
- Digit ordinals ("3rd") are extracted and checked as integers; the prompt forbids them.
- Digits glued to a preceding letter ("Q3", "B2B") are identifiers and skipped; names from the report (finding label, path labels/appKeys, recipe title, tool names) are masked before extraction, so "1Password" or "Office 365" are fine.
- Percentages: "72%" matches an allowed 72 or an allowed 0.72.
- Findings' prose may use summary allowed numbers; summary prose may use only its own.
- Validator also checks that every allowedNumbers entry is derivable from computed data (`allowedNumbersFor`/`allowedNumbersForSummary`), so a tampered allow-list cannot whitelist a hallucination.
- Summary calculation convention: one `h/week` step per finding then a total step; helper `buildSummaryCalculation` produces it, validator checks the last step equals the summary total and the per-finding steps sum to it (rounded 0.1).
- avgMinutes tolerance 0.051 (allows 1-dp rounding); evidence minutes may differ from totalMinutes by max(1, 0.5 per occurrence) for per-occurrence rounding.
- Banned words are validator warnings, not errors (style, not truth); the narrate guard does reject them.
- MockProvider seeds variant choice with sha256(system + first user prompt), so repair retries regenerate the same clean text; faults: hallucinate_number, bad_json, schema_violation, transient_error, fatal_error, limited by `faultCount`.

## packages/ui and apps/web

- Components ship plain class-based CSS (`tr-*`, in `@layer components`) instead of Tailwind classes: the package works with or without Tailwind and the app never has to scan `node_modules`.
- Tailwind v4 support is a `@theme inline` preset (`theme.css`) that maps utilities onto `--tr-*` variables, so utilities follow light/dark/print automatically.
- `tokens.ts` is the single source; `tokens.css` is generated by a script and a test fails when it is stale.
- Two muted neutrals: graphite #5C564B (secondary text, field borders; 6.45:1) and rule #CDC4B2 (decorative hairlines only).
- Vermilion #E8431E is 3.54:1 on paper, so it is used only for marks and large numerals; text-safe vermilion `signalInk` #B5330F (5.40:1) carries error text and the destructive fill.
- Dark mode is "kraft" #1B1611 with cream ink #EDE5D3; vermilion brightens to #F0552F there.
- Print has its own colour set (ink on white) with raised specificity so an OS dark preference cannot leak into a printed report.
- Theme is `data-theme` on `<html>` or any subtree; no attribute follows the OS. Stored in localStorage `tracer-theme`, applied by an inline head script.
- Hero number uses Geist Mono per art direction (overrides the dataviz skill's "hero in the sans"); the decimal point is tucked in with negative margins to avoid the mono gap.
- No categorical colour anywhere in the charts: workflows are separated by rows (small multiples), the top finding is the only emphasised series (emphasis form, not categorical).
- Count-up server-renders the final value, hides the visual copy only when `html.js` is set and motion is allowed, and gives screen readers the final value in a visually hidden span.
- Ledger keyboard model: rows' label buttons use a roving tabindex (one tab stop), ↑ ↓ Home End move, Enter/Space toggles, → opens and ← closes.
- WeekStrip uses SVG with a stretched viewBox and `vector-effect: non-scaling-stroke` for rules; the accessible path is a toggle to a real table.
- Container queries (not viewport media queries) drive ledger, week strip, score, tools, finding and access-log layouts so they work in any column width.
- DIY option is always rendered first in ToolOptions, unranked, at the same type size as ranked tools; affiliate links get `rel="sponsored"` plus a visible label and the full disclosure line.
- Risk flags use outline tags, not vermilion: vermilion stays reserved for the top finding, destructive actions and errors.
- Sample report fixture computes every derived number with the schema's own scoring functions, so it cannot drift from the formula; a test checks narrative numbers are in `allowedNumbers`.
- Playwright is not a dependency; the screenshot script loads the globally installed one via `createRequire`.
- `@tracer/ui` imports `APP_BY_KEY` from `@tracer/schema` for app display names; this pulls the schema module into client bundles (acceptable for now, the web app imports it anyway).
- Next.js 16.0 (Turbopack) for `apps/web`; `turbopack.root` set to the monorepo root.
- `/design` and `/design/report` share a route-local `design.css`; nothing there is part of the package.

## apps/api

- Layering: HTTP handlers (`src/http/handlers.ts`) → services (`src/services`) → repositories (`src/repositories`). Composition root `src/container.ts` uses plain constructor injection, no DI library.
- Transactions: `Database.withTenant(userId)` is the only way to touch tenant tables. It runs `BEGIN; set_config('app.user_id', $1, true)`. AsyncLocalStorage lets nested calls for the same tenant join the ambient transaction.
- Repositories add explicit `user_id` filters as defence in depth; RLS is the actual boundary.
- Raw `pg.PoolClient` per transaction, with `drizzle({ client })` on top: gives one connection for Drizzle queries, the `unnest` bulk insert and pg-boss `send({ db })`, so job enqueue is transactional (outbox semantics).
- RLS, roles and SECURITY DEFINER functions are a hand-written migration (0002). drizzle-kit cannot express FORCE RLS or SECURITY DEFINER.
- Definer functions are owned by `tracer_auth`: NOLOGIN and BYPASSRLS, with column-level SELECT only on what the lookups need. They are not owned by the superuser. `tracer_app` has only EXECUTE.
- `deletion_receipts`: RLS on, insert-only policy, and no SELECT grant for the app role. The app can write receipts but never read them back.
- The `tracer_app` password is set by the migrate script from `DATABASE_URL`, never committed. Migrations run as `DATABASE_ADMIN_URL`.
- Email uniqueness uses `text` + unique index on `lower(email)` rather than citext. That needs no extension, and the contract already lowercases emails.
- Schema deviation: `pairing_codes.selector` (sha256 of the code's first half). Wrong guesses can then be counted per code and the code burned after 5. Constant-time compare of the full-code hash.
- Schema deviation: `events.redactions jsonb` (counts only, never content), for `GET /v1/me/captured` without decrypting events.
- Schema deviation: `ingest_usage(user_id, day, events)` counter table (migration 0003). The daily quota check is O(1); found with the load test.
- Schema additions: CHECK constraints on enums and ranges, a partial unique index "one open audit per user", and a few indexes.
- AES-256-GCM blobs are `[v1][iv12][tag16][ct]` with AAD binding each blob to its row (`events:<user>:<id>`, etc.). Stage-output AAD is content-addressed (`user:stage:inputHash`), so cache hits across runs decrypt.
- Subkeys come from MASTER_KEY via HKDF (receipt HMAC key). No extra secret env var.
- Unwrapped DEKs are cached in memory for 5 minutes per process; on account deletion the cached key is zeroed (`fill(0)`) and evicted.
- Pipeline: one pg-boss queue per stage (`pipeline-<stage>`) plus `pipeline-dead-letter` and `audit-sweep`. Retries use exponential backoff (`JOB_RETRY_*`).
- A stage job holds no transaction while the engine runs: tx1 marks running and does the cache lookup, the engine runs, then tx2 persists the output and enqueues the next stage.
- Input hash = sha256(engine.version, stage, events fingerprint, stable ctx, sha256 of each earlier output). Equal hash → cached output copied, stage state `skipped`.
- The engine port is `PipelineEngine.runStage(stage, input, ctx)`. `adaptRunPipeline()` wraps a whole-pipeline `runPipeline(events, ctx, deps, store)` into it, so either shape from `@tracer/analysis` is a one-line swap.
- pg-boss lives in its own schema owned by `tracer_app` (`createSchema: false`, `migrate: true` at boot). Each test file uses a unique schema for isolation.
- LISTEN/NOTIFY is on for stage queues (about 10x faster pipelines). The backstop poll equals the normal poll because retries are delayed jobs that NOTIFY does not announce.
- Time-driven audit transitions happen lazily on every read/ingest (`reconcile`) and in the per-minute sweep job. Behaviour never depends on the sweep having run.
- Rate limits: per-device token bucket and per-account login failure throttle are in-memory per process (documented). The daily quota is in Postgres and is the hard ceiling. Auth routes are also IP-limited via @fastify/rate-limit.
- Auth hooks run in `onRequest`, so an unauthenticated client cannot make the server read or parse a 2 MB body.
- Refresh/CSRF cookies are scoped to `Path=/v1/auth`, httpOnly, SameSite=Strict, Secure unless `COOKIE_SECURE=false`. A CSRF token is issued per session and rotated on refresh.
- Stage state `skipped` means "output reused from cache"; proposed as an explicit `cached` flag in the contract.
- `readyz` failure answers 503 with the ApiError envelope (`code: internal`, `details.checks`), not a Health body. Every non-2xx uses one envelope.
- Empty body with `content-type: application/json` is treated as no body (bodyless POSTs from browsers/k6). Non-empty bodies use Fastify's prototype-poisoning-safe parser.
- Audits may start up to 14 days in the past, for simulator backfill and offline buffers. A window that would already be over is rejected.
- Events stamped inside a window are accepted up to 24 h after it closes (late upload, `captureAllowed=false`). They feed the next pipeline run.
- Test DB: Testcontainers `pgvector/pgvector:pg16`, or `TEST_DATABASE_URL` (CI service container), where a throwaway database is created and dropped. Integration files run sequentially.
- k6 was installable, so the load test is k6 (no autocannon fallback).

## apps/agent

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
- Simulated time shift: speed 0 shifts by whole days so the replay ends on/before now (time of day preserved); speed > 0 starts the replay now and compresses timestamps by the speed (integration: keeping recorded spacing at 60x stamped events up to hours ahead of the wall clock, which the API rejects as `future_timestamp`).
- Auto-stop is fail-closed: `captureAllowed: false` from ingest triggers a config fetch; if that fails or says not paused, auto-stop. Restart only for a different auditId.
- Sent events are kept until the end of their local day for the "what left this device today" view; "today" is by event timestamp in local time.
- 413/400/422 split the batch in half; a single-event batch that is still refused is marked rejected locally so it cannot block the queue.
- The workspace package `@tracer/agent-ui` lives at `apps/agent/package.json` (pnpm-workspace only matches `apps/*`), with sources in `apps/agent/ui` and output in `apps/agent/dist`.
- UI fonts come from `@fontsource` packages, bundled; the agent window makes no network requests except Tauri IPC.
- The Tauri crate is a separate Cargo package (not a workspace with core) so core CI never needs WebKit.
- `core/macos-check` type-checks the macOS source for aarch64-apple-darwin from Linux by including the pure-Rust modules by path (the full crate needs the macOS SDK for SQLite/ring C code).
- Secret-shaped test literals are split with a `§` marker in `tests/hostile_corpus.json` and assembled with `concat!` in unit tests, so repository push protection never sees a credential-shaped string.
- Rust MSRV set to 1.85 (uses `Option::is_none_or`, `LazyLock`).

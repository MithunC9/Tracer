# Tracer

A time-boxed audit of how you actually work. You install a small desktop agent, let it observe
**your own** work for 1 to 14 days, and get a report: which multi-step tasks you repeat, how much
time they cost you each week, how much of that is realistically automatable, and how to fix each
one, starting with a do-it-yourself recipe and then tools ranked purely on fit.

> **The self-observation rule.** Tracer is only for observing your own work, on your own
> computer, with your consent. It must never be used to monitor another person: no employer,
> team or admin view exists, signup requires accepting this rule, and the agent can only be
> paired by the account holder.

## Run it

Requirements: **Node 22**, **pnpm 10**, and either **Docker** or a local **PostgreSQL 16 with
pgvector**. Optional: **Rust** (stable, 1.85+) for the simulated desktop agent.

```sh
pnpm install
pnpm dev
```

`pnpm dev` ([`scripts/dev.mjs`](scripts/dev.mjs)) brings everything up and is safe to re-run:

1. copies `.env.example` to `.env` if there is none (dev-only secrets);
2. uses Postgres if it is already reachable, otherwise runs `docker compose up -d postgres`
   (falls back to `docker start tracer-pg`), otherwise stops and tells you what to do;
3. builds the workspace packages (Turborepo, cached) and, if `cargo` is installed, the
   simulated agent `tracer-sim` (cached after the first build, which takes a few minutes);
4. applies migrations and seeds the demo account (below);
5. starts the API (`http://localhost:4000`, OpenAPI UI at `/docs`) and the web app
   (`http://localhost:3000`) with prefixed, coloured logs;
6. starts a live simulated agent: a second demo device replays a fixture persona at 60x into a
   currently capturing audit, so the live status view shows events arriving.

Ctrl-C stops everything. Flags: `pnpm dev --no-web`, `--no-agent`, `--no-seed`. Without Rust,
the live agent is skipped with a message and the seed uploads the fixture over HTTP instead.

**Demo login:** `demo@tracer.local` / `tracer-demo-password` (dev only). The account has one
completed audit whose report was produced by the real pipeline (fixture persona `bookkeeper`;
`SEED_PERSONA=founder pnpm seed` for another) and one audit that is capturing live.

Other commands:

| Command | What it does |
|---|---|
| `pnpm build` / `pnpm typecheck` / `pnpm test` | All packages (Turborepo). API integration and e2e tests need Postgres: Testcontainers, or `TEST_DATABASE_URL=postgres://tracer:tracer@localhost:5432/tracer` |
| `pnpm test:e2e` | End-to-end: real API, `tracer-sim` pairs and uploads a persona, pipeline publishes, report is checked |
| `pnpm verify:reports` | Build gate: the pipeline with production deps on every fixture; every report must pass the number validator |
| `pnpm eval` | Analysis accuracy on the fixtures (recall >= 80%, precision >= 75% or it fails) |
| `pnpm migrate` / `pnpm seed` | Migrations; demo data (needs no running API) |
| `docker compose up --build api` | API in a container (migrates, then starts); `--profile web` adds the web app |

## Architecture

```
 ┌──────────────────────── device (user's Mac) ─────────────────────────┐
 │ capture (trait: macOS AX / simulated)                                │
 │   → exclude (apps, domains, title keywords, private windows)         │
 │   → redact (Luhn cards, SSN, email, phone, keys/tokens, IBAN, pw)    │
 │   → encrypted SQLite buffer → batch (≤1000) → HTTPS upload (idempotent)│
 └───────────────────────────────────┬──────────────────────────────────┘
                                     │ IngestBatch (redacted ActivityEvents only)
 ┌───────────────────────────────────▼──────────────────────────────────┐
 │ apps/api (Fastify)  routes → services → repositories → Postgres(RLS) │
 │   events (AES-GCM per-user DEK)                                      │
 │   pg-boss jobs:  sessionize → segment → cluster → score →            │
 │                  recommend → narrate → validate → publish            │
 │   each stage output persisted (stage_outputs), input-hash cached     │
 └───────────────────────────────────┬──────────────────────────────────┘
                                     │ AuditReport (Zod-validated JSON)
 ┌───────────────────────────────────▼──────────────────────────────────┐
 │ apps/web (Next.js): landing, onboarding, live status, report,        │
 │   privacy center, settings — built on packages/ui                    │
 └──────────────────────────────────────────────────────────────────────┘
```

| Path | What |
|---|---|
| `packages/schema` | The contract: Zod types for events, API, pipeline, report, scoring formula, route table, typed client, OpenAPI |
| `packages/analysis` | Pipeline stages (pure functions) and the evaluation harness |
| `packages/catalog` | Tool catalog (57 entries), fit-only ranking, separate affiliate registry, recipe templates |
| `packages/llm` | Provider-agnostic LLM client (Anthropic + deterministic mock), narration, number validator + CLI |
| `packages/fixtures` | 5 synthetic personas × 7 days with planted workflows and ground truth |
| `packages/ui` | Design tokens and components |
| `apps/api` | HTTP API, auth, ingest, RLS, pg-boss pipeline, privacy endpoints, observability |
| `apps/web` | Product screens |
| `apps/agent` | `tracer-core` (Rust: capture trait, exclusion, redaction, encrypted buffer, uploader), `tracer-sim`, Tauri shell |

In the API, the pipeline engine is `@tracer/analysis` with production collaborators: catalog
ranking and recipes, LLM narration (`LLM_PROVIDER=mock` by default, `anthropic` with
`ANTHROPIC_API_KEY`), and the number validator. Every stage is one job with retries, backoff and
a dead-letter queue; its output is stored encrypted and reused when its input hash repeats. More
in [ARCHITECTURE.md](ARCHITECTURE.md); every non-obvious choice is one line in
[DECISIONS.md](DECISIONS.md); status in [PROGRESS.md](PROGRESS.md).

## Privacy model

**Captured** (after exclusion and redaction, on the device): the frontmost app, its window title
(redacted, capped), the browser **host only**, idle start/end, "the clipboard changed" plus a
coarse kind, a capped digest of the visible static text and headings of the focused window
(redacted), and agent lifecycle events. Details:
[apps/agent/README.md](apps/agent/README.md#what-is-captured-and-what-is-not).

**Never leaves the device**: screenshots, audio, keystrokes or typed text, values of editable or
password fields, clipboard contents, full URLs (paths, queries, fragments), and anything from an
excluded app, site, title or private/incognito window.

- **Redaction** happens on the device before anything is written to disk: card numbers, SSNs,
  emails, phone numbers, API keys and tokens, IBANs, long hex and high-entropy strings, URL
  paths. Counts (never contents) of what was redacted travel with each event.
- **Exclusions**: password managers, banking and health portals, private windows (always), and
  title keywords by default; the user edits the list on the web, and the server re-applies it
  as a second line of defence.
- **Encryption at rest**: every event payload, stage output, report and cached LLM response is
  AES-256-GCM encrypted with a per-user data key, wrapped by a master key; the agent's local
  buffer is encrypted too.
- **Isolation**: Postgres row-level security (FORCE) on every tenant table; the API's database
  role cannot bypass it. Every read or write of user data is in an access log the user can see.
- **Export and delete**: `GET /v1/me/export` returns everything as JSON in a zip;
  `DELETE /v1/me` hard-deletes all rows in one transaction, shreds the data key and returns an
  HMAC-signed receipt with per-table counts.

Security controls map to OWASP ASVS L2 in [apps/api/SECURITY.md](apps/api/SECURITY.md).

## Honesty rules for the report

- **Numbers come from code, never from the model.** Every figure is computed by the scoring
  formula in `packages/schema/src/scoring.ts`. The LLM writes prose only, and may mention only
  numbers on the finding's allow-list. The validator recomputes every score and rejects any
  untraceable number. In the API a report that fails validation is never published. In CI,
  `pnpm verify:reports` runs the full pipeline on every fixture and fails on any mismatch.
- **Recommendations are ranked on fit only.** `CatalogEntry` has no commission fields (enforced
  by the type and a fuzz test). Affiliate links live in a separate registry and are attached
  after ranking, so they cannot change the order. They are labelled and use `rel="sponsored"`.
  The do-it-yourself recipe is always shown first. Where a workflow needs no judgement, AI
  tools are penalised in favour of deterministic ones.
- **Estimates are conservative and explained.** Reclaimable time applies a 0.7 capture-rate
  haircut (people still review and handle exceptions), and the calculation is shown step by step.

## Extending

- **Add a catalog entry:** [packages/catalog/README.md](packages/catalog/README.md#adding-a-catalog-entry).
- **Add a platform capture implementation (Windows, Linux):** [apps/agent/README.md](apps/agent/README.md#adding-a-platform).

## Evaluation

The analysis pipeline on the 5 fixture personas (`pnpm eval`; method and history in
[packages/analysis/EVAL.md](packages/analysis/EVAL.md)):

| | planted | matched | reported | correct | recall | precision |
|---|---:|---:|---:|---:|---:|---:|
| fixtures, all 5 personas | 20 | 19 | 21 | 19 | **95.0%** | **90.5%** |
| synthetic generator, 3 personas × 11 seeds | 110 | 90 | 93 | 90 | 81.8% | 96.8% |

Read these honestly. The fixture numbers are **in-sample**: the last tuning round used all five
personas. The last true held-out check (tuning on 3 personas, testing on 2) scored
**87.5% recall / 87.5% precision** in round 1. A second look at the same held-out pair scored
62.5% / 75% because round 2 overfit. Expect lower numbers on real people's data. The fixtures
are synthetic and were written by the same team that wrote the pipeline.

The end-to-end test runs the same check through the product: the Rust agent core uploads a
persona, and the API pipeline (real deps, mock LLM) must find at least 80% of its planted
workflows. bookkeeper and agency_am both find 4 of 4.

## Load test

Ingest, measured with k6 on one 4-vCPU box with API, Postgres and k6 sharing the CPU
([apps/api/load/RESULTS.md](apps/api/load/RESULTS.md)):

| Run | Devices | Events/batch | Events accepted/s | p95 | Errors |
|---|---:|---:|---:|---:|---:|
| A | 20 | 100 | 14,109 | 222 ms | 0% |
| B | 10 | 1000 | 21,135 | 315 ms | 0% |
| C (default per-device limits) | 5 | 100 | 1,107 | 21.6 ms | 95% `429`, by design |

A real agent sends one batch of roughly 100 to 300 events every 5 minutes.

## Known limitations

- **The macOS capture source has never run on real hardware.** It compiles and type-checks for
  the macOS target from Linux; AX behaviour per app and browser is unverified.
- **The Tauri desktop shell has not been compiled** in this environment (no WebKit libraries).
  Windows and Linux capture are not implemented. The simulated agent is the demo path.
- **Docker images are unverified.** Neither `apps/api/Dockerfile` nor `docker/web.Dockerfile`
  could be built here, because image builds have no network. `docker-compose.yml` passes
  `docker compose config`, and its `postgres` service was started, migrated and seeded.
- **Pipeline accuracy is in-sample** on synthetic data (see Evaluation). Known misses: a
  PR → terminal → Linear workflow with no shared words between steps, and short calendar detours.
- **The mock LLM is the default.** It writes deterministic template-like prose. The Anthropic
  provider is implemented and tested live only when `ANTHROPIC_API_KEY` is set.
- **Single region, single process.** Rate limiters are in-memory per API process. There is no
  KMS: the master key is an env secret, and key rotation is designed but not implemented.
- **No MFA, password reset or email verification.**
- **Default exclusions are blunt.** The title keyword `bank` also excludes QuickBooks
  "Banking" screens (23 windows in the bookkeeper fixture). Google Slides and Microsoft Edge are
  not in the app table yet, so they resolve to generic `other:` / browser keys.
- **The agent redactor misses cases in the fixtures' hostile corpus.** When
  `packages/fixtures/data/hostile-corpus.json` is generated, `cargo test` (test
  `fixtures_hostile_corpus_if_present`) shows 5 leaks and 1 over-redaction. The leaks are a card
  number glued to letters, a dotted TIN, a Spanish IBAN, an AWS secret in an assignment, and a
  base64 session token. The over-redaction is a GitHub PR URL path. The agent's own 86-case
  corpus passes. CI does not generate the fixtures corpus for the agent job, so it does not
  catch this. Not fixed yet.
- Restarting `pnpm dev` replays the live persona again into the same live audit, so its counts
  include every replay.

# Architecture

Tracer is a time-boxed workflow audit. It is **only for self-observation**: the person installs it on their own machine, consents, and reads their own report.

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

## Packages

| Path | Owns | Depends on |
|---|---|---|
| `packages/schema` | **The contract.** Zod types for events, API, pipeline stages, report, scoring formula, catalog types, route table, typed client, OpenAPI emitter. | zod |
| `packages/analysis` | Pure pipeline stage functions + evaluation against ground truth. | schema, catalog, llm |
| `packages/catalog` | 40+ tool entries, affiliate registry (separate), ranking engine, recipe templates. | schema |
| `packages/llm` | Provider-agnostic client (Anthropic + deterministic mock), structured output, retries, cache, cost accounting, number validator. | schema |
| `packages/fixtures` | 5 synthetic 7-day personas with planted workflows + ground truth. | schema |
| `packages/ui` | Design tokens and primitives (ledger table, finding card, week strip, stat figure). | — |
| `apps/api` | HTTP API, auth, ingest, RLS, jobs, privacy endpoints, observability. | schema, analysis, catalog, llm |
| `apps/web` | Product screens and `/design`. | schema, ui |
| `apps/agent` | Tauri 2 app; `tracer-core` Rust crate (capture trait, redaction, buffer, uploader, simulator). | contract via JSON |

## Contracts (change only deliberately)

1. **ActivityEvent** (`schema/src/events.ts`): the only data that leaves the device. Discriminated on `kind`. No screenshots, keystrokes, clipboard contents or full URLs. Event `id` is the idempotency key.
2. **Route table** (`schema/src/routes.ts`): every endpoint, its auth mode, and request/response schemas. API handlers are registered against it; OpenAPI (`docs/openapi.json`) and the web client derive from it.
3. **Pipeline stage outputs** (`schema/src/pipeline.ts`): `FocusSession[] → TaskEpisode[] → WorkflowCluster[] → ScoredCluster[] → AuditReport`.
4. **Scoring** (`schema/src/scoring.ts`): weights and formula; also used by the web app to show the calculation.
5. **Catalog** (`schema/src/catalog.ts`): `CatalogEntry` has no commission fields (strict). `rank(requirements, entries, constraints)` cannot see affiliate data.
6. **AuditReport** (`schema/src/report.ts`): numbers computed by code; narrative prose must only mention numbers in `allowedNumbers`.
7. **DB** (`apps/api/db/schema-draft.sql`): tables, RLS policy shape, encryption columns.

## Pipeline

| Stage | Input | Output | Notes |
|---|---|---|---|
| sessionize | events | FocusSession[] | idle gaps cut sessions; <3s alt-tab flicker collapsed |
| segment | sessions | TaskEpisode[] | split on long gaps / topic shift (embedding cosine) |
| cluster | episodes | WorkflowCluster[] | path-signature + sequence similarity + embedding; stable `wf_` id from canonical path |
| score | clusters | ScoredCluster[] | `scoring.ts` formula, all inputs persisted |
| recommend | scored | + recipe, ranked tools | catalog ranking; affiliate attached after |
| narrate | findings | narrative prose | LLM (mock offline); numbers forbidden unless allowed |
| validate | report | pass/fail | rejects any untraceable number |
| publish | report | stored report | audit → `complete` |

Jobs run on pg-boss with retries + exponential backoff, a dead-letter queue, and per-stage status at `GET /v1/audits/:id/pipeline`.

## Security model (summary)

- Data minimisation on device (exclude → redact → only then persist).
- TLS in transit; AES-256-GCM at rest with per-user DEKs wrapped by a master key.
- Postgres RLS with FORCE on every tenant table; API role cannot bypass it.
- Argon2id passwords; 15-min access JWT; rotating refresh tokens with reuse detection; revocable device tokens.
- Audit log of every read/write of user data, visible to the user.
- `DELETE /v1/me` hard-deletes and returns an HMAC-signed receipt of rows deleted per table.

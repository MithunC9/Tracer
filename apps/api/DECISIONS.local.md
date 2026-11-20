# apps/api decisions

One line each, newest at the bottom.

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

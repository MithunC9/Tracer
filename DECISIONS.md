# Decisions

One line each: what, and why. Newest at the bottom. Overrides of the original tech brief are marked **[override]**.

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

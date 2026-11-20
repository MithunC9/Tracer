# Progress

## Done
- Phase 0: monorepo scaffold, `packages/schema` contract, OpenAPI, DB draft, ARCHITECTURE/DECISIONS, CI.
- `packages/llm`: Anthropic + deterministic mock provider, structured output, retries, cache, cost accounting, number validator + CLI (70 tests).
- `packages/catalog`: 57 entries, fit-only ranking, commission-independence fuzz test, 15 recipe templates (112 tests).
- `packages/fixtures`: 5 personas × 7 days, planted workflows + ground truth, reference redactor, hostile corpus (149 tests). Raw captures generated at build (secret-shaped strings).
- `packages/analysis`: sessionize → segment → cluster → score → report, stage caching, eval. **Real fixtures: recall 95.0%, precision 90.5%** (in-sample; held-out round 1 was 87.5%/87.5%, see `packages/analysis/EVAL.md`).
- `apps/agent`: `tracer-core` (capture trait, redaction, exclusions, encrypted buffer, uploader, auto-stop), `tracer-sim` CLI, Tauri shell (uncompiled here), settings UI.

- `apps/api`: Fastify API, RLS, envelope encryption, pg-boss pipeline, privacy endpoints, ASVS L2 map, k6 load test (14-21k events/s).
- `packages/ui` + `/design`: design system.
- **Integration**: real analysis engine in the API (catalog + LLM deps, encrypted per-tenant LLM cache, publish gated by the number validator); `pnpm dev` one-command stack (Postgres via compose, migrate, seed, API, web, live simulated agent); `docker-compose.yml`; seed through `tracer-sim` against a backdated audit (HTTP fallback); end-to-end test (agent -> API -> pipeline -> report, planted-workflow recall >= 80%); `pnpm verify:reports` + `pnpm eval` in CI; CI `e2e` job with the Rust agent; decisions merged into `DECISIONS.md`.

## In flight
- Phase 2: web app screens (`apps/web`) against the live API (`NEXT_PUBLIC_API_URL`).

## Next
- Fix the agent redactor misses found by the fixtures hostile corpus (README, Known limitations), and generate that corpus in the agent CI job.
- Default exclusions: `bank` keyword over-excludes QuickBooks "Banking"; add Google Slides / Microsoft Edge to the app table (regenerate fixtures + agent contract).
- Verify the Docker images on a networked machine.
- Phase 3: security, QA, design critic, product-honesty reviews.

## Cut / deferred
- macOS capture source compiled/type-checked only; never run on real hardware in this environment.
- Tauri shell not compiled here (no WebKit in container).
- Episode embeddings are not written to pgvector (plaintext, invertible hashed-token vectors); they stay inside the encrypted stage output.

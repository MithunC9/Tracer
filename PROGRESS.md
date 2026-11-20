# Progress

## Done
- Phase 0: monorepo scaffold, `packages/schema` contract, OpenAPI, DB draft, ARCHITECTURE/DECISIONS, CI.
- `packages/llm`: Anthropic + deterministic mock provider, structured output, retries, cache, cost accounting, number validator + CLI (70 tests).
- `packages/catalog`: 57 entries, fit-only ranking, commission-independence fuzz test, 15 recipe templates (112 tests).
- `packages/fixtures`: 5 personas × 7 days, planted workflows + ground truth, reference redactor, hostile corpus (149 tests). Raw captures generated at build (secret-shaped strings).
- `packages/analysis`: sessionize → segment → cluster → score → report, stage caching, eval. **Real fixtures: recall 95.0%, precision 90.5%** (in-sample; held-out round 1 was 87.5%/87.5%, see `packages/analysis/EVAL.md`).
- `apps/agent`: `tracer-core` (capture trait, redaction, exclusions, encrypted buffer, uploader, auto-stop), `tracer-sim` CLI, Tauri shell (uncompiled here), settings UI.

## In flight
- `apps/api` (backend-core), `packages/ui` + `/design` (design system).

## Next
- Phase 2: web app screens; integration (`pnpm dev`, Docker Compose, seed via tracer-sim).
- Phase 3: security, QA, design critic, product-honesty reviews.

## Cut / deferred
- macOS capture source compiled/type-checked only; never run on real hardware in this environment.
- Tauri shell not compiled here (no WebKit in container).

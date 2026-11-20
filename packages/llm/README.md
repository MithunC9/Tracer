# @tracer/llm

The LLM writes prose; code computes every number. This package holds the provider-agnostic client, the narration helpers the pipeline's `narrate` stage calls, and the report validator that rejects any untraceable number.

## Use

```ts
import { createLlmClient, narrateFinding, narrateSummary, allowedNumbersFor, validateReport } from '@tracer/llm';

const llm = createLlmClient(); // LLM_PROVIDER=mock (default) | anthropic

const allowedNumbers = allowedNumbersFor({ metrics, score, path, recipe });
const narrative = await narrateFinding(llm, {
  label, path, metrics, score, recipeTitle: recipe.title,
  topToolNames: tools.slice(0, 3).map((t) => t.name), allowedNumbers,
});

llm.usage(); // { calls, cacheHits, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, costUnknown, unpricedModels }

const result = validateReport(report); // { passed, checkedNumbers, errors, warnings }
```

Build `summary.calculation` with `buildSummaryCalculation(findings)` and the summary's allow-list with `allowedNumbersForSummary(...)`; the validator checks both conventions.

## Environment

| Var | Default | |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` is offline and deterministic |
| `ANTHROPIC_API_KEY` | | never logged; the provider does not store it |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | |

## Pieces

- `LlmProvider` interface; `AnthropicProvider` (official SDK, native JSON-schema structured output, cached system prompt, refusal fallback, timeouts) and `MockProvider` (seeded prose from the facts in the prompt; `faultMode` for tests).
- `LlmClient.generateStructured({ schema, system, prompt, task, cacheKey? })`: Zod → JSON Schema, parse + validate, one repair retry, exponential backoff with jitter on 408/409/429/5xx/timeouts, pluggable `LlmCache` (in-memory LRU default), token and cost accounting.
- Narration: `narrateFinding`, `narrateSummary`. The output schema refuses numbers outside `allowedNumbers` and banned words, so violations get repaired before they reach the report.
- Validator: `validateReport`, `assertValidReport`, CLI `tracer-validate-report report.json [--json]` (exit 1 on failure, 2 on IO error).

Number rules (exact match, no rounding; masks for names with digits; how ordinals, percentages and number words count) are in `src/numbers.ts` and the root `DECISIONS.md` (packages/llm).

## Tests

`pnpm test` builds first (the CLI test runs the compiled binary). The live Anthropic test runs only when `ANTHROPIC_API_KEY` is set.

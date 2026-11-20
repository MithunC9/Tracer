# @tracer/llm decisions

One line each, newest at the bottom.

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

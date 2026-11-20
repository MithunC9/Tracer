# @tracer/fixtures

Deterministic synthetic capture data for Tracer: five 7-day personas, each with pre-redaction
raw capture, agent-shaped redacted events and ground truth for the planted recurring workflows.
Plus a hostile redaction corpus shared with the Rust agent.

```
pnpm --filter @tracer/fixtures generate   # rebuild + rewrite data/ (byte-identical on rerun)
pnpm --filter @tracer/fixtures test
FIXTURE_PERSONAS=bookkeeper pnpm --filter @tracer/fixtures test   # narrow while iterating
```

## Files (`data/<persona>/`)

| File | Shape | Notes |
|---|---|---|
| `raw.jsonl` | one `RawSample` per line (`schema/src/raw.ts`), time-ordered | Device-local, **pre** exclusion/redaction: full URLs, private windows, password managers, bank portals, planted fake PII/secrets. Input for the agent simulator. |
| `events.json` | `ActivityEvent[]`, one event per line | What the agent would upload: `DEFAULT_EXCLUSIONS` applied (one `capture_state: excluded_app_active` per excluded stretch), AppKey resolved, host only, reference redaction with `redactions` counts, truncation to `LIMITS`, `digestHash`, uuid v5 ids, monotonic `seq`. |
| `ground-truth.json` | `GroundTruth` | Planted workflows: path (`appKey` + `ActionVerb`), exact occurrence start/end, minutesPerWeek; `distractors` lists the deliberate noise. |
| `data/hostile-corpus.json` | `{ input, mustNotContain, mustContain?, category }[]` | ≥60 redaction cases (cards incl. Luhn-fail negatives, SSNs, emails, intl phones, IBAN DE/GB/FR/NL/CH/ES, provider keys, JWTs, opaque tokens, URL creds/paths, benign look-alikes). |

All secrets are fake. Every occurrence `start` is the time the first step's app was focused; `end` is when the last step was left. Interruptions (Slack pings, mail peeks) that happen *inside* an occurrence are included in its span.

## API (`src/index.ts`)

`PERSONAS`, `loadEvents(p, {validate?})`, `loadRaw(p)`, `loadGroundTruth(p)`, `loadHostileCorpus()`, `redact(text) → { text, counts }`,
`rawToEvents(persona, raw)`, `digestHash`, `resolveApp`, `DATA_DIR`, `personaPaths(p)`, `HOSTILE_CORPUS_PATH`.

## Personas (audit window = local Monday 2026-11-02 00:00 for 7 days, stored in UTC)

| Persona | Who / TZ | Planted workflows (occurrences) |
|---|---|---|
| `freelancer` | Designer/dev, Berlin UTC+1, Arc | Toggl → Xero invoice → email PDF (4); Figma export → Drive upload → Slack link (5); GitHub PR review → terminal test → approve (6); client feedback email → Linear issues → reply (5) |
| `ops_manager` | DTC ops, Chicago UTC-6, Chrome | Zendesk ticket → Shopify order lookup → macro reply (14); Shopify inventory export → Sheets reorder → email PO (4); return email → Shopify refund → Sheets log (7); Shopify analytics → Sheets → Slack summary (5) |
| `bookkeeper` | Bookkeeper, New York UTC-5, Chrome | Stripe payouts → export CSV → clean in Sheets → QuickBooks deposits (5); Expensify review → approve → QuickBooks categorize (6); vendor bill email → PDF → BILL entry → approve (7); QuickBooks P&L → Excel pack → email client (3) |
| `agency_am` | Agency account manager, London UTC+0, Chrome | HubSpot metrics → Google Docs report → email client (5); Canva posts → approval email → Asana (6); call notes in Notion → Asana tasks → recap email (6); Mailchimp stats → Sheets tracker (8) |
| `founder` | Solo SaaS founder, San Francisco UTC-8, Chrome | LinkedIn lead → HubSpot → Calendly link → email (12); Intercom → GitHub issue → reply (8); Stripe MRR → Sheets → Slack (5); GitHub review/merge → terminal deploy → Linear (4) |

Realism knobs: per-occurrence step-duration variation, optional (skipped) steps, occasional
step reordering, interruptions between steps, <3s alt-tab flicker, lunch/coffee idle gaps,
meetings, long deep-work blocks in the same apps the workflows use, light weekends.

## How it works

`src/engine.ts` simulates each day (anchored workflows/meetings/lunch, filled with weighted
noise) on a seeded `Rng` (`src/prng.ts`, no `Math.random`). `src/convert.ts` is a reference
agent pipeline (exclude → resolve → redact → truncate → hash). `src/redact.ts` is the reference
redactor; overlapping detector matches resolve by fixed priority.

## Why `raw.jsonl` and `hostile-corpus.json` are not committed

They contain synthetic, non-functional strings shaped like real credentials (Stripe, Slack, Shopify, GitHub, AWS keys) so the redactor can be tested. GitHub push protection rightly blocks such strings, so these files are generated deterministically by `pnpm --filter @tracer/fixtures build` (≈2s) instead. The redacted `events.json` and `ground-truth.json` files are committed.

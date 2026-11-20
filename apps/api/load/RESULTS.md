# Ingest load test results

Script: `apps/api/load/ingest.k6.js` (k6 v0.54.0). Measured 2026-11-20 on the dev box.

## Setup

- 4 vCPU, 15 GB RAM. API (`node dist/main.js`, `NODE_ENV=production`, `LOG_LEVEL=info`, one
  process, pg-boss workers running), Postgres 16 + pgvector (Docker) and k6 **all on the same
  machine**, so the numbers are a lower bound for a real deployment.
- Throughput runs raise the abuse limits so they measure the pipeline, not the limiter:
  `INGEST_RATE_CAPACITY=1000000 INGEST_RATE_REFILL_PER_SEC=100000 USER_DAILY_EVENT_QUOTA=100000000`.
- One user per device (production shape). Every request: device-token lookup (SECURITY DEFINER),
  tenant transaction with `SET LOCAL app.user_id`, per-user advisory lock, Zod validation of
  every event, server-side exclusion check, AES-256-GCM encryption of every payload, one
  `unnest` bulk insert with `ON CONFLICT DO NOTHING`, batch-result row, quota counter upsert,
  access-log row. Every 10th request replays an earlier batch (idempotent path).

## Results

| Run | VUs (devices) | Events/batch | Duration | Requests/s | **Events accepted/s** | p50 | p95 | max | Errors |
|---|---|---|---|---|---|---|---|---|---|
| A | 20 | 100 | 60 s | 157.9 | **14,109** | 89 ms | 222 ms | 484 ms | 0 % |
| B | 10 | 1000 (max) | 45 s | 24.2 | **21,135** | 150 ms | 315 ms | 609 ms | 0 % |
| C (default limits) | 5 | 100 | 20 s | 277.6 | 1,107 | 4.5 ms | 21.6 ms | 128 ms | 95 % 429 by design |

Run A: 859,400 events stored, 944 replayed batches. Run B: 976,000 events. Postgres held
1.84 M events (888 MB with indexes) after A+B, and throughput did not degrade over the runs.
Run C uses the default per-device bucket (capacity 30, refill 1/s): after the burst each device
gets about 1 batch/s and the rest are rejected with `429 rate_limited` and `Retry-After`. That
is the intended behaviour. A real agent uploads every 5 minutes.

## What changed because of this test

1. **First run: 4,130 events/s, p95 715 ms.** All 20 devices belonged to one user, so the
   per-user advisory lock serialized every request. The per-user lock is intentional (it makes
   quota and batch idempotency race-free), so the test now uses one user per device.
2. **The quota check counted today's events on every batch** (`count(*)`, O(events today)). Its
   cost grew as the table filled. Replaced by an `ingest_usage(user_id, day)` counter row
   (migration 0003), which is O(1).
3. **Bodyless POSTs with `content-type: application/json` were rejected with 400** (found while
   writing the k6 setup). An empty JSON body is now treated as no body.

## Capacity reading

A user's agent sends one batch every 5 minutes, about 100 to 300 events. At 14k events/s, one
4-core API instance plus Postgres handles roughly 3,000 to 8,000 batches per minute of steady
state, far beyond what this product needs. The bottleneck is CPU shared by Node (JSON parsing,
Zod, AES-GCM) and Postgres on the same box.

Reproduce:

```sh
pnpm --filter @tracer/api build
INGEST_RATE_CAPACITY=1000000 INGEST_RATE_REFILL_PER_SEC=100000 USER_DAILY_EVENT_QUOTA=100000000 \
  AUTH_RATE_PER_MIN=1000 node apps/api/dist/main.js &
k6 run -e API=http://localhost:4000 -e DEVICES=20 -e BATCH=100 -e DURATION=60s apps/api/load/ingest.k6.js
```

# apps/api security notes (OWASP ASVS 4.0.3 L2 checklist)

Scope: the HTTP API, job workers and database. "Test" names the file in `test/` that proves it.
Gaps are listed honestly at the end.

## V1 Architecture
| Control | How | Where / test |
|---|---|---|
| 1.4.1 Trusted enforcement points | Auth in Fastify `onRequest` hooks per contract auth mode; tenant isolation in Postgres RLS | `src/http/auth.ts`, `integration/rls.test.ts` |
| 1.4.4 Single access-control mechanism | Every tenant query runs in `Database.withTenant` (SET LOCAL `app.user_id`); RLS ENABLE+FORCE on every tenant table | migration 0002/0003, `rls.test.ts` |
| 1.5 Input/output architecture | Zod contract (`@tracer/schema` route table) validates every request and serializes every response | `src/http/app.ts`, `contract.test.ts` |
| 1.6 Crypto architecture | Envelope encryption: per-user DEK (AES-256-GCM) wrapped by MASTER_KEY; AAD binds ciphertext to its row; HKDF subkeys | `src/lib/crypto.ts`, `unit/lib.test.ts` |
| 1.8 Data classification | Only redacted ActivityEvents are accepted; payloads, stage outputs and reports are encrypted at rest; `app_key`/`kind`/`ts` and redaction counts are plaintext for counting | `ingest.test.ts` |

## V2 Authentication
| Control | How | Test |
|---|---|---|
| 2.1.1/2.1.2 Password length 12–128, no composition rules | `SignupRequest` | `auth.test.ts` |
| 2.2.1 Anti-automation | IP limit on auth routes (`AUTH_RATE_PER_MIN`); per-account failed-login lock with exponential backoff (`LOGIN_MAX_FAILURES`) | `auth.test.ts` |
| 2.4.1 Password storage | argon2id, m=19 MiB, t=2, p=1 (OWASP minimum); rehash-on-login when params change | `auth.test.ts` |
| 2.5 Account enumeration | Login returns the same 401 message for unknown accounts and verifies against a dummy hash, so timing matches | `auth.test.ts` |
| 2.9 Device credentials | Device token = 32 random bytes, shown once, stored as sha256, revocable per device | `devices.test.ts` |

## V3 Session management
| Control | How | Test |
|---|---|---|
| 3.2.1 New session tokens | Fresh access JWT + refresh token on every login/refresh | `auth.test.ts` |
| 3.3.1 Logout invalidates | Logout revokes the refresh family and clears the cookies | `auth.test.ts` |
| 3.3.2 Re-authentication timeouts | Access JWT expires after 15 min; refresh token after 30 days | `auth.test.ts` |
| 3.4.1–3.4.3, 3.4.5 Cookie attributes | `tracer_rt`/`tracer_csrf`: HttpOnly, SameSite=Strict, Secure (enforced in production by config), Path=/v1/auth | `auth.test.ts` |
| 3.5.2 Token reuse | Refresh tokens are single-use. Reusing a rotated token revokes the whole family | `auth.test.ts`, `unit/services.test.ts` |
| 3.5.3 JWT integrity | HS256 only (no `alg:none` or algorithm confusion), issuer and audience checked | `auth.test.ts` |
| 4.2.2 CSRF | Double-submit: `x-csrf-token` must equal the csrf cookie (constant-time compare) on the cookie-authenticated routes `refresh` and `logout`. All other routes use bearer tokens (not ambient credentials) | `auth.test.ts` |

## V4 Access control
| Control | How | Test |
|---|---|---|
| 4.1.1/4.1.3 Server-side, least privilege | `tracer_app` is NOSUPERUSER NOBYPASSRLS, with DML on tenant tables only. Pre-tenant lookups go through SECURITY DEFINER functions owned by NOLOGIN `tracer_auth` (column-level grants). Receipts are insert-only | `rls.test.ts` |
| 4.2.1 IDOR | Another user's ids return 404 (indistinguishable from nonexistent). A deliberately buggy query without a user filter still sees only the current tenant | `rls.test.ts` |
| 4.3.x | No admin interface. `/metrics` can require `METRICS_TOKEN`; `/docs` can be disabled (`DOCS_ENABLED`) | n/a |

## V5 Validation, sanitization, encoding
| Control | How |
|---|---|
| 5.1.3/5.1.4 Input validation | Every body, param and query is Zod-validated against the contract; unknown event kinds are rejected |
| 5.1.5/5.2 | No redirects, templating or HTML rendering in the API |
| 5.3.4 SQL injection | Only parameterized SQL (Drizzle, or `$n` params). The two dynamic identifiers (table names in privacy repo) come from a constant list; role DDL uses `format('%I %L')` |
| 5.5.2 Deserialization | Fastify's secure JSON parser (`__proto__`/`constructor` rejected) | `contract.test.ts` |

## V7 Errors and logging
| Control | How |
|---|---|
| 7.1.1/7.1.2 No secrets in logs | pino `redact` covers Authorization, Cookie, Set-Cookie, x-csrf-token, password/token fields. The config log line is redacted (`describeConfig`) | `unit/lib.test.ts` |
| 7.1.3 Security events | Auth failures are logged by Fastify request logs with request id. Data access goes to `access_log` (user-visible) via the service decorator |
| 7.2 Access log | Every read/write of user data writes `access_log` (actor, action, resource, requestId) in the same transaction (`withAccessLog`) | `privacy.test.ts`, `unit/services.test.ts` |
| 7.4.1 Generic errors | `ApiError` envelope with requestId. Never a stack trace; 500 message is generic in production |

## V8 Data protection
| Control | How |
|---|---|
| 8.1.1 Cache control | `cache-control: no-store` on session, pairing and export responses |
| 8.2.x Export / deletion | `GET /v1/me/export` (zip, consistent REPEATABLE READ snapshot). `DELETE /v1/me` hard-deletes every tenant table in one transaction, purges the user's jobs, deletes the wrapped DEK (crypto-shred) and returns an HMAC-signed receipt with exact per-table counts. The receipt is kept with `sha256(userId)` only | `privacy.test.ts` |
| 8.3.4 Minimisation | Full URLs, screenshots, keystrokes and clipboard contents never reach the API (contract). Server-side exclusions drop matching events as a second line of defence |

## V9 Communications
TLS terminates at the proxy/load balancer; HSTS is set in production. `trustProxy` is on only in production.

## V10/V14 Configuration and dependencies
| Control | How |
|---|---|
| 14.1 Build | Dockerfile: multi-stage, `--prod` deploy, runs as `node` (non-root), healthcheck |
| 14.2 Dependencies | Lockfile; CI runs `pnpm audit --prod --audit-level high` |
| 14.3.2 No debug in prod | Config fails fast: prod requires `COOKIE_SECURE=true` and a non-dev JWT secret; Zod-validated env |
| 14.4 Headers | @fastify/helmet: CSP `default-src 'none'; frame-ancestors 'none'`, nosniff, no-referrer, CORP same-site, HSTS (prod). Strict CORS: only `WEB_ORIGIN`, credentials, explicit header allow-list |
| 13.1.x/12.1.1 Size limits | Global body limit 256 KB; ingest `LIMITS.maxBatchBytes` (2 MB) → 413; batch ≤ 1000 events |

## Abuse controls on ingest
- Device auth runs before the body is read.
- Per-device token bucket (`INGEST_RATE_CAPACITY`, `INGEST_RATE_REFILL_PER_SEC`) → 429 + Retry-After.
- Per-user daily quota (`USER_DAILY_EVENT_QUOTA`, an O(1) counter in Postgres) → partial accept, then 429 `quota_exceeded`.
- Idempotency on batchId (stored result replayed) and on event id (`ON CONFLICT DO NOTHING`).

## Constant-time comparisons
CSRF token, pairing-code hash and the metrics token use `safeEqual` (sha256 both sides, then `timingSafeEqual`). Refresh and device tokens are looked up by their sha256, so no secret comparison happens in application code.

## Known gaps and accepted risks
- In-memory limiters are per process; N instances allow N times the burst. The Postgres quota is the global ceiling. Move them to Postgres if horizontal scale ever matters.
- No MFA (out of scope for L2 self-service MVP; ASVS 2.7/2.8 not covered).
- No password reset or email verification flow (no email infrastructure in scope).
- MASTER_KEY is a single env secret, not a KMS key. Key rotation is supported by `user_keys.key_version` but not implemented.
- `subjectHash` is plain sha256(userId), as specified by the contract. A keyed hash would resist confirmation attacks; proposed as a contract change.
- Dev seed credentials: `demo@tracer.local` / `tracer-demo-password` exist only if `pnpm --filter @tracer/api seed` is run. Never seed production.

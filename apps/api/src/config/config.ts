import { z } from 'zod';

/**
 * Process configuration. Parsed once at boot from the environment; any problem is fatal
 * (fail fast). Secrets come only from env and are never logged: `describeConfig` returns a
 * redacted view for the startup log line.
 */
const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

const base64Key32 = z
  .string()
  .min(1)
  .refine((s) => Buffer.from(s, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  /** Statement timeout for app connections, ms. */
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  MASTER_KEY: base64Key32,
  WEB_ORIGIN: z.url(),
  /** Cookies get `Secure` unless explicitly disabled outside production. */
  COOKIE_SECURE: bool(true),

  /** Ingest limits (see SECURITY.md). Token bucket per device, in-memory per API instance. */
  INGEST_RATE_CAPACITY: z.coerce.number().int().min(1).default(30),
  INGEST_RATE_REFILL_PER_SEC: z.coerce.number().positive().default(1),
  USER_DAILY_EVENT_QUOTA: z.coerce.number().int().min(1).default(200_000),

  /** Auth route throttling per IP (requests per minute) and per account (failures per 15 min). */
  AUTH_RATE_PER_MIN: z.coerce.number().int().min(1).default(20),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),

  /** Password hashing. Defaults are OWASP's argon2id minimums (19 MiB, t=2, p=1). */
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(1024).default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().min(1).default(2),

  /** Jobs */
  JOBS_ENABLED: bool(true),
  PGBOSS_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/).default('pgboss'),
  JOB_RETRY_LIMIT: z.coerce.number().int().min(0).default(3),
  JOB_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).default(5),
  JOB_RETRY_DELAY_MAX_SECONDS: z.coerce.number().int().min(1).default(300),
  JOB_POLL_INTERVAL_SECONDS: z.coerce.number().min(0.5).default(2),
  SWEEP_CRON: z.string().default('* * * * *'),

  /** Observability */
  OTEL_ENABLED: bool(false),
  /** `console` for local debugging, `otlp` to ship to OTEL_EXPORTER_OTLP_ENDPOINT. */
  OTEL_EXPORTER: z.enum(['console', 'otlp']).default('otlp'),
  OTEL_SERVICE_NAME: z.string().default('tracer-api'),
  /** If set, /metrics requires `Authorization: Bearer <METRICS_TOKEN>`. */
  METRICS_TOKEN: z.string().min(16).optional(),
  DOCS_ENABLED: bool(true),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    if (!cfg.COOKIE_SECURE) throw new ConfigError('Invalid configuration:\n  - COOKIE_SECURE: must be true in production');
    if (cfg.JWT_SECRET.startsWith('dev-only')) throw new ConfigError('Invalid configuration:\n  - JWT_SECRET: dev secret in production');
  }
  return cfg;
}

const SECRET_KEYS = new Set<keyof Config>(['JWT_SECRET', 'MASTER_KEY', 'METRICS_TOKEN']);

/** Loggable view of the config: secrets replaced, DB password stripped. */
export function describeConfig(cfg: Config): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (SECRET_KEYS.has(k as keyof Config)) out[k] = v === undefined ? undefined : '[set]';
    else if (k === 'DATABASE_URL') {
      const u = new URL(String(v));
      u.password = u.password ? '***' : '';
      out[k] = u.toString();
    } else out[k] = v;
  }
  return out;
}

import type { Logger } from 'pino';
import type { Config } from './config/config.js';
import { createPool, Database } from './db/database.js';
import { PgBossJobQueue } from './jobs/boss.js';
import type { JobQueue } from './jobs/queue.js';
import { systemClock, type Clock } from './lib/clock.js';
import { KeyRing } from './lib/crypto.js';
import { TokenBucketLimiter } from './lib/rate-limit.js';
import { createMetrics, type Metrics } from './observability/metrics.js';
import type { PipelineEngine } from './pipeline/engine.js';
import { analysisEngineFromEnv } from './pipeline/analysis-engine.js';
import { PgLlmCache } from './pipeline/llm-cache.js';
import { PgAuthLookups } from './repositories/lookups.js';
import { PgUnitOfWork } from './repositories/index.js';
import { withAccessLog } from './services/access-log.js';
import { AuditsService } from './services/audits.js';
import { AccessTokens, Argon2Hasher, AuthService, type PasswordHasher } from './services/auth.js';
import { KeyService } from './services/context.js';
import { DevicesService } from './services/devices.js';
import { IngestService } from './services/ingest.js';
import { MeService, type CatalogSource } from './services/me.js';
import { CATALOG } from '@tracer/catalog';
import { PipelineService } from './services/pipeline.js';
import { PrivacyService } from './services/privacy.js';

/** Swappable ports. Anything not given gets the production default. */
export interface Overrides {
  clock?: Clock;
  /** Default: `@tracer/analysis` with catalog + LLM deps (pipeline/analysis-engine.ts). Tests may pass the stub. */
  engine?: PipelineEngine;
  /** Default: the `@tracer/catalog` entries. */
  catalog?: CatalogSource;
  hasher?: PasswordHasher;
  queue?: JobQueue;
  metrics?: Metrics;
}

/**
 * Composition root: the only place that knows concrete classes. Plain constructor injection,
 * no container library. Order: infrastructure -> repositories -> services -> decorators.
 */
export function createContainer(config: Config, log: Logger, o: Overrides = {}) {
  const clock = o.clock ?? systemClock;
  const catalog: CatalogSource = o.catalog ?? { list: async () => [...CATALOG] };
  const metrics = o.metrics ?? createMetrics({ defaultMetrics: config.NODE_ENV !== 'test' });

  const db = new Database(
    createPool({ connectionString: config.DATABASE_URL, max: config.DATABASE_POOL_MAX, statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS }),
  );
  const boss =
    o.queue ??
    new PgBossJobQueue(
      {
        connectionString: config.DATABASE_URL,
        schema: config.PGBOSS_SCHEMA,
        retryLimit: config.JOB_RETRY_LIMIT,
        retryDelaySeconds: config.JOB_RETRY_DELAY_SECONDS,
        retryDelayMaxSeconds: config.JOB_RETRY_DELAY_MAX_SECONDS,
        pollIntervalSeconds: config.JOB_POLL_INTERVAL_SECONDS,
        sweepCron: config.SWEEP_CRON,
      },
      log.child({ component: 'jobs' }),
    );
  const uow = new PgUnitOfWork(db, boss);
  const lookups = new PgAuthLookups(db);
  const keys = new KeyService(new KeyRing(config.MASTER_KEY), clock);
  const engine =
    o.engine ??
    analysisEngineFromEnv((userId) => new PgLlmCache(uow, keys, clock, userId), {
      ...process.env,
      LLM_PROVIDER: config.LLM_PROVIDER,
      ...(config.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: config.ANTHROPIC_MODEL } : {}),
    });

  const auth = new AuthService(
    uow,
    lookups,
    keys,
    o.hasher ?? new Argon2Hasher(config.ARGON2_MEMORY_KIB, config.ARGON2_TIME_COST),
    new AccessTokens(config.JWT_SECRET, clock),
    clock,
    { maxLoginFailures: config.LOGIN_MAX_FAILURES },
  );
  const pipeline = new PipelineService(uow, keys, engine, clock, metrics);
  const audits = new AuditsService(uow, lookups, pipeline, clock);
  const devices = new DevicesService(uow, lookups, clock);
  const ingest = new IngestService(
    uow,
    keys,
    audits,
    new TokenBucketLimiter(config.INGEST_RATE_CAPACITY, config.INGEST_RATE_REFILL_PER_SEC, clock),
    clock,
    metrics,
    { dailyQuota: config.USER_DAILY_EVENT_QUOTA },
  );
  const privacy = new PrivacyService(uow, db, keys, boss, clock);
  const me = new MeService(uow);

  // Access-log decorators: every read/write of user data through the API is recorded here.
  const id = (a: unknown[]) => `audit:${String(a[0])}`;
  const services = {
    auth,
    devices: withAccessLog(devices, uow, clock, {
      createPairingCode: { action: 'pairing_code.create', resource: () => 'pairing_code' },
      list: { action: 'devices.list', resource: () => 'devices' },
      revoke: { action: 'device.revoke', resource: (a) => `device:${a[0]}` },
    }),
    audits: withAccessLog(audits, uow, clock, {
      create: { action: 'audit.create', resource: (_a, r) => `audit:${r.id}` },
      list: { action: 'audits.list', resource: () => 'audits' },
      get: { action: 'audit.read', resource: id },
      pause: { action: 'audit.pause', resource: id },
      resume: { action: 'audit.resume', resource: id },
      finish: { action: 'audit.finish', resource: id },
      status: { action: 'audit.status', resource: id },
      agentConfig: { action: 'agent.config', resource: () => 'agent_config' },
    }),
    pipeline: withAccessLog(pipeline, uow, clock, {
      latest: { action: 'pipeline.read', resource: id },
      rerun: { action: 'pipeline.rerun', resource: id },
      report: { action: 'report.read', resource: (a) => `report:${a[0]}` },
    }),
    ingest, // logs inside its own transaction (one row per batch)
    privacy: withAccessLog(privacy, uow, clock, {
      getExclusions: { action: 'exclusions.read', resource: () => 'exclusions' },
      putExclusions: { action: 'exclusions.write', resource: () => 'exclusions' },
      captured: { action: 'captured.read', resource: () => 'captured_summary' },
      accessLog: { action: 'access_log.read', resource: () => 'access_log' },
      exportZip: { action: 'account.export', resource: () => 'account' },
      // deleteAccount is not decorated: the log it would write is deleted with the account.
    }),
    me: withAccessLog(me, uow, clock, {
      get: { action: 'profile.read', resource: () => 'profile' },
      update: { action: 'profile.write', resource: () => 'profile' },
    }),
    catalog,
  };

  return {
    config,
    log,
    clock,
    metrics,
    db,
    queue: boss,
    lookups,
    keys,
    services,
    /** Undecorated services, for workers and scripts. */
    core: { pipeline, audits, privacy, auth, devices },
    async startJobs() {
      if (boss instanceof PgBossJobQueue) {
        if (config.JOBS_ENABLED) await boss.startWorkers(pipeline, audits);
        else await boss.start();
      }
    },
    async close() {
      if (boss instanceof PgBossJobQueue) await boss.stop();
      await db.close();
    },
  };
}
export type Container = ReturnType<typeof createContainer>;

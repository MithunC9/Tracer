/**
 * End to end, no manual steps: an in-process API (real HTTP listener, pg-boss workers, the real
 * analysis engine with catalog + mock-LLM deps) on a migrated Postgres; a user signs up, creates
 * a pairing code, the simulated agent (`tracer-sim`, the Rust agent core; HTTP fallback when the
 * binary is not built) pairs and uploads a fixture persona, the audit is finished, the pipeline
 * publishes, and the report is fetched with the typed client and checked.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { validateReport } from '@tracer/llm';
import { AuditReport } from '@tracer/schema';
import { loadConfig } from '../../src/config/config.js';
import { createContainer, type Container } from '../../src/container.js';
import { buildApp } from '../../src/http/app.js';
import { createLogger } from '../../src/observability/logger.js';
import { apiSession, createCompletedAudit, plantedRecall, simBinary, type UploadVia } from '../../src/scripts/demo.js';
import { loadFixture } from '../../src/scripts/fixtures.js';

let app: FastifyInstance;
let c: Container;
let admin: pg.Pool;
let baseUrl: string;
const bossSchema = `pgboss_e2e_${randomBytes(4).toString('hex')}`;
const logs: string[] = [];
const log = (m: string) => {
  logs.push(m);
  if (process.env.E2E_VERBOSE) console.log(m);
};

beforeAll(async () => {
  admin = new pg.Pool({ connectionString: inject('adminUrl'), max: 2 });
  await admin.query(`create schema ${bossSchema} authorization tracer_app`);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: inject('appUrl'),
    DATABASE_POOL_MAX: '8',
    JWT_SECRET: randomBytes(32).toString('hex'),
    MASTER_KEY: randomBytes(32).toString('base64'),
    WEB_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    PGBOSS_SCHEMA: bossSchema,
    JOB_POLL_INTERVAL_SECONDS: '0.5',
    JOB_RETRY_DELAY_SECONDS: '1',
    JOB_RETRY_LIMIT: '1',
    LLM_PROVIDER: 'mock',
    AUTH_RATE_PER_MIN: '1000',
  });
  c = createContainer(config, createLogger(config.LOG_LEVEL));
  await c.startJobs();
  app = await buildApp(c);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await c?.close();
  await admin?.query(`drop schema if exists ${bossSchema} cascade`);
  await admin?.end();
});

async function endToEnd(persona: string, via: UploadVia) {
  const fixture = loadFixture(persona);
  const email = `e2e-${randomUUID()}@example.com`;
  const session = await apiSession(baseUrl, email, 'e2e correct horse battery', { signup: true });
  const { audit, report, shiftDays, upload } = await createCompletedAudit({ baseUrl, session, fixture, via, log, timeoutMs: 120_000 });

  expect(upload.via).toBe(via);
  expect(upload.accepted).toBeGreaterThan(fixture.events.length * 0.8);
  expect(audit.status).toBe('complete');
  expect(audit.reportAvailable).toBe(true);

  // The report is a valid AuditReport and passes the number validator.
  const parsed = AuditReport.parse(report);
  expect(parsed.auditId).toBe(audit.id);
  const v = validateReport(parsed);
  expect(v.errors).toEqual([]);
  expect(v.passed).toBe(true);
  expect(parsed.generation.validator.passed).toBe(true);
  expect(parsed.generation.provider).toBe('mock');
  expect(parsed.window.eventsAnalyzed).toBeGreaterThan(1000);

  // >= 80% of the planted workflows appear among the findings.
  const r = plantedRecall(parsed, fixture, shiftDays);
  log(`${persona} via ${via}: recall ${r.recall} matched=${r.matched.join(' | ')} missed=${r.missed.join(' | ')}`);
  expect(r.recall).toBeGreaterThanOrEqual(0.8);

  // Every pipeline stage ran (or was reused) and the narration cache rows are encrypted per tenant.
  const run = await session.client.call('auditPipeline', { params: { id: audit.id } });
  expect(run?.state).toBe('succeeded');
  expect(run?.stages.every((s) => s.state === 'succeeded' || s.state === 'skipped')).toBe(true);
  const rows = await admin.query<{ response_enc: Buffer }>('select response_enc from llm_cache where user_id = $1', [session.userId]);
  expect(rows.rowCount).toBeGreaterThan(0);
  const firstLabel = parsed.findings[0]!.narrative.headline.slice(0, 12);
  for (const row of rows.rows) expect(row.response_enc.toString('utf8')).not.toContain(firstLabel);
  return parsed;
}

describe('end to end: simulated agent -> API -> pipeline -> report', () => {
  const bin = simBinary();
  it(`bookkeeper via ${bin ? 'tracer-sim' : 'HTTP fallback (tracer-sim not built)'}`, async () => {
    await endToEnd('bookkeeper', bin ? 'sim' : 'http');
  });

  it('agency_am via the HTTP ingest fallback', async () => {
    await endToEnd('agency_am', 'http');
  });
});

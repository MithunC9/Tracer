import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { inject } from 'vitest';
import type { ActivityEvent } from '@tracer/schema';
import { loadConfig } from '../../src/config/config.js';
import { createContainer, type Container, type Overrides } from '../../src/container.js';
import { buildApp } from '../../src/http/app.js';
import { RecordingJobQueue } from '../../src/jobs/queue.js';
import { ManualClock } from '../../src/lib/clock.js';
import { createLogger } from '../../src/observability/logger.js';

export interface HarnessOptions {
  env?: Record<string, string>;
  overrides?: Overrides;
  /** 'boss' starts real pg-boss workers in an isolated schema; default records jobs only. */
  jobs?: 'record' | 'boss';
  clock?: ManualClock;
}

export interface Harness {
  app: FastifyInstance;
  c: Container;
  admin: pg.Pool;
  clock: ManualClock;
  queue: RecordingJobQueue | null;
  close(): Promise<void>;
}

export async function createHarness(o: HarnessOptions = {}): Promise<Harness> {
  const admin = new pg.Pool({ connectionString: inject('adminUrl'), max: 3 });
  const clock = o.clock ?? new ManualClock(new Date());
  const bossSchema = `pgboss_${randomBytes(4).toString('hex')}`;
  if (o.jobs === 'boss') await admin.query(`create schema ${bossSchema} authorization tracer_app`);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: inject('appUrl'),
    DATABASE_POOL_MAX: '5',
    JWT_SECRET: randomBytes(32).toString('hex'),
    MASTER_KEY: randomBytes(32).toString('base64'),
    WEB_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    PGBOSS_SCHEMA: bossSchema,
    JOB_POLL_INTERVAL_SECONDS: '0.5',
    JOB_RETRY_DELAY_SECONDS: '1',
    JOB_RETRY_DELAY_MAX_SECONDS: '2',
    JOB_RETRY_LIMIT: '2',
    DOCS_ENABLED: 'true',
    ...o.env,
  });
  const queue = o.jobs === 'boss' ? null : new RecordingJobQueue();
  const c = createContainer(config, createLogger(config.LOG_LEVEL), {
    clock,
    ...(queue ? { queue } : {}),
    ...o.overrides,
  });
  await c.startJobs();
  const app = await buildApp(c);
  await app.ready();
  return {
    app,
    c,
    admin,
    clock,
    queue,
    async close() {
      await app.close();
      await c.close();
      if (o.jobs === 'boss') await admin.query(`drop schema if exists ${bossSchema} cascade`);
      await admin.end();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
  csrf: string;
}

export function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  return (res.cookies as { name: string; value: string }[]).find((c) => c.name === name)?.value;
}

export async function signup(app: FastifyInstance, email = `u-${randomUUID()}@example.com`): Promise<TestUser> {
  const password = 'correct horse battery staple';
  const res = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email, password, acceptSelfObservation: true } });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const body = res.json();
  return {
    userId: body.user.id,
    email,
    password,
    accessToken: body.accessToken,
    refreshCookie: cookieValue(res, 'tracer_rt')!,
    csrf: body.csrfToken,
  };
}

export async function pair(app: FastifyInstance, accessToken: string): Promise<{ deviceId: string; deviceToken: string }> {
  const code = await app.inject({ method: 'POST', url: '/v1/devices/pairing-codes', headers: bearer(accessToken) });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/devices/pair',
    payload: { code: code.json().code, deviceName: 'Test Mac', platform: 'simulated', agentVersion: '0.1.0' },
  });
  if (res.statusCode !== 201) throw new Error(`pair failed: ${res.statusCode} ${res.body}`);
  return res.json();
}

export async function createAudit(app: FastifyInstance, accessToken: string, lengthDays = 7) {
  const res = await app.inject({ method: 'POST', url: '/v1/audits', headers: bearer(accessToken), payload: { lengthDays } });
  if (res.statusCode !== 201) throw new Error(`create audit failed: ${res.statusCode} ${res.body}`);
  return res.json() as { id: string; startsAt: string; endsAt: string; status: string };
}

let seq = 0;
export function focusEvent(ts: Date, over: Partial<{ appKey: string; title: string | null; host: string | null; id: string }> = {}): ActivityEvent {
  return {
    id: over.id ?? randomUUID(),
    ts: ts.toISOString(),
    seq: seq++,
    schemaVersion: 1,
    redactions: { email: 1 },
    kind: 'app_focus',
    app: { key: over.appKey ?? 'excel', name: over.appKey ?? 'Excel' },
    windowTitle: over.title === undefined ? 'Q3 numbers.xlsx' : over.title,
    urlHost: over.host ?? null,
  };
}

export function batchOf(events: ActivityEvent[], batchId = randomUUID()) {
  return { batchId, sentAt: new Date().toISOString(), agentVersion: '0.1.0', platform: 'simulated' as const, events };
}

export async function ingest(app: FastifyInstance, deviceToken: string, body: ReturnType<typeof batchOf>) {
  return app.inject({ method: 'POST', url: '/v1/agent/events', headers: bearer(deviceToken), payload: body });
}

/** Seconds-spaced app_focus events starting at `from`. */
export function eventsFrom(from: Date, n: number, stepMs = 30_000, over: Parameters<typeof focusEvent>[1] = {}) {
  return Array.from({ length: n }, (_, i) => focusEvent(new Date(from.getTime() + i * stepMs), { ...over, id: undefined }));
}

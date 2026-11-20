import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityEvent } from '@tracer/schema';
import { DAY_MS, ManualClock } from '../../src/lib/clock.js';
import { KeyRing } from '../../src/lib/crypto.js';
import { AppError } from '../../src/lib/errors.js';
import { TokenBucketLimiter } from '../../src/lib/rate-limit.js';
import { createMetrics } from '../../src/observability/metrics.js';
import { stubEngine } from '../../src/pipeline/stub-engine.js';
import { withAccessLog } from '../../src/services/access-log.js';
import { AuditsService } from '../../src/services/audits.js';
import { AccessTokens, AuthService, type PasswordHasher } from '../../src/services/auth.js';
import { KeyService, userActor, deviceActor } from '../../src/services/context.js';
import { DevicesService } from '../../src/services/devices.js';
import { IngestService } from '../../src/services/ingest.js';
import { PipelineService } from '../../src/services/pipeline.js';
import { FakeStore, FakeUow, fakeLookups } from '../helpers/fakes.js';

/** Plain-text hasher: unit tests check flow, not argon2. */
const fakeHasher: PasswordHasher = {
  hash: async (p) => `plain:${p}`,
  verify: async (h, p) => h === `plain:${p}`,
  needsRehash: () => false,
};

function world(opts: { dailyQuota?: number; rate?: number } = {}) {
  const store = new FakeStore();
  const uow = new FakeUow(store);
  const clock = new ManualClock(new Date('2026-11-20T09:00:00Z'));
  const lookups = fakeLookups(store);
  const keys = new KeyService(new KeyRing(randomBytes(32).toString('base64')), clock);
  const metrics = createMetrics({ defaultMetrics: false });
  const pipeline = new PipelineService(uow, keys, stubEngine, clock, metrics);
  const audits = new AuditsService(uow, lookups, pipeline, clock);
  const ingest = new IngestService(uow, keys, audits, new TokenBucketLimiter(opts.rate ?? 100, 1, clock), clock, metrics, {
    dailyQuota: opts.dailyQuota ?? 1000,
  });
  const auth = new AuthService(uow, lookups, keys, fakeHasher, new AccessTokens('k'.repeat(40), clock), clock, { maxLoginFailures: 3 });
  const devices = new DevicesService(uow, lookups, clock);
  return { store, uow, clock, keys, audits, ingest, auth, devices, pipeline };
}

const ev = (ts: Date, over: Partial<{ app: string; title: string }> = {}): ActivityEvent => ({
  id: randomUUID(),
  ts: ts.toISOString(),
  seq: 1,
  schemaVersion: 1,
  redactions: {},
  kind: 'app_focus',
  app: { key: over.app ?? 'excel', name: 'Excel' },
  windowTitle: over.title ?? 'Book1',
  urlHost: null,
});
const batch = (events: ActivityEvent[], batchId = randomUUID()) => ({
  batchId,
  sentAt: new Date().toISOString(),
  agentVersion: '1',
  platform: 'simulated' as const,
  events,
});

async function newUser(w: ReturnType<typeof world>) {
  const s = await w.auth.signup({ email: `${randomUUID()}@x.io`, password: 'long enough pw', acceptSelfObservation: true });
  return s.session.user.id;
}

describe('AuditsService state machine', () => {
  let w: ReturnType<typeof world>;
  let actor: ReturnType<typeof userActor>;
  beforeEach(async () => {
    w = world();
    actor = userActor(await newUser(w), null);
  });

  it('creates a capturing window of N days, only one open at a time', async () => {
    const a = await w.audits.create(actor, { lengthDays: 7, recurrence: 'none' });
    expect(a.status).toBe('capturing');
    expect(Date.parse(a.endsAt) - Date.parse(a.startsAt)).toBe(7 * DAY_MS);
    await expect(w.audits.create(actor, { lengthDays: 1, recurrence: 'none' })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('schedules future windows and starts them when due', async () => {
    const start = new Date(w.clock.now().getTime() + 3600_000);
    const a = await w.audits.create(actor, { lengthDays: 2, startsAt: start.toISOString(), recurrence: 'none' });
    expect(a.status).toBe('scheduled');
    w.clock.advance(3601_000);
    expect((await w.audits.get(actor, a.id)).status).toBe('capturing');
  });

  it('rejects start times in the past', async () => {
    await expect(
      w.audits.create(actor, { lengthDays: 2, startsAt: new Date(w.clock.now().getTime() - 3600_000).toISOString(), recurrence: 'none' }),
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('pause/resume accumulates paused time; invalid transitions conflict', async () => {
    const a = await w.audits.create(actor, { lengthDays: 2, recurrence: 'none' });
    await expect(w.audits.resume(actor, a.id)).rejects.toMatchObject({ code: 'conflict' });
    await w.audits.pause(actor, a.id);
    w.clock.advance(90_000);
    expect((await w.audits.resume(actor, a.id)).status).toBe('capturing');
    expect(w.store.audits[0]!.pausedSeconds).toBe(90);
  });

  it('finish ends the window early and enqueues the first pipeline stage', async () => {
    const a = await w.audits.create(actor, { lengthDays: 7, recurrence: 'none' });
    w.clock.advance(3600_000);
    const done = await w.audits.finish(actor, a.id);
    expect(done.status).toBe('analyzing');
    expect(done.endsAt).toBe(w.clock.now().toISOString());
    expect(w.store.jobs).toEqual([expect.objectContaining({ auditId: a.id, stage: 'sessionize' })]);
    await expect(w.audits.finish(actor, a.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('sweep closes windows whose end has passed', async () => {
    const a = await w.audits.create(actor, { lengthDays: 1, recurrence: 'none' });
    w.clock.advance(DAY_MS + 1000);
    expect(await w.audits.sweep()).toBe(1);
    expect(w.store.audits.find((x) => x.id === a.id)!.status).toBe('analyzing');
    expect(await w.audits.sweep()).toBe(0);
  });

  it('agent config reflects capture state', async () => {
    const dev = deviceActor(randomUUID(), actor.userId, null);
    expect((await w.audits.agentConfig(dev)).captureAllowed).toBe(false);
    const a = await w.audits.create(actor, { lengthDays: 1, recurrence: 'none' });
    expect(await w.audits.agentConfig(dev)).toMatchObject({ auditId: a.id, captureAllowed: true, paused: false });
    await w.audits.pause(actor, a.id);
    expect(await w.audits.agentConfig(dev)).toMatchObject({ captureAllowed: false, paused: true });
  });
});

describe('IngestService', () => {
  it('is idempotent per batch and per event, and reports rejections', async () => {
    const w = world();
    const userId = await newUser(w);
    await w.audits.create(userActor(userId, null), { lengthDays: 1, recurrence: 'none' });
    const dev = deviceActor(randomUUID(), userId, 'r1');
    const t = new Date(w.clock.now().getTime() + 1000);
    const e1 = ev(t);
    const b = batch([e1, ev(t, { title: 'Change password' }), ev(new Date(t.getTime() - 2 * DAY_MS))]);
    const r1 = await w.ingest.ingest(dev, b);
    expect(r1).toMatchObject({ accepted: 1, duplicates: 0, captureAllowed: true });
    expect(r1.rejected.map((x) => x.reason).sort()).toEqual(['excluded_by_policy', 'outside_window']);
    expect(await w.ingest.ingest(dev, b)).toEqual(r1);
    const r2 = await w.ingest.ingest(dev, batch([e1]));
    expect(r2).toMatchObject({ accepted: 0, duplicates: 1 });
    expect(w.store.events).toHaveLength(1);
    // payloads are encrypted
    expect(w.store.events[0]!.payloadEnc.toString('latin1')).not.toContain('Book1');
    expect(w.store.accessLog.filter((l) => l.action === 'events.ingest')).toHaveLength(2);
  });

  it('rate limits per device and enforces the daily quota', async () => {
    const w = world({ rate: 2, dailyQuota: 2 });
    const userId = await newUser(w);
    await w.audits.create(userActor(userId, null), { lengthDays: 1, recurrence: 'none' });
    const dev = deviceActor(randomUUID(), userId, null);
    const t = w.clock.now();
    expect((await w.ingest.ingest(dev, batch([ev(t), ev(t), ev(t)]))).rejected.map((r) => r.reason)).toEqual(['daily_quota_exceeded']);
    const err = await w.ingest.ingest(dev, batch([ev(t)])).catch((e: AppError) => e);
    expect(err).toMatchObject({ code: 'quota_exceeded', status: 429 });
    const limited = await w.ingest.ingest(dev, batch([ev(t)])).catch((e: AppError) => e);
    expect(limited).toMatchObject({ code: 'rate_limited' });
  });
});

describe('AuthService', () => {
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const w = world();
    const s1 = await w.auth.signup({ email: 'a@x.io', password: 'long enough pw', acceptSelfObservation: true });
    const s2 = await w.auth.refresh(s1.refreshToken);
    await expect(w.auth.refresh(s1.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(w.auth.refresh(s2.refreshToken)).rejects.toMatchObject({ status: 401 });
    expect(w.store.refresh.every((t) => t.revokedAt)).toBe(true);
  });

  it('verifies access tokens it issued and rejects others', async () => {
    const w = world();
    const s = await w.auth.signup({ email: 'b@x.io', password: 'long enough pw', acceptSelfObservation: true });
    expect(await w.auth.verifyAccessToken(s.session.accessToken)).toBe(s.session.user.id);
    const other = new AccessTokens('z'.repeat(40), w.clock);
    await expect(w.auth.verifyAccessToken((await other.sign(s.session.user.id)).token)).rejects.toMatchObject({ status: 401 });
  });

  it('locks an account after repeated failures', async () => {
    const w = world();
    await w.auth.signup({ email: 'c@x.io', password: 'long enough pw', acceptSelfObservation: true });
    for (let i = 0; i < 3; i++) await expect(w.auth.login({ email: 'c@x.io', password: 'nope' })).rejects.toMatchObject({ status: 401 });
    await expect(w.auth.login({ email: 'c@x.io', password: 'long enough pw' })).rejects.toMatchObject({ status: 429 });
  });

  it('rolls back the whole signup when a step fails', async () => {
    const w = world();
    await w.auth.signup({ email: 'd@x.io', password: 'long enough pw', acceptSelfObservation: true });
    await expect(w.auth.signup({ email: 'D@x.io', password: 'long enough pw', acceptSelfObservation: true })).rejects.toMatchObject({ code: 'conflict' });
    expect(w.store.users).toHaveLength(1);
    expect(w.store.keys).toHaveLength(1);
  });
});

describe('DevicesService pairing', () => {
  it('pairs once and burns a code after too many wrong guesses', async () => {
    const w = world();
    const userId = await newUser(w);
    const c1 = await w.devices.createPairingCode(userActor(userId, null));
    const ok = await w.devices.pair({ code: c1.code, deviceName: 'm', platform: 'macos', agentVersion: '1' }, null);
    expect((await w.devices.authenticate(ok.deviceToken)).deviceId).toBe(ok.deviceId);

    const c2 = await w.devices.createPairingCode(userActor(userId, null));
    const [sel] = c2.code.split('-');
    const wrong = `${sel}-${c2.code.endsWith('0000') ? '1111' : '0000'}`;
    for (let i = 0; i < 5; i++) await expect(w.devices.pair({ code: wrong, deviceName: 'm', platform: 'macos', agentVersion: '1' }, null)).rejects.toThrow();
    await expect(w.devices.pair({ code: c2.code, deviceName: 'm', platform: 'macos', agentVersion: '1' }, null)).rejects.toMatchObject({ status: 401 });
  });
});

describe('withAccessLog decorator', () => {
  it('logs successful calls in the same unit of work and nothing for failures', async () => {
    const store = new FakeStore();
    const uow = new FakeUow(store);
    const clock = new ManualClock();
    const svc = {
      async read(_a: unknown, id: string) {
        return { id };
      },
      async boom(_a: unknown) {
        throw new Error('x');
      },
      untouched() {
        return 1;
      },
    };
    const wrapped = withAccessLog(svc, uow, clock, {
      read: { action: 'thing.read', resource: (args) => `thing:${args[0]}` },
      boom: { action: 'thing.boom', resource: () => 'thing' },
    });
    const actor = userActor(randomUUID(), 'req-9');
    expect(await wrapped.read(actor as never, '42')).toEqual({ id: '42' });
    await expect(wrapped.boom(actor as never)).rejects.toThrow('x');
    expect(wrapped.untouched()).toBe(1);
    expect(store.accessLog).toEqual([
      expect.objectContaining({ userId: actor.userId, actor: 'user', action: 'thing.read', resource: 'thing:42', requestId: 'req-9' }),
    ]);
  });
});

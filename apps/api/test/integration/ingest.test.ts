import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CaptureStatus, IngestResult } from '@tracer/schema';
import {
  batchOf,
  bearer,
  createAudit,
  createHarness,
  eventsFrom,
  focusEvent,
  ingest,
  pair,
  signup,
  type Harness,
} from '../helpers/harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ env: { AUTH_RATE_PER_MIN: '1000', INGEST_RATE_CAPACITY: '1000' } });
});
afterAll(() => h.close());

async function setup() {
  const u = await signup(h.app);
  const d = await pair(h.app, u.accessToken);
  const audit = await createAudit(h.app, u.accessToken, 7);
  return { u, d, audit };
}

describe('ingest', () => {
  it('accepts a batch, encrypts payloads at rest and replays the same result for the same batchId', async () => {
    const { u, d, audit } = await setup();
    const events = eventsFrom(new Date(Date.parse(audit.startsAt) + 1000), 5, 1000, { title: 'Secret Project Falcon' });
    const body = batchOf(events);
    const r1 = await ingest(h.app, d.deviceToken, body);
    expect(r1.statusCode).toBe(202);
    const res1 = IngestResult.parse(r1.json());
    expect(res1).toMatchObject({ accepted: 5, duplicates: 0, rejected: [], captureAllowed: true, captureUntil: audit.endsAt });

    const r2 = await ingest(h.app, d.deviceToken, body);
    expect(r2.json()).toEqual(res1);
    const rows = await h.admin.query('select payload_enc, app_key from events where user_id = $1', [u.userId]);
    expect(rows.rowCount).toBe(5);
    for (const r of rows.rows) expect(r.payload_enc.toString('latin1')).not.toContain('Falcon');

    const status = CaptureStatus.parse((await h.app.inject({ method: 'GET', url: `/v1/audits/${audit.id}/status`, headers: bearer(u.accessToken) })).json());
    expect(status).toMatchObject({ eventsReceived: 5, distinctApps: 1, devicesReporting: 1, dayNumber: 1, totalDays: 7 });
    expect(status.activeMinutes).toBeCloseTo(4 / 60, 1);
    const dev = await h.admin.query('select last_seen_at from devices where id = $1', [d.deviceId]);
    expect(dev.rows[0].last_seen_at).not.toBeNull();
  });

  it('counts re-sent event ids in a new batch as duplicates', async () => {
    const { d, audit } = await setup();
    const events = eventsFrom(new Date(Date.parse(audit.startsAt) + 1000), 4);
    await ingest(h.app, d.deviceToken, batchOf(events.slice(0, 2)));
    const r = IngestResult.parse((await ingest(h.app, d.deviceToken, batchOf([...events, events[0]!]))).json());
    expect(r).toMatchObject({ accepted: 2, duplicates: 3 });
  });

  it('rejects events outside the window, in the future, and drops excluded ones server-side', async () => {
    const { u, d, audit } = await setup();
    await h.app.inject({
      method: 'PUT',
      url: '/v1/me/exclusions',
      headers: bearer(u.accessToken),
      payload: { apps: ['1password'], domains: ['bank.example'], titleKeywords: ['diagnosis'], privateBrowsing: true },
    });
    const t = new Date(Date.parse(audit.startsAt) + 60_000);
    const before = focusEvent(new Date(Date.parse(audit.startsAt) - 3600_000));
    const future = focusEvent(new Date(h.clock.now().getTime() + 3600_000));
    const exApp = focusEvent(t, { appKey: '1password' });
    const exHost = focusEvent(t, { appKey: 'chrome', host: 'www.bank.example' });
    const exTitle = focusEvent(t, { title: 'My diagnosis results' });
    const ok = focusEvent(t);
    const r = IngestResult.parse((await ingest(h.app, d.deviceToken, batchOf([before, future, exApp, exHost, exTitle, ok]))).json());
    expect(r.accepted).toBe(1);
    const reasons = Object.fromEntries(r.rejected.map((x) => [x.id, x.reason]));
    expect(reasons).toEqual({
      [before.id]: 'outside_window',
      [future.id]: 'future_timestamp',
      [exApp.id]: 'excluded_by_policy',
      [exHost.id]: 'excluded_by_policy',
      [exTitle.id]: 'excluded_by_policy',
    });
    const stored = await h.admin.query('select id from events where user_id = $1', [u.userId]);
    expect(stored.rows.map((x) => x.id)).toEqual([ok.id]);
  });

  it('tells the agent to stop when paused, finished, or no audit is open', async () => {
    const u = await signup(h.app);
    const d = await pair(h.app, u.accessToken);
    const none = IngestResult.parse((await ingest(h.app, d.deviceToken, batchOf([focusEvent(h.clock.now())]))).json());
    expect(none).toMatchObject({ accepted: 0, captureAllowed: false });
    expect(none.rejected[0]!.reason).toBe('no_open_audit');

    const audit = await createAudit(h.app, u.accessToken, 3);
    await h.app.inject({ method: 'POST', url: `/v1/audits/${audit.id}/pause`, headers: bearer(u.accessToken) });
    const paused = IngestResult.parse((await ingest(h.app, d.deviceToken, batchOf([focusEvent(h.clock.now())]))).json());
    expect(paused).toMatchObject({ accepted: 0, captureAllowed: false });
    expect(paused.rejected[0]!.reason).toBe('capture_paused');
    const cfg = (await h.app.inject({ method: 'GET', url: '/v1/agent/config', headers: bearer(d.deviceToken) })).json();
    expect(cfg).toMatchObject({ auditId: audit.id, paused: true, captureAllowed: false });

    await h.app.inject({ method: 'POST', url: `/v1/audits/${audit.id}/resume`, headers: bearer(u.accessToken) });
    expect((await ingest(h.app, d.deviceToken, batchOf([focusEvent(h.clock.now())]))).json().captureAllowed).toBe(true);

    await h.app.inject({ method: 'POST', url: `/v1/audits/${audit.id}/finish`, headers: bearer(u.accessToken) });
    const done = IngestResult.parse((await ingest(h.app, d.deviceToken, batchOf([focusEvent(h.clock.now())]))).json());
    expect(done.captureAllowed).toBe(false);
  });

  it('accepts a full 1000-event batch in one request (bulk insert)', async () => {
    const { u, d, audit } = await setup();
    const events = eventsFrom(new Date(Date.parse(audit.startsAt) + 1000), 1000, 50);
    const t0 = performance.now();
    const r = await ingest(h.app, d.deviceToken, batchOf(events));
    const ms = performance.now() - t0;
    expect(r.json().accepted).toBe(1000);
    expect(ms).toBeLessThan(5000);
    const n = await h.admin.query('select count(*)::int as n from events where user_id = $1', [u.userId]);
    expect(n.rows[0].n).toBe(1000);
  });

  it('rejects oversized and malformed batches', async () => {
    const { d } = await setup();
    const tooMany = batchOf(eventsFrom(h.clock.now(), 1001, 1));
    expect((await ingest(h.app, d.deviceToken, tooMany)).statusCode).toBe(400);
    const huge = await h.app.inject({
      method: 'POST',
      url: '/v1/agent/events',
      headers: { ...bearer(d.deviceToken), 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024 + 10) }),
    });
    expect(huge.statusCode).toBe(413);
    expect(huge.json().error.code).toBe('payload_too_large');
    const bad = await ingest(h.app, d.deviceToken, { ...batchOf([focusEvent(h.clock.now())]), events: [{ kind: 'screenshot' } as never] });
    expect(bad.statusCode).toBe(400);
  });

  it('requires a device token before reading the body', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/v1/agent/events', payload: batchOf([focusEvent(h.clock.now())]) });
    expect(res.statusCode).toBe(401);
  });
});

describe('limits', () => {
  it('rate-limits each device with a token bucket', async () => {
    const h2 = await createHarness({ env: { INGEST_RATE_CAPACITY: '2', INGEST_RATE_REFILL_PER_SEC: '0.01' } });
    try {
      const u = await signup(h2.app);
      const d = await pair(h2.app, u.accessToken);
      const other = await pair(h2.app, u.accessToken);
      await createAudit(h2.app, u.accessToken);
      const send = (tok: string) => ingest(h2.app, tok, batchOf([focusEvent(h2.clock.now())]));
      expect((await send(d.deviceToken)).statusCode).toBe(202);
      expect((await send(d.deviceToken)).statusCode).toBe(202);
      const limited = await send(d.deviceToken);
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe('rate_limited');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect((await send(other.deviceToken)).statusCode).toBe(202); // per device
      h2.clock.advance(200_000);
      expect((await send(d.deviceToken)).statusCode).toBe(202);
    } finally {
      await h2.close();
    }
  });

  it('enforces the per-user daily quota (partial accept, then 429)', async () => {
    const h2 = await createHarness({ env: { USER_DAILY_EVENT_QUOTA: '5', INGEST_RATE_CAPACITY: '100' } });
    try {
      const u = await signup(h2.app);
      const d = await pair(h2.app, u.accessToken);
      const audit = await createAudit(h2.app, u.accessToken);
      const start = new Date(Date.parse(audit.startsAt) + 1000);
      const r1 = IngestResult.parse((await ingest(h2.app, d.deviceToken, batchOf(eventsFrom(start, 3)))).json());
      expect(r1.accepted).toBe(3);
      const r2 = IngestResult.parse((await ingest(h2.app, d.deviceToken, batchOf(eventsFrom(new Date(start.getTime() + 100_000), 4, 1000)))).json());
      expect(r2.accepted).toBe(2);
      expect(r2.rejected.map((x) => x.reason)).toEqual(['daily_quota_exceeded', 'daily_quota_exceeded']);
      const r3 = await ingest(h2.app, d.deviceToken, batchOf([focusEvent(start, { id: randomUUID() })]));
      expect(r3.statusCode).toBe(429);
      expect(r3.json().error.code).toBe('quota_exceeded');
    } finally {
      await h2.close();
    }
  });
});

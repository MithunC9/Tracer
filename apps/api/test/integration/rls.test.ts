import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { audits, devices, events, reports, TENANT_TABLES_DELETE_ORDER, users } from '../../src/db/schema.js';
import {
  batchOf,
  bearer,
  createAudit,
  createHarness,
  eventsFrom,
  ingest,
  pair,
  signup,
  type Harness,
  type TestUser,
} from '../helpers/harness.js';

let h: Harness;
let a: TestUser;
let b: TestUser;
let auditA: { id: string };
let deviceA: { deviceId: string; deviceToken: string };
let app: pg.Pool;

beforeAll(async () => {
  h = await createHarness({ env: { AUTH_RATE_PER_MIN: '1000' } });
  app = new pg.Pool({ connectionString: inject('appUrl'), max: 2 });
  a = await signup(h.app);
  b = await signup(h.app);
  deviceA = await pair(h.app, a.accessToken);
  auditA = await createAudit(h.app, a.accessToken);
  await ingest(h.app, deviceA.deviceToken, batchOf(eventsFrom(new Date(h.clock.now().getTime() + 1000), 3)));
  // Give A a stored report so report reads can be attempted cross-tenant.
  await h.app.inject({ method: 'POST', url: `/v1/audits/${auditA.id}/finish`, headers: bearer(a.accessToken) });
  await createAudit(h.app, b.accessToken);
});
afterAll(async () => {
  await app.end();
  await h.close();
});

describe('RLS at the database layer', () => {
  it('the app role is not a superuser and cannot bypass RLS', async () => {
    const r = await app.query('select rolsuper, rolbypassrls from pg_roles where rolname = current_user');
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('every tenant table has RLS enabled AND forced with the tenant policy', async () => {
    const r = await h.admin.query(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity,
              exists(select 1 from pg_policies p where p.tablename = c.relname and p.policyname = 'tenant_isolation') as has_policy
       from pg_class c where c.relname = any($1) and c.relkind = 'r'`,
      [[...TENANT_TABLES_DELETE_ORDER]],
    );
    expect(r.rowCount).toBe(TENANT_TABLES_DELETE_ORDER.length);
    for (const row of r.rows) expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true, has_policy: true });
  });

  it('a deliberately buggy query without a user filter only sees the current tenant', async () => {
    // As B, "forget" the where clause entirely.
    const seen = await h.c.db.withTenant(b.userId, async (tx) => ({
      audits: await tx.db.select().from(audits),
      users: await tx.db.select().from(users),
      events: await tx.db.select().from(events),
      devices: await tx.db.select().from(devices),
      reports: await tx.db.select().from(reports),
    }));
    expect(seen.audits.every((x) => x.userId === b.userId)).toBe(true);
    expect(seen.audits).toHaveLength(1);
    expect(seen.users.map((u) => u.id)).toEqual([b.userId]);
    expect(seen.events).toHaveLength(0);
    expect(seen.devices).toHaveLength(0);
    expect(seen.reports).toHaveLength(0);
    // Even fetching A's audit by primary key returns nothing.
    const direct = await h.c.db.withTenant(b.userId, (tx) => tx.db.select().from(audits).where(eq(audits.id, auditA.id)));
    expect(direct).toHaveLength(0);
  });

  it('cross-tenant writes are rejected or affect zero rows', async () => {
    await expect(
      h.c.db.withTenant(b.userId, (tx) =>
        tx.db.insert(audits).values({ userId: a.userId, status: 'cancelled', lengthDays: 1, startsAt: new Date(), endsAt: new Date(Date.now() + 1000) }),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } }); // new row violates row-level security policy
    const upd = await h.c.db.withTenant(b.userId, (tx) =>
      tx.db.update(audits).set({ status: 'cancelled' }).where(eq(audits.id, auditA.id)).returning(),
    );
    expect(upd).toHaveLength(0);
    const del = await h.c.db.withTenant(b.userId, (tx) => tx.db.delete(devices).returning());
    expect(del).toHaveLength(0);
    const still = await h.admin.query('select status from audits where id = $1', [auditA.id]);
    expect(still.rows[0].status).not.toBe('cancelled');
    expect((await h.admin.query('select 1 from devices where id = $1', [deviceA.deviceId])).rowCount).toBe(1);
  });

  it('without app.user_id the app role sees nothing at all', async () => {
    for (const t of TENANT_TABLES_DELETE_ORDER) {
      const r = await app.query(`select count(*)::int as n from ${t}`);
      expect(r.rows[0].n, t).toBe(0);
    }
  });

  it('the setting is transaction-local and does not leak through the pool', async () => {
    await h.c.db.withTenant(a.userId, async () => {});
    const c = await h.c.db.pool.connect();
    try {
      const r = await c.query(`select coalesce(current_setting('app.user_id', true), '') as v`);
      expect(r.rows[0].v).toBe('');
    } finally {
      c.release();
    }
  });

  it('deletion receipts are insert-only for the app role', async () => {
    await expect(app.query('select * from deletion_receipts')).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('update deletion_receipts set signature = $1', ['x'])).rejects.toMatchObject({ code: '42501' });
    await expect(app.query('truncate deletion_receipts')).rejects.toMatchObject({ code: '42501' });
  });

  it('the app role cannot read auth columns through the definer functions beyond their narrow results', async () => {
    // Functions answer one exact-match question; there is no way to list users.
    const r = await app.query('select * from auth_user_by_email($1)', ['%']);
    expect(r.rowCount).toBe(0);
    await expect(app.query('set role tracer_auth')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('RLS at the HTTP layer', () => {
  it("user B gets 404 for user A's audit, status, pipeline, report, and device", async () => {
    const urls = [
      ['GET', `/v1/audits/${auditA.id}`],
      ['GET', `/v1/audits/${auditA.id}/status`],
      ['GET', `/v1/audits/${auditA.id}/pipeline`],
      ['POST', `/v1/audits/${auditA.id}/pipeline`],
      ['GET', `/v1/audits/${auditA.id}/report`],
      ['POST', `/v1/audits/${auditA.id}/pause`],
      ['POST', `/v1/audits/${auditA.id}/finish`],
      ['DELETE', `/v1/devices/${deviceA.deviceId}`],
    ] as const;
    for (const [method, url] of urls) {
      const res = await h.app.inject({ method, url, headers: bearer(b.accessToken) });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().error.code).toBe('not_found');
    }
    const list = await h.app.inject({ method: 'GET', url: '/v1/audits', headers: bearer(b.accessToken) });
    expect(list.json().items.map((x: { id: string }) => x.id)).not.toContain(auditA.id);
    // A's device still works.
    expect((await h.app.inject({ method: 'GET', url: '/v1/agent/config', headers: bearer(deviceA.deviceToken) })).statusCode).toBe(200);
  });

  it('a random id is indistinguishable from someone else’s id', async () => {
    const res = await h.app.inject({ method: 'GET', url: `/v1/audits/${randomUUID()}`, headers: bearer(b.accessToken) });
    expect(res.statusCode).toBe(404);
  });
});

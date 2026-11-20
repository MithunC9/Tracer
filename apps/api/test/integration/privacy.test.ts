import yauzl from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessLogEntry, AuditReport, CapturedSummary, DeletionReceipt, DEFAULT_EXCLUSIONS, Exclusions } from '@tracer/schema';
import { TENANT_TABLES_DELETE_ORDER } from '../../src/db/schema.js';
import { sha256Hex } from '../../src/lib/tokens.js';
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
import { drainJobs } from '../helpers/jobs.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ env: { AUTH_RATE_PER_MIN: '1000', INGEST_RATE_CAPACITY: '1000' } });
});
afterAll(() => h.close());

/** A user with something in every table. */
async function seeded(): Promise<{ u: TestUser; auditId: string; eventIds: string[]; deviceId: string }> {
  const u = await signup(h.app);
  const d = await pair(h.app, u.accessToken);
  await pair(h.app, u.accessToken);
  await h.app.inject({ method: 'POST', url: '/v1/devices/pairing-codes', headers: bearer(u.accessToken) });
  await h.app.inject({
    method: 'PUT',
    url: '/v1/me/exclusions',
    headers: bearer(u.accessToken),
    payload: { ...DEFAULT_EXCLUSIONS, titleKeywords: ['payroll'] },
  });
  const audit = await createAudit(h.app, u.accessToken, 2);
  const events = eventsFrom(new Date(Date.parse(audit.startsAt) + 1000), 10, 1000);
  await ingest(h.app, d.deviceToken, batchOf(events.slice(0, 6)));
  await ingest(h.app, d.deviceToken, batchOf(events.slice(6)));
  await h.app.inject({ method: 'POST', url: `/v1/audits/${audit.id}/finish`, headers: bearer(u.accessToken) });
  await drainJobs(h);
  // a refresh rotation adds a second refresh token row
  await h.app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    cookies: { tracer_rt: u.refreshCookie, tracer_csrf: u.csrf },
    headers: { 'x-csrf-token': u.csrf },
  });
  return { u, auditId: audit.id, eventIds: events.map((e) => e.id), deviceId: d.deviceId };
}

function unzip(buf: Buffer): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: Record<string, string> = {};
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            out[entry.fileName] = Buffer.concat(chunks).toString('utf8');
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.readEntry();
    });
  });
}

async function countsFor(userId: string) {
  const out: Record<string, number> = {};
  for (const t of TENANT_TABLES_DELETE_ORDER) {
    const r = await h.admin.query(`select count(*)::int as n from ${t} where ${t === 'users' ? 'id' : 'user_id'} = $1`, [userId]);
    out[t] = r.rows[0].n;
  }
  return out;
}

describe('privacy center', () => {
  it('exclusions default, replace and validate', async () => {
    const u = await signup(h.app);
    const get = await h.app.inject({ method: 'GET', url: '/v1/me/exclusions', headers: bearer(u.accessToken) });
    expect(get.json()).toEqual(DEFAULT_EXCLUSIONS);
    const next: Exclusions = { apps: ['slack'], domains: ['example.org'], titleKeywords: ['salary'], privateBrowsing: true };
    const put = await h.app.inject({ method: 'PUT', url: '/v1/me/exclusions', headers: bearer(u.accessToken), payload: next });
    expect(put.json()).toEqual(next);
    const bad = await h.app.inject({ method: 'PUT', url: '/v1/me/exclusions', headers: bearer(u.accessToken), payload: { ...next, privateBrowsing: false } });
    expect(bad.statusCode).toBe(400);
  });

  it('summarizes what is held (counts only) and logs every access with its request id', async () => {
    const { u, auditId } = await seeded();
    const res = await h.app.inject({ method: 'GET', url: '/v1/me/captured', headers: { ...bearer(u.accessToken), 'x-request-id': 'trace-me-1' } });
    const s = CapturedSummary.parse(res.json());
    expect(s.eventsByKind).toEqual({ app_focus: 10 });
    expect(s.redactionsByKind).toEqual({ email: 10 });
    expect(s.storageBytes).toBeGreaterThan(0);

    await h.app.inject({ method: 'GET', url: `/v1/audits/${auditId}/report`, headers: bearer(u.accessToken) });
    const log = await h.app.inject({ method: 'GET', url: '/v1/me/access-log?limit=200', headers: bearer(u.accessToken) });
    const items = log.json().items.map((x: unknown) => AccessLogEntry.parse(x)) as AccessLogEntry[];
    const actions = items.map((i) => i.action);
    for (const a of ['captured.read', 'report.read', 'events.ingest', 'device.pair', 'audit.create', 'audit.finish', 'exclusions.write'])
      expect(actions, a).toContain(a);
    expect(items.find((i) => i.action === 'captured.read')).toMatchObject({ actor: 'user', actorId: u.userId, requestId: 'trace-me-1' });
    expect(items.find((i) => i.action === 'events.ingest')?.actor).toBe('device');
  });

  it('paginates the access log with an opaque cursor', async () => {
    const { u } = await seeded();
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/v1/me/access-log?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await h.app.inject({ method: 'GET', url, headers: bearer(u.accessToken) })).json();
      for (const i of page.items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
      }
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(pages).toBeGreaterThan(2);
    const bad = await h.app.inject({ method: 'GET', url: '/v1/me/access-log?cursor=zzz', headers: bearer(u.accessToken) });
    expect(bad.statusCode).toBe(400);
  });

  it('exports everything as a zip of JSON with decrypted events and no secrets', async () => {
    const { u, eventIds, auditId } = await seeded();
    const res = await h.app.inject({ method: 'GET', url: '/v1/me/export', headers: bearer(u.accessToken) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="tracer-export-.*\.zip"/);
    const files = await unzip(res.rawPayload);
    expect(Object.keys(files).sort()).toEqual(
      [
        'README.json',
        'access-log.json',
        'account.json',
        'audits.json',
        'devices.json',
        'events.json',
        'exclusions.json',
        'ingest-batches.json',
        'pipeline-runs.json',
        'pipeline-stages.json',
        'reports.json',
      ].sort(),
    );
    const events = JSON.parse(files['events.json']!) as { id: string; windowTitle: string }[];
    expect(events.map((e) => e.id).sort()).toEqual([...eventIds].sort());
    expect(events[0]!.windowTitle).toBe('Q3 numbers.xlsx');
    expect(JSON.parse(files['account.json']!).email).toBe(u.email);
    expect(files['account.json']).not.toContain('argon2');
    expect(files['devices.json']).not.toMatch(/token/);
    const reports = JSON.parse(files['reports.json']!);
    expect(AuditReport.parse(reports[0].report).auditId).toBe(auditId);
    expect(JSON.parse(files['exclusions.json']!).titleKeywords).toEqual(['payroll']);
    expect(JSON.parse(files['access-log.json']!).length).toBeGreaterThan(0);
  });

  it('DELETE /v1/me hard-deletes everything in one transaction with an accurate signed receipt', async () => {
    const { u } = await seeded();
    const other = await seeded(); // must be untouched
    const before = await countsFor(u.userId);
    const otherBefore = await countsFor(other.u.userId);
    for (const t of TENANT_TABLES_DELETE_ORDER) if (t !== 'llm_cache' && t !== 'episode_embeddings') expect(before[t], t).toBeGreaterThan(0);

    const res = await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(u.accessToken) });
    expect(res.statusCode).toBe(200);
    const receipt = DeletionReceipt.parse(res.json());
    const byTable = Object.fromEntries(receipt.tables.map((t) => [t.table, t.rowsDeleted]));
    for (const t of TENANT_TABLES_DELETE_ORDER) expect(byTable[t], t).toBe(before[t]);
    expect(receipt.subjectHash).toBe(sha256Hex(u.userId));
    expect(receipt.derivedDataPurge).toBe('complete');
    expect(h.c.core.privacy.verifyReceipt(receipt)).toBe(true);
    expect(h.c.core.privacy.verifyReceipt({ ...receipt, tables: receipt.tables.map((t) => ({ ...t, rowsDeleted: t.rowsDeleted + 1 })) })).toBe(false);

    const after = await countsFor(u.userId);
    for (const t of TENANT_TABLES_DELETE_ORDER) expect(after[t], t).toBe(0);
    expect(await countsFor(other.u.userId)).toEqual(otherBefore);

    // Receipt retained without identity.
    const stored = await h.admin.query('select subject_hash, body::text as body from deletion_receipts where receipt_id = $1', [receipt.receiptId]);
    expect(stored.rows[0].subject_hash).toBe(receipt.subjectHash);
    expect(stored.rows[0].body).not.toContain(u.userId);
    expect(stored.rows[0].body).not.toContain(u.email);

    // Account is gone.
    expect((await h.app.inject({ method: 'GET', url: '/v1/me', headers: bearer(u.accessToken) })).statusCode).toBe(404);
    const login = await h.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: u.email, password: u.password } });
    expect(login.statusCode).toBe(401);
  });
});

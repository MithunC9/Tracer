import { randomUUID } from 'node:crypto';
import type { IngestResult } from '@tracer/schema';
import type { AuditRow } from '../../src/repositories/audits.js';
import type { EventInsertRow } from '../../src/repositories/events.js';
import type { AuthLookups, Repos, UnitOfWork } from '../../src/repositories/index.js';
import type { PipelineJob } from '../../src/jobs/queue.js';

/**
 * In-memory stand-ins for the repositories, enough for service unit tests. Each table is an
 * array filtered by userId, mimicking RLS. "Transactions" snapshot and restore the store so
 * rollback semantics are honoured.
 */
export class FakeStore {
  users: { id: string; email: string; passwordHash: string; displayName: string | null; constraints: unknown; plan: string; createdAt: Date }[] = [];
  keys: { userId: string; wrappedDek: Buffer }[] = [];
  refresh: { id: string; userId: string; familyId: string; tokenHash: Buffer; expiresAt: Date; rotatedAt: Date | null; revokedAt: Date | null }[] = [];
  pairing: { codeHash: Buffer; selector: Buffer; userId: string; expiresAt: Date; usedAt: Date | null; attempts: number }[] = [];
  devices: { id: string; userId: string; name: string; platform: string; agentVersion: string; tokenHash: Buffer; createdAt: Date; lastSeenAt: Date | null; revokedAt: Date | null }[] = [];
  audits: AuditRow[] = [];
  exclusions = new Map<string, unknown>();
  batches = new Map<string, { userId: string; result: IngestResult }>();
  events: (EventInsertRow & { userId: string; receivedAt: Date })[] = [];
  accessLog: { userId: string; actor: string; actorId: string | null; action: string; resource: string; requestId: string | null; at: Date }[] = [];
  jobs: PipelineJob[] = [];
  usage = new Map<string, number>();
  runs: { id: string; userId: string; auditId: string; state: string }[] = [];

  /** Row-level copy (Buffers shared, they are never mutated). */
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this)) {
      out[k] = Array.isArray(v) ? v.map((r) => ({ ...r })) : v instanceof Map ? new Map(v) : v;
    }
    return out;
  }
  restore(s: Record<string, unknown>) {
    Object.assign(this, s);
  }
}

export function fakeRepos(store: FakeStore, userId: string): Repos {
  const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => r.userId === userId);
  const repos = {
    userId,
    users: {
      insert: async (row: { id: string; email: string; passwordHash: string; displayName: string | null }) => {
        if (store.users.some((u) => u.email.toLowerCase() === row.email.toLowerCase())) throw Object.assign(new Error('dup'), { code: '23505' });
        const u = { ...row, constraints: {}, plan: 'free', createdAt: new Date() };
        store.users.push(u);
        return u;
      },
      findById: async (id: string) => (id === userId ? (store.users.find((u) => u.id === id) ?? null) : null),
      update: async (id: string, patch: object) => {
        const u = store.users.find((x) => x.id === id && id === userId);
        if (!u) return null;
        Object.assign(u, patch);
        return u;
      },
    },
    keys: {
      insert: async (uid: string, wrappedDek: Buffer) => void store.keys.push({ userId: uid, wrappedDek }),
      get: async (uid: string) => (uid === userId ? (store.keys.find((k) => k.userId === uid) ?? null) : null),
    },
    refreshTokens: {
      insert: async (row: { userId: string; familyId: string; tokenHash: Buffer; expiresAt: Date }) =>
        void store.refresh.push({ id: randomUUID(), rotatedAt: null, revokedAt: null, ...row }),
      markRotated: async (id: string, at: Date) => {
        const t = mine(store.refresh).find((x) => x.id === id && !x.rotatedAt && !x.revokedAt);
        if (!t) return false;
        t.rotatedAt = at;
        return true;
      },
      revokeFamily: async (familyId: string, at: Date) => {
        const fam = mine(store.refresh).filter((x) => x.familyId === familyId && !x.revokedAt);
        for (const t of fam) t.revokedAt = at;
        return fam.length;
      },
      pruneExpired: async () => {},
    },
    pairing: {
      deleteForUser: async () => void (store.pairing = store.pairing.filter((p) => p.userId !== userId)),
      insert: async (row: { codeHash: Buffer; selector: Buffer; expiresAt: Date }) => void store.pairing.push({ ...row, userId, usedAt: null, attempts: 0 }),
      incrementAttempts: async (h: Buffer) => {
        const p = mine(store.pairing).find((x) => x.codeHash.equals(h));
        if (!p) return 0;
        return ++p.attempts;
      },
      markUsed: async (h: Buffer, at: Date) => {
        const p = mine(store.pairing).find((x) => x.codeHash.equals(h) && !x.usedAt);
        if (!p) return false;
        p.usedAt = at;
        return true;
      },
    },
    devices: {
      insert: async (row: { name: string; platform: string; agentVersion: string; tokenHash: Buffer }) => {
        const d = { ...row, id: randomUUID(), userId, createdAt: new Date(), lastSeenAt: null, revokedAt: null };
        store.devices.push(d);
        return d;
      },
      list: async () => mine(store.devices),
      findById: async (id: string) => mine(store.devices).find((d) => d.id === id) ?? null,
      revoke: async (id: string, at: Date) => {
        const d = mine(store.devices).find((x) => x.id === id);
        if (!d) return false;
        d.revokedAt ??= at;
        return true;
      },
      touch: async (id: string, at: Date) => {
        const d = mine(store.devices).find((x) => x.id === id);
        if (d) d.lastSeenAt = at;
      },
    },
    audits: {
      insert: async (row: Pick<AuditRow, 'status' | 'lengthDays' | 'startsAt' | 'endsAt' | 'recurrence'>) => {
        if (mine(store.audits).some((a) => ['scheduled', 'capturing', 'paused'].includes(a.status))) throw Object.assign(new Error('dup'), { code: '23505' });
        const a: AuditRow = { ...row, id: randomUUID(), userId, pausedAt: null, pausedSeconds: 0, createdAt: new Date(), completedAt: null };
        store.audits.push(a);
        return a;
      },
      list: async () => mine(store.audits).map((a) => ({ ...a })),
      findById: async (id: string) => {
        const a = mine(store.audits).find((x) => x.id === id);
        return a ? { ...a } : null;
      },
      findOpen: async () => {
        const a = mine(store.audits).find((x) => ['scheduled', 'capturing', 'paused'].includes(x.status));
        return a ? { ...a } : null;
      },
      transition: async (id: string, from: string[], patch: Partial<AuditRow>) => {
        const a = mine(store.audits).find((x) => x.id === id && from.includes(x.status));
        if (!a) return null;
        Object.assign(a, patch);
        return { ...a };
      },
      withReports: async () => new Set<string>(),
      findRecentlyClosed: async (since: Date) => {
        const a = mine(store.audits)
          .filter((x) => ['analyzing', 'complete', 'failed'].includes(x.status) && x.endsAt >= since)
          .sort((x, y) => y.endsAt.getTime() - x.endsAt.getTime())[0];
        return a ? { ...a } : null;
      },
    },
    exclusions: {
      get: async () => store.exclusions.get(userId) ?? null,
      put: async (v: unknown) => void store.exclusions.set(userId, v),
    },
    events: {
      lockUserIngest: async () => {},
      findBatch: async (id: string) => {
        const b = store.batches.get(id);
        return b && b.userId === userId ? b.result : null;
      },
      insertBatch: async (id: string, _d: string, result: IngestResult) => void store.batches.set(id, { userId, result }),
      insertEvents: async (rows: EventInsertRow[], receivedAt: Date) => {
        let n = 0;
        for (const r of rows) {
          if (store.events.some((e) => e.id === r.id)) continue;
          store.events.push({ ...r, userId, receivedAt });
          n++;
        }
        return n;
      },
      usage: async (day: string) => store.usage.get(`${userId}:${day}`) ?? 0,
      addUsage: async (day: string, n: number) => void store.usage.set(`${userId}:${day}`, (store.usage.get(`${userId}:${day}`) ?? 0) + n),
    },
    pipeline: {
      createRun: async (auditId: string) => {
        const run = { id: randomUUID(), userId, auditId, state: 'queued', createdAt: new Date() };
        store.runs.push(run);
        return run;
      },
      stages: async () => [],
    },
    accessLog: {
      insert: async (e: Omit<FakeStore['accessLog'][number], 'userId'>) => void store.accessLog.push({ ...e, userId }),
    },
    privacy: {},
    jobs: { enqueueStage: async (job: PipelineJob) => void store.jobs.push(job) },
  };
  return repos as unknown as Repos;
}

export class FakeUow implements UnitOfWork {
  private depth = 0;
  constructor(readonly store: FakeStore) {}
  async run<T>(userId: string, fn: (r: Repos) => Promise<T>): Promise<T> {
    const snap = this.depth === 0 ? this.store.snapshot() : null;
    this.depth++;
    try {
      return await fn(fakeRepos(this.store, userId));
    } catch (e) {
      if (snap) this.store.restore(snap);
      throw e;
    } finally {
      this.depth--;
    }
  }
}

export function fakeLookups(store: FakeStore): AuthLookups {
  return {
    userByEmail: async (email) => {
      const u = store.users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      return u ? { id: u.id, passwordHash: u.passwordHash } : null;
    },
    deviceByTokenHash: async (h) => {
      const d = store.devices.find((x) => x.tokenHash.equals(h));
      return d ? { deviceId: d.id, userId: d.userId, revokedAt: d.revokedAt } : null;
    },
    refreshToken: async (h) => store.refresh.find((t) => t.tokenHash.equals(h)) ?? null,
    pairingCode: async (sel) => store.pairing.find((p) => p.selector.equals(sel)) ?? null,
    auditsDue: async (now) =>
      store.audits
        .filter((a) => (a.status === 'scheduled' && a.startsAt <= now) || (['scheduled', 'capturing', 'paused'].includes(a.status) && a.endsAt <= now))
        .map((a) => ({ auditId: a.id, userId: a.userId, status: a.status })),
    purgePairingCodes: async () => 0,
  };
}

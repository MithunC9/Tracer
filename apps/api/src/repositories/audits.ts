import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { AuditStatus } from '@tracer/schema';
import { audits, exclusions, reports } from '../db/schema.js';
import type { Tx } from '../db/database.js';

export type AuditRow = typeof audits.$inferSelect;
export const OPEN_STATUSES: AuditStatus[] = ['scheduled', 'capturing', 'paused'];

export class AuditsRepo {
  constructor(private readonly tx: Tx) {}

  async insert(row: { status: AuditStatus; lengthDays: number; startsAt: Date; endsAt: Date; recurrence: string }) {
    const [a] = await this.tx.db
      .insert(audits)
      .values({ ...row, userId: this.tx.userId })
      .returning();
    return a!;
  }

  async list(): Promise<AuditRow[]> {
    return this.tx.db.select().from(audits).where(eq(audits.userId, this.tx.userId)).orderBy(desc(audits.createdAt));
  }

  async findById(id: string, opts: { forUpdate?: boolean } = {}): Promise<AuditRow | null> {
    const q = this.tx.db.select().from(audits).where(and(eq(audits.id, id), eq(audits.userId, this.tx.userId)));
    const [a] = opts.forUpdate ? await q.for('update') : await q;
    return a ?? null;
  }

  /** The user's open capture window (at most one, enforced by a partial unique index). */
  async findOpen(opts: { forUpdate?: boolean } = {}): Promise<AuditRow | null> {
    const q = this.tx.db
      .select()
      .from(audits)
      .where(and(eq(audits.userId, this.tx.userId), inArray(audits.status, OPEN_STATUSES)));
    const [a] = opts.forUpdate ? await q.for('update') : await q;
    return a ?? null;
  }

  /** Most recent window that closed after `since` (for late uploads). */
  async findRecentlyClosed(since: Date): Promise<AuditRow | null> {
    const [a] = await this.tx.db
      .select()
      .from(audits)
      .where(and(eq(audits.userId, this.tx.userId), inArray(audits.status, ['analyzing', 'complete', 'failed']), gte(audits.endsAt, since)))
      .orderBy(desc(audits.endsAt))
      .limit(1);
    return a ?? null;
  }

  /** Compare-and-set transition. Returns the updated row, or null if the audit was not in `from`. */
  async transition(id: string, from: AuditStatus[], patch: Partial<Omit<AuditRow, 'id' | 'userId'>>): Promise<AuditRow | null> {
    const [a] = await this.tx.db
      .update(audits)
      .set(patch)
      .where(and(eq(audits.id, id), eq(audits.userId, this.tx.userId), inArray(audits.status, from)))
      .returning();
    return a ?? null;
  }

  async withReports(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.tx.db
      .select({ id: reports.auditId })
      .from(reports)
      .where(and(eq(reports.userId, this.tx.userId), inArray(reports.auditId, ids)));
    return new Set(rows.map((r) => r.id));
  }
}

export class ExclusionsRepo {
  constructor(private readonly tx: Tx) {}

  async get(): Promise<unknown | null> {
    const [r] = await this.tx.db.select().from(exclusions).where(eq(exclusions.userId, this.tx.userId));
    return r?.value ?? null;
  }

  async put(value: unknown, at: Date) {
    await this.tx.db
      .insert(exclusions)
      .values({ userId: this.tx.userId, value, updatedAt: at })
      .onConflictDoUpdate({ target: exclusions.userId, set: { value, updatedAt: at } });
  }
}

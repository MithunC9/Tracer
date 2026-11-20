import { and, desc, eq, lt, or } from 'drizzle-orm';
import { accessLog, TENANT_TABLES_DELETE_ORDER, type TenantTable } from '../db/schema.js';
import type { Tx } from '../db/database.js';

export type AccessLogRow = typeof accessLog.$inferSelect;
export type Actor = 'user' | 'device' | 'system';

export class AccessLogRepo {
  constructor(private readonly tx: Tx) {}

  async insert(e: { actor: Actor; actorId: string | null; action: string; resource: string; requestId: string | null; at: Date }) {
    await this.tx.db.insert(accessLog).values({ ...e, userId: this.tx.userId });
  }

  /** Newest first; cursor = `${iso}|${id}` of the last row of the previous page. */
  async page(cursor: { at: Date; id: string } | null, limit: number): Promise<AccessLogRow[]> {
    const where = cursor
      ? and(
          eq(accessLog.userId, this.tx.userId),
          or(lt(accessLog.at, cursor.at), and(eq(accessLog.at, cursor.at), lt(accessLog.id, cursor.id))),
        )
      : eq(accessLog.userId, this.tx.userId);
    return this.tx.db.select().from(accessLog).where(where).orderBy(desc(accessLog.at), desc(accessLog.id)).limit(limit);
  }
}

/** Whole-account reads and the hard delete. Table names come from a constant list, never input. */
export class PrivacyRepo {
  constructor(private readonly tx: Tx) {}

  /** Plain rows of a tenant table for export; secrets (hashes, wrapped keys, ciphertexts) excluded by column list. */
  async exportRows(table: 'users' | 'devices' | 'audits' | 'exclusions' | 'access_log' | 'pipeline_runs' | 'reports' | 'stage_outputs' | 'ingest_batches') {
    const cols: Record<typeof table, string> = {
      users: 'id, email, display_name, plan, constraints, consent_self_observation_at, created_at',
      devices: 'id, name, platform, agent_version, created_at, last_seen_at, revoked_at',
      audits: 'id, status, length_days, starts_at, ends_at, recurrence, paused_at, paused_seconds, created_at, completed_at',
      exclusions: 'value, updated_at',
      access_log: 'id, at, actor, actor_id, action, resource, request_id',
      pipeline_runs: 'id, audit_id, state, created_at',
      reports: 'audit_id, run_id, report_enc, created_at',
      stage_outputs: 'run_id, stage, state, attempts, input_hash, error, started_at, finished_at',
      ingest_batches: 'batch_id, device_id, received_at, result',
    };
    const idCol = table === 'users' ? 'id' : 'user_id';
    const r = await this.tx.client.query(`select ${cols[table]} from ${table} where ${idCol} = $1`, [this.tx.userId]);
    return r.rows as Record<string, unknown>[];
  }

  async countAll(): Promise<Record<TenantTable, number>> {
    const out = {} as Record<TenantTable, number>;
    for (const t of TENANT_TABLES_DELETE_ORDER) {
      const idCol = t === 'users' ? 'id' : 'user_id';
      const r = await this.tx.client.query<{ n: number }>(`select count(*)::int as n from ${t} where ${idCol} = $1`, [this.tx.userId]);
      out[t] = r.rows[0]!.n;
    }
    return out;
  }

  /**
   * Hard delete, children first, counting each table explicitly (not via ON DELETE CASCADE) so
   * the receipt reports exactly what each statement removed.
   */
  async deleteAll(): Promise<{ table: TenantTable; rowsDeleted: number }[]> {
    const out: { table: TenantTable; rowsDeleted: number }[] = [];
    for (const t of TENANT_TABLES_DELETE_ORDER) {
      const idCol = t === 'users' ? 'id' : 'user_id';
      const r = await this.tx.client.query(`delete from ${t} where ${idCol} = $1`, [this.tx.userId]);
      out.push({ table: t, rowsDeleted: r.rowCount ?? 0 });
    }
    return out;
  }

  async insertReceipt(r: { receiptId: string; subjectHash: string; body: unknown; signature: string; at: Date }) {
    await this.tx.client.query(
      'insert into deletion_receipts (receipt_id, subject_hash, body, signature, created_at) values ($1, $2, $3, $4, $5)',
      [r.receiptId, r.subjectHash, JSON.stringify(r.body), r.signature, r.at],
    );
  }
}

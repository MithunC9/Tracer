import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

/** A tenant-scoped transaction: one pooled connection, `app.user_id` set for its lifetime. */
export interface Tx {
  readonly userId: string;
  readonly db: NodePgDatabase;
  /** Raw client, for bulk statements and for enqueueing jobs inside the same transaction. */
  readonly client: pg.PoolClient;
}

export interface TxOptions {
  readOnly?: boolean;
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
}

export function createPool(opts: { connectionString: string; max: number; statementTimeoutMs: number; applicationName?: string }) {
  return new pg.Pool({
    connectionString: opts.connectionString,
    max: opts.max,
    application_name: opts.applicationName ?? 'tracer-api',
    options: `-c statement_timeout=${opts.statementTimeoutMs} -c idle_in_transaction_session_timeout=60000`,
    connectionTimeoutMillis: 5_000,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Owns the pool and the only code path that opens transactions for tenant data.
 *
 * Every unit of work runs as `BEGIN; SELECT set_config('app.user_id', $1, true); ...; COMMIT`.
 * `set_config(..., true)` is `SET LOCAL`: the setting dies with the transaction, so a pooled
 * connection can never leak one tenant's id into another request. RLS policies read it.
 *
 * Nested calls for the same tenant join the ambient transaction (AsyncLocalStorage), which is
 * how the access-log decorator writes its row atomically with the operation it records.
 */
export class Database {
  private readonly als = new AsyncLocalStorage<Tx>();

  constructor(readonly pool: pg.Pool) {}

  current(): Tx | undefined {
    return this.als.getStore();
  }

  async withTenant<T>(userId: string, fn: (tx: Tx) => Promise<T>, opts: TxOptions = {}): Promise<T> {
    if (!UUID_RE.test(userId)) throw new Error('withTenant: userId must be a uuid');
    const ambient = this.als.getStore();
    if (ambient) {
      if (ambient.userId !== userId) throw new Error('withTenant: nested transaction for a different tenant');
      return fn(ambient);
    }
    const client = await this.pool.connect();
    let released = false;
    try {
      const mode = [opts.isolation ? `isolation level ${opts.isolation}` : '', opts.readOnly ? 'read only' : '']
        .filter(Boolean)
        .join(' ');
      await client.query(`begin ${mode}`);
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
      const tx: Tx = { userId, client, db: drizzle({ client }) };
      const result = await this.als.run(tx, () => fn(tx));
      await client.query('commit');
      return result;
    } catch (err) {
      try {
        await client.query('rollback');
      } catch {
        // Connection is broken; destroy it rather than return it to the pool.
        client.release(true);
        released = true;
      }
      throw err;
    } finally {
      if (!released) client.release();
    }
  }

  /**
   * A tenant transaction that outlives the call, for streaming exports. Caller must call
   * `end()` exactly once (commit on success, rollback on error).
   */
  async openTenantTx(userId: string, opts: TxOptions = {}): Promise<Tx & { end(ok: boolean): Promise<void> }> {
    if (!UUID_RE.test(userId)) throw new Error('openTenantTx: userId must be a uuid');
    const client = await this.pool.connect();
    try {
      await client.query(`begin isolation level ${opts.isolation ?? 'repeatable read'}${opts.readOnly ? ' read only' : ''}`);
      await client.query(`select set_config('app.user_id', $1, true)`, [userId]);
    } catch (err) {
      client.release(true);
      throw err;
    }
    let done = false;
    return {
      userId,
      client,
      db: drizzle({ client }),
      end: async (ok: boolean) => {
        if (done) return;
        done = true;
        try {
          await client.query(ok ? 'commit' : 'rollback');
          client.release();
        } catch {
          client.release(true);
        }
      },
    };
  }

  /** Non-tenant statements: SECURITY DEFINER lookups, health checks. Never touches tenant tables directly. */
  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  async close() {
    await this.pool.end();
  }
}

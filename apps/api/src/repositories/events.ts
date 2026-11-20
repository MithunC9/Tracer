import type { IngestResult } from '@tracer/schema';
import type { Tx } from '../db/database.js';

export interface EventInsertRow {
  id: string;
  auditId: string;
  deviceId: string;
  ts: Date;
  seq: number;
  kind: string;
  appKey: string | null;
  redactions: Record<string, number>;
  payloadEnc: Buffer;
}

export interface EventCursor {
  ts: Date;
  id: string;
}

/** Ingest + event reads. Aggregates are plain parameterized SQL; nothing here decrypts. */
export class EventsRepo {
  constructor(private readonly tx: Tx) {}

  async findBatch(batchId: string): Promise<IngestResult | null> {
    const r = await this.tx.client.query<{ result: IngestResult }>(
      'select result from ingest_batches where batch_id = $1 and user_id = $2',
      [batchId, this.tx.userId],
    );
    return r.rows[0]?.result ?? null;
  }

  async insertBatch(batchId: string, deviceId: string, result: IngestResult, at: Date) {
    await this.tx.client.query(
      'insert into ingest_batches (batch_id, user_id, device_id, received_at, result) values ($1, $2, $3, $4, $5)',
      [batchId, this.tx.userId, deviceId, at, JSON.stringify(result)],
    );
  }

  /**
   * Bulk insert in one round trip (unnest of column arrays). `ON CONFLICT DO NOTHING` makes the
   * client event id an idempotency key; the returned count excludes duplicates.
   */
  async insertEvents(rows: EventInsertRow[], receivedAt: Date): Promise<number> {
    if (rows.length === 0) return 0;
    const r = await this.tx.client.query(
      `insert into events (id, user_id, audit_id, device_id, ts, seq, kind, app_key, redactions, payload_enc, received_at)
       select id, $2, audit_id, device_id, ts, seq, kind, app_key, redactions, payload_enc, $10
       from unnest($1::uuid[], $3::uuid[], $4::uuid[], $5::timestamptz[], $6::bigint[], $7::text[], $8::text[], $9::jsonb[], $11::bytea[])
         as t(id, audit_id, device_id, ts, seq, kind, app_key, redactions, payload_enc)
       on conflict (id) do nothing`,
      [
        rows.map((x) => x.id),
        this.tx.userId,
        rows.map((x) => x.auditId),
        rows.map((x) => x.deviceId),
        rows.map((x) => x.ts.toISOString()),
        rows.map((x) => x.seq),
        rows.map((x) => x.kind),
        rows.map((x) => x.appKey),
        rows.map((x) => JSON.stringify(x.redactions)),
        receivedAt,
        rows.map((x) => x.payloadEnc),
      ],
    );
    return r.rowCount ?? 0;
  }

  async countReceivedSince(since: Date): Promise<number> {
    const r = await this.tx.client.query<{ n: number }>(
      'select count(*)::int as n from events where user_id = $1 and received_at >= $2',
      [this.tx.userId, since],
    );
    return r.rows[0]?.n ?? 0;
  }

  /** Serialize concurrent ingests of one user (quota accounting, batch idempotency). */
  async lockUserIngest() {
    await this.tx.client.query(`select pg_advisory_xact_lock(hashtextextended('ingest:' || $1, 0))`, [this.tx.userId]);
  }

  async statusCounts(auditId: string, startsAt: Date, idleCapSeconds: number) {
    const totals = await this.tx.client.query<{ events: number; apps: number; devices: number; last: Date | null }>(
      `select count(*)::int as events, count(distinct app_key)::int as apps,
              count(distinct device_id)::int as devices, max(ts) as last
       from events where audit_id = $1 and user_id = $2`,
      [auditId, this.tx.userId],
    );
    // Active time = gaps between successive events on the same device, capped at the idle
    // threshold, excluding gaps that start at an idle/capture-state boundary.
    const perDay = await this.tx.client.query<{ day_index: number; events: number; active_seconds: number }>(
      `with e as (
         select ts, kind, lead(ts) over (partition by device_id order by ts, seq) as next_ts
         from events where audit_id = $1 and user_id = $2
       )
       select floor(extract(epoch from (ts - $3::timestamptz)) / 86400)::int as day_index,
              count(*)::int as events,
              coalesce(sum(case when kind in ('idle_start', 'capture_state') or next_ts is null then 0
                                else least(extract(epoch from (next_ts - ts)), $4) end), 0)::float8 as active_seconds
       from e group by 1 order by 1`,
      [auditId, this.tx.userId, startsAt, idleCapSeconds],
    );
    const t = totals.rows[0]!;
    return {
      events: t.events,
      distinctApps: t.apps,
      devices: t.devices,
      lastEventAt: t.last,
      perDay: perDay.rows.map((r) => ({ dayIndex: r.day_index, events: r.events, activeSeconds: r.active_seconds })),
    };
  }

  async capturedSummary() {
    const byKind = await this.tx.client.query<{ kind: string; n: number }>(
      'select kind, count(*)::int as n from events where user_id = $1 group by kind',
      [this.tx.userId],
    );
    const redactions = await this.tx.client.query<{ k: string; n: number }>(
      `select r.key as k, sum(r.value::int)::int as n
       from events e, jsonb_each_text(e.redactions) r where e.user_id = $1 group by r.key`,
      [this.tx.userId],
    );
    const range = await this.tx.client.query<{ oldest: Date | null; newest: Date | null; bytes: string }>(
      `select min(ts) as oldest, max(ts) as newest,
              (coalesce(sum(octet_length(payload_enc)), 0)
               + (select coalesce(sum(octet_length(report_enc)), 0) from reports where user_id = $1)
               + (select coalesce(sum(octet_length(output_enc)), 0) from stage_outputs where user_id = $1))::text as bytes
       from events where user_id = $1`,
      [this.tx.userId],
    );
    const rr = range.rows[0]!;
    return {
      eventsByKind: Object.fromEntries(byKind.rows.map((r) => [r.kind, r.n])),
      redactionsByKind: Object.fromEntries(redactions.rows.map((r) => [r.k, r.n])),
      oldestEventAt: rr.oldest,
      newestEventAt: rr.newest,
      storageBytes: Number(rr.bytes),
    };
  }

  /** Keyset page of encrypted payloads, ordered by (ts, id). `auditId` null = all of the user's events. */
  async page(auditId: string | null, after: EventCursor | null, limit: number) {
    const r = await this.tx.client.query<{ id: string; ts: Date; payload_enc: Buffer }>(
      `select id, ts, payload_enc from events
       where user_id = $1 and ($2::uuid is null or audit_id = $2)
         and ($3::timestamptz is null or (ts, id) > ($3::timestamptz, $4::uuid))
       order by ts, id limit $5`,
      [this.tx.userId, auditId, after?.ts ?? null, after?.id ?? null, limit],
    );
    return r.rows.map((x) => ({ id: x.id, ts: x.ts, payloadEnc: x.payload_enc }));
  }

  /** Content fingerprint of an audit's events (ids + count), for the first stage's input hash. */
  async fingerprint(auditId: string): Promise<{ count: number; digest: string }> {
    const r = await this.tx.client.query<{ n: number; d: string | null }>(
      `select count(*)::int as n,
              encode(sha256(convert_to(string_agg(id::text, ',' order by ts, id), 'UTF8')), 'hex') as d
       from events where user_id = $1 and audit_id = $2`,
      [this.tx.userId, auditId],
    );
    return { count: r.rows[0]?.n ?? 0, digest: r.rows[0]?.d ?? 'empty' };
  }
}

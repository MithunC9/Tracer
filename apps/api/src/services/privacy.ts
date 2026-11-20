import { randomUUID } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import yazl from 'yazl';
import {
  Exclusions,
  type AccessLogEntry,
  type CapturedSummary,
  type DeletionReceipt,
} from '@tracer/schema';
import type { Database } from '../db/database.js';
import type { Clock } from '../lib/clock.js';
import { aad, decryptJson } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { canonicalJson, hmacSha256Hex, sha256Hex } from '../lib/tokens.js';
import type { JobQueue } from '../jobs/queue.js';
import { createRepos, type UnitOfWork } from '../repositories/index.js';
import type { Actor, KeyService } from './context.js';
import { loadExclusions } from './pipeline.js';

const PAGE = 1000;

/** Signs receipts with a key derived from MASTER_KEY; verification needs only the same key. */
export function signReceipt(key: Buffer, body: Omit<DeletionReceipt, 'signature'>): string {
  return hmacSha256Hex(key, canonicalJson(body));
}

/**
 * Privacy Center: exclusions, captured summary, access log, export and hard delete.
 */
export class PrivacyService {
  private readonly receiptKey: Buffer;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly db: Database,
    private readonly keys: KeyService,
    private readonly queue: JobQueue,
    private readonly clock: Clock,
  ) {
    this.receiptKey = keys.subkey('deletion-receipt-hmac');
  }

  getExclusions(actor: Actor): Promise<Exclusions> {
    return this.uow.run(actor.userId, (r) => loadExclusions(r));
  }

  putExclusions(actor: Actor, value: Exclusions): Promise<Exclusions> {
    const clean = Exclusions.parse(value);
    return this.uow.run(actor.userId, async (r) => {
      await r.exclusions.put(clean, this.clock.now());
      return clean;
    });
  }

  captured(actor: Actor): Promise<CapturedSummary> {
    return this.uow.run(actor.userId, async (r) => {
      const s = await r.events.capturedSummary();
      return {
        eventsByKind: s.eventsByKind,
        redactionsByKind: s.redactionsByKind,
        oldestEventAt: s.oldestEventAt?.toISOString() ?? null,
        newestEventAt: s.newestEventAt?.toISOString() ?? null,
        storageBytes: s.storageBytes,
      };
    });
  }

  accessLog(actor: Actor, q: { cursor?: string | undefined; limit: number }): Promise<{ items: AccessLogEntry[]; nextCursor: string | null }> {
    let cursor: { at: Date; id: string } | null = null;
    if (q.cursor) {
      const [at, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('|');
      const d = new Date(at ?? '');
      if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw errors.badRequest('Invalid cursor');
      cursor = { at: d, id };
    }
    return this.uow.run(actor.userId, async (r) => {
      const rows = await r.accessLog.page(cursor, q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((x) => ({
          id: x.id,
          at: x.at.toISOString(),
          actor: x.actor as AccessLogEntry['actor'],
          actorId: x.actorId,
          action: x.action,
          resource: x.resource,
          requestId: x.requestId,
        })),
        nextCursor: rows.length > q.limit && last ? Buffer.from(`${last.at.toISOString()}|${last.id}`).toString('base64url') : null,
      };
    });
  }

  /**
   * Zip of JSON files, streamed. Reads happen in one REPEATABLE READ, READ ONLY tenant
   * transaction (a consistent snapshot); events are decrypted page by page so memory stays flat.
   */
  async exportZip(actor: Actor): Promise<{ filename: string; stream: Readable }> {
    const tx = await this.db.openTenantTx(actor.userId, { readOnly: true, isolation: 'repeatable read' });
    try {
      const r = createRepos(tx, this.queue);
      const dek = await this.keys.get(r);
      const [user] = await r.privacy.exportRows('users');
      if (!user) throw errors.notFound('Account');
      const json = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2));
      const zip = new yazl.ZipFile();
      const files: Record<string, unknown> = {
        'account.json': user,
        'devices.json': await r.privacy.exportRows('devices'),
        'audits.json': await r.privacy.exportRows('audits'),
        'exclusions.json': await loadExclusions(r),
        'access-log.json': await r.privacy.exportRows('access_log'),
        'pipeline-runs.json': await r.privacy.exportRows('pipeline_runs'),
        'pipeline-stages.json': await r.privacy.exportRows('stage_outputs'),
        'ingest-batches.json': await r.privacy.exportRows('ingest_batches'),
        'reports.json': (await r.privacy.exportRows('reports')).map((row) => ({
          auditId: row.audit_id,
          runId: row.run_id,
          createdAt: row.created_at,
          report: decryptJson(dek, row.report_enc as Buffer, aad.report(actor.userId, String(row.audit_id))),
        })),
      };
      const mtime = this.clock.now();
      zip.addBuffer(
        json({ exportedAt: mtime.toISOString(), format: 'tracer-export/1', files: [...Object.keys(files), 'events.json'] }),
        'README.json',
        { mtime },
      );
      for (const [name, v] of Object.entries(files)) zip.addBuffer(json(v), name, { mtime });

      async function* events() {
        yield '[';
        let after: { ts: Date; id: string } | null = null;
        let first = true;
        for (;;) {
          const page = await r.events.page(null, after, PAGE);
          for (const e of page) {
            yield (first ? '\n' : ',\n') + JSON.stringify(decryptJson(dek, e.payloadEnc, aad.event(actor.userId, e.id)));
            first = false;
          }
          if (page.length < PAGE) break;
          const last = page[page.length - 1]!;
          after = { ts: last.ts, id: last.id };
        }
        yield '\n]\n';
      }
      const eventsStream = Readable.from(events());
      eventsStream.on('end', () => void tx.end(true));
      eventsStream.on('error', () => void tx.end(false));
      zip.addReadStream(eventsStream, 'events.json', { mtime });
      zip.end();

      const out = new PassThrough();
      zip.outputStream.on('error', (err) => out.destroy(err));
      out.on('close', () => void tx.end(false)); // client aborted: no-op if already ended
      zip.outputStream.pipe(out);
      return { filename: `tracer-export-${mtime.toISOString().slice(0, 10)}.zip`, stream: out };
    } catch (err) {
      await tx.end(false);
      throw err;
    }
  }

  /**
   * Hard delete in one transaction, then crypto-shred: the wrapped DEK row is deleted in the
   * same transaction and the in-memory copy is zeroed. Jobs are purged first so no worker
   * recreates data. The receipt is stored without identity (subject hash only).
   */
  async deleteAccount(actor: Actor): Promise<DeletionReceipt> {
    const requestedAt = this.clock.now();
    const jobsRemoved = await this.queue.purgeUser(actor.userId);
    const receipt = await this.uow.run(actor.userId, async (r) => {
      if (!(await r.users.findById(actor.userId))) throw errors.notFound('Account');
      const tables = await r.privacy.deleteAll();
      const body: Omit<DeletionReceipt, 'signature'> = {
        receiptId: randomUUID(),
        subjectHash: sha256Hex(actor.userId),
        requestedAt: requestedAt.toISOString(),
        completedAt: this.clock.now().toISOString(),
        tables: [...tables, { table: 'pgboss.job', rowsDeleted: jobsRemoved }],
        derivedDataPurge: 'complete',
      };
      const signed: DeletionReceipt = { ...body, signature: signReceipt(this.receiptKey, body) };
      await r.privacy.insertReceipt({
        receiptId: signed.receiptId,
        subjectHash: signed.subjectHash,
        body,
        signature: signed.signature,
        at: this.clock.now(),
      });
      return signed;
    });
    this.keys.forget(actor.userId);
    return receipt;
  }

  verifyReceipt(receipt: DeletionReceipt): boolean {
    const { signature, ...body } = receipt;
    return signReceipt(this.receiptKey, body) === signature;
  }
}

import { isExcluded, type ActivityEvent, type IngestBatch, type IngestResult } from '@tracer/schema';
import { DAY_MS, type Clock } from '../lib/clock.js';
import { aad, encryptJson } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import type { TokenBucketLimiter } from '../lib/rate-limit.js';
import type { Metrics } from '../observability/metrics.js';
import type { EventInsertRow } from '../repositories/events.js';
import type { UnitOfWork } from '../repositories/index.js';
import type { AuditsService } from './audits.js';
import type { Actor, KeyService } from './context.js';
import { loadExclusions } from './pipeline.js';

/** Tolerated device clock skew for event timestamps. */
const SKEW_MS = 5 * 60_000;
/** How long after a window closes events stamped inside it are still accepted. */
export const LATE_UPLOAD_GRACE_MS = 24 * 3600_000;

export type RejectReason =
  | 'no_open_audit'
  | 'capture_paused'
  | 'outside_window'
  | 'future_timestamp'
  | 'excluded_by_policy'
  | 'daily_quota_exceeded';

function exclusionTarget(e: ActivityEvent) {
  switch (e.kind) {
    case 'app_focus':
      return { appKey: e.app.key, urlHost: e.urlHost, windowTitle: e.windowTitle };
    case 'clipboard_change':
    case 'text_digest':
      return { appKey: e.app.key };
    default:
      return null;
  }
}

/**
 * Batch ingest. Idempotent twice over: a replayed batchId returns the stored IngestResult
 * unchanged, and individual event ids are `ON CONFLICT DO NOTHING` (counted as duplicates).
 * One user's ingests are serialized with an advisory lock so quota accounting and batch
 * idempotency are race-free; different users never contend.
 */
export class IngestService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly keys: KeyService,
    private readonly audits: AuditsService,
    private readonly limiter: TokenBucketLimiter,
    private readonly clock: Clock,
    private readonly metrics: Metrics,
    private readonly opts: { dailyQuota: number },
  ) {}

  async ingest(actor: Actor, batch: IngestBatch): Promise<IngestResult> {
    const deviceId = actor.id!;
    const wait = this.limiter.take(`device:${deviceId}`);
    if (wait > 0) {
      this.metrics.ingestBatches.inc({ outcome: 'rate_limited' });
      throw errors.rateLimited(wait, 'Device upload rate exceeded');
    }

    const result = await this.uow.run(actor.userId, async (r) => {
      await r.events.lockUserIngest();
      const replay = await r.events.findBatch(batch.batchId);
      if (replay) return { kind: 'replay' as const, res: replay };

      const now = this.clock.now();
      const dayStart = new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
      const day = dayStart.toISOString().slice(0, 10);
      const usedToday = await r.events.usage(day);
      if (usedToday >= this.opts.dailyQuota) {
        throw errors.quotaExceeded('Daily event quota exhausted', (dayStart.getTime() + DAY_MS - now.getTime()) / 1000);
      }

      let audit = await r.audits.findOpen({ forUpdate: true });
      if (audit) audit = await this.audits.reconcile(r, audit);
      // Late uploads: an agent that was offline flushes its buffer after the window closed.
      // Events stamped inside a recently closed window are still accepted (captureAllowed=false);
      // they are picked up by the next pipeline run (POST /pipeline re-runs cheaply).
      const open =
        (audit && ['capturing', 'paused', 'scheduled'].includes(audit.status) ? audit : null) ??
        (await r.audits.findRecentlyClosed(new Date(now.getTime() - LATE_UPLOAD_GRACE_MS)));
      const exclusions = await loadExclusions(r);
      const dek = await this.keys.get(r);

      const rejected: IngestResult['rejected'] = [];
      const rows: EventInsertRow[] = [];
      let budget = this.opts.dailyQuota - usedToday;
      for (const e of batch.events) {
        const reason = this.check(e, open, now, exclusions);
        if (reason) {
          rejected.push({ id: e.id, reason });
          continue;
        }
        if (budget <= 0) {
          rejected.push({ id: e.id, reason: 'daily_quota_exceeded' satisfies RejectReason });
          continue;
        }
        budget--;
        rows.push({
          id: e.id,
          auditId: open!.id,
          deviceId,
          ts: new Date(e.ts),
          seq: e.seq,
          kind: e.kind,
          appKey: 'app' in e ? e.app.key : null,
          redactions: e.redactions as Record<string, number>,
          payloadEnc: encryptJson(dek, e, aad.event(actor.userId, e.id)),
        });
      }
      const inserted = await r.events.insertEvents(rows, now);
      await r.events.addUsage(day, inserted);
      const res: IngestResult = {
        batchId: batch.batchId,
        accepted: inserted,
        duplicates: rows.length - inserted,
        rejected,
        captureAllowed: open?.status === 'capturing',
        captureUntil: open ? open.endsAt.toISOString() : null,
      };
      await r.events.insertBatch(batch.batchId, deviceId, res, now);
      await r.devices.touch(deviceId, now, batch.agentVersion);
      await r.accessLog.insert({
        actor: 'device',
        actorId: deviceId,
        action: 'events.ingest',
        resource: open ? `audit:${open.id}` : 'audit:none',
        requestId: actor.requestId,
        at: now,
      });
      return { kind: 'fresh' as const, res };
    });

    const res = result.res;
    if (result.kind === 'replay') {
      this.metrics.ingestBatches.inc({ outcome: 'replayed' });
      return res;
    }
    this.metrics.ingestBatches.inc({ outcome: 'stored' });
    this.metrics.ingestEvents.inc({ outcome: 'accepted' }, res.accepted);
    this.metrics.ingestEvents.inc({ outcome: 'duplicate' }, res.duplicates);
    this.metrics.ingestEvents.inc({ outcome: 'rejected' }, res.rejected.length);
    return res;
  }

  private check(
    e: ActivityEvent,
    audit: { status: string; startsAt: Date; endsAt: Date; pausedAt: Date | null } | null,
    now: Date,
    exclusions: Parameters<typeof isExcluded>[0],
  ): RejectReason | null {
    if (!audit) return 'no_open_audit';
    const ts = Date.parse(e.ts);
    if (ts > now.getTime() + SKEW_MS) return 'future_timestamp';
    if (ts < audit.startsAt.getTime() - SKEW_MS || ts > audit.endsAt.getTime() + SKEW_MS) return 'outside_window';
    if (audit.status === 'scheduled') return 'outside_window';
    if (audit.status === 'paused' && audit.pausedAt && ts >= audit.pausedAt.getTime()) return 'capture_paused';
    const target = exclusionTarget(e);
    if (target && isExcluded(exclusions, target)) return 'excluded_by_policy';
    return null;
  }
}

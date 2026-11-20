import { LIMITS, type AgentConfig, type Audit, type CaptureStatus, type CreateAuditRequest } from '@tracer/schema';
import { DAY_MS, type Clock } from '../lib/clock.js';
import { errors, isUniqueViolation } from '../lib/errors.js';
import { OPEN_STATUSES, type AuditRow } from '../repositories/audits.js';
import type { Repos, UnitOfWork, AuthLookups } from '../repositories/index.js';
import type { Actor } from './context.js';
import { loadExclusions, type PipelineService } from './pipeline.js';

export const toAuditDto = (a: AuditRow, reportAvailable: boolean): Audit => ({
  id: a.id,
  status: a.status as Audit['status'],
  lengthDays: a.lengthDays,
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt.toISOString(),
  recurrence: a.recurrence as Audit['recurrence'],
  createdAt: a.createdAt.toISOString(),
  completedAt: a.completedAt?.toISOString() ?? null,
  reportAvailable,
});

/** Accepted lateness for a requested start time (clock skew between browser and server). */
const START_GRACE_MS = 5 * 60_000;

/**
 * Capture windows. State machine:
 *
 *   scheduled --(startsAt)--> capturing <--pause/resume--> paused
 *        \                      |                           /
 *         `----(endsAt or finish)----> analyzing --> complete | failed
 *
 * Time-driven transitions happen in `reconcile`, called both lazily on every read/ingest and by
 * the per-minute sweep job, so behaviour never depends on the sweep having run.
 */
export class AuditsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly lookups: AuthLookups,
    private readonly pipeline: PipelineService,
    private readonly clock: Clock,
  ) {}

  async create(actor: Actor, req: CreateAuditRequest): Promise<Audit> {
    const now = this.clock.now();
    const startsAt = req.startsAt ? new Date(req.startsAt) : now;
    if (startsAt.getTime() < now.getTime() - START_GRACE_MS) throw errors.badRequest('startsAt must not be in the past');
    if (startsAt.getTime() > now.getTime() + 30 * DAY_MS) throw errors.badRequest('startsAt must be within 30 days');
    const effectiveStart = startsAt < now ? now : startsAt;
    return this.uow
      .run(actor.userId, async (r) => {
        const open = await r.audits.findOpen({ forUpdate: true });
        if (open && OPEN_STATUSES.includes((await this.reconcile(r, open)).status as never)) {
          throw errors.conflict('An audit window is already open');
        }
        const a = await r.audits.insert({
          status: effectiveStart > now ? 'scheduled' : 'capturing',
          lengthDays: req.lengthDays,
          startsAt: effectiveStart,
          endsAt: new Date(effectiveStart.getTime() + req.lengthDays * DAY_MS),
          recurrence: req.recurrence ?? 'none',
        });
        return toAuditDto(a, false);
      })
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) throw errors.conflict('An audit window is already open');
        throw err;
      });
  }

  list(actor: Actor): Promise<{ items: Audit[] }> {
    return this.uow.run(actor.userId, async (r) => {
      const open = await r.audits.findOpen();
      if (open) await this.reconcile(r, open);
      const rows = await r.audits.list();
      const withReports = await r.audits.withReports(rows.map((a) => a.id));
      return { items: rows.map((a) => toAuditDto(a, withReports.has(a.id))) };
    });
  }

  get(actor: Actor, id: string): Promise<Audit> {
    return this.uow.run(actor.userId, async (r) => this.dto(r, await this.load(r, id)));
  }

  pause(actor: Actor, id: string): Promise<Audit> {
    return this.uow.run(actor.userId, async (r) => {
      const a = await this.load(r, id);
      const now = this.clock.now();
      const updated = await r.audits.transition(a.id, ['capturing'], { status: 'paused', pausedAt: now });
      if (!updated) throw errors.conflict(`Cannot pause an audit that is ${a.status}`);
      return this.dto(r, updated);
    });
  }

  resume(actor: Actor, id: string): Promise<Audit> {
    return this.uow.run(actor.userId, async (r) => {
      const a = await this.load(r, id);
      const now = this.clock.now();
      const paused = a.pausedAt ? Math.round((now.getTime() - a.pausedAt.getTime()) / 1000) : 0;
      const updated = await r.audits.transition(a.id, ['paused'], {
        status: 'capturing',
        pausedAt: null,
        pausedSeconds: a.pausedSeconds + Math.max(0, paused),
      });
      if (!updated) throw errors.conflict(`Cannot resume an audit that is ${a.status}`);
      return this.dto(r, updated);
    });
  }

  finish(actor: Actor, id: string): Promise<Audit> {
    return this.uow.run(actor.userId, async (r) => {
      const a = await this.load(r, id);
      if (!OPEN_STATUSES.includes(a.status as never)) throw errors.conflict(`Cannot finish an audit that is ${a.status}`);
      return this.dto(r, await this.closeAndAnalyze(r, a));
    });
  }

  status(actor: Actor, id: string): Promise<CaptureStatus> {
    return this.uow.run(actor.userId, async (r) => {
      const a = await this.load(r, id);
      const c = await r.events.statusCounts(a.id, a.startsAt, LIMITS.idleThresholdSeconds);
      const now = this.clock.now();
      const end = Math.min(now.getTime(), a.endsAt.getTime());
      const dayNumber = now < a.startsAt ? 0 : Math.min(a.lengthDays, Math.floor((end - a.startsAt.getTime()) / DAY_MS) + 1);
      const round1 = (n: number) => Math.round(n * 10) / 10;
      return {
        auditId: a.id,
        status: a.status as CaptureStatus['status'],
        dayNumber,
        totalDays: a.lengthDays,
        eventsReceived: c.events,
        activeMinutes: round1(c.perDay.reduce((s, d) => s + d.activeSeconds, 0) / 60),
        distinctApps: c.distinctApps,
        devicesReporting: c.devices,
        lastEventAt: c.lastEventAt?.toISOString() ?? null,
        perDay: c.perDay.map((d) => ({ dayIndex: d.dayIndex, events: d.events, activeMinutes: round1(d.activeSeconds / 60) })),
      };
    });
  }

  agentConfig(actor: Actor): Promise<AgentConfig> {
    return this.uow.run(actor.userId, async (r) => {
      let open = await r.audits.findOpen();
      if (open) open = await this.reconcile(r, open);
      const isOpen = open && OPEN_STATUSES.includes(open.status as never);
      return {
        deviceId: actor.id!,
        auditId: isOpen ? open!.id : null,
        captureAllowed: !!isOpen && open!.status === 'capturing',
        captureFrom: isOpen ? open!.startsAt.toISOString() : null,
        captureUntil: isOpen ? open!.endsAt.toISOString() : null,
        paused: open?.status === 'paused',
        exclusions: await loadExclusions(r),
        uploadIntervalSeconds: LIMITS.defaultUploadIntervalSeconds,
        idleThresholdSeconds: LIMITS.idleThresholdSeconds,
      };
    });
  }

  /**
   * Applies time-driven transitions to an open audit. Returns the current row.
   * scheduled -> capturing at startsAt; open -> analyzing (+ pipeline run) at endsAt.
   */
  async reconcile(r: Repos, a: AuditRow): Promise<AuditRow> {
    const now = this.clock.now();
    if (!OPEN_STATUSES.includes(a.status as never)) return a;
    if (now >= a.endsAt) return this.closeAndAnalyze(r, a);
    if (a.status === 'scheduled' && now >= a.startsAt) {
      return (await r.audits.transition(a.id, ['scheduled'], { status: 'capturing' })) ?? a;
    }
    return a;
  }

  /** Sweep job body: reconcile every due audit, each in its own tenant transaction. */
  async sweep(limit = 500): Promise<number> {
    const due = await this.lookups.auditsDue(this.clock.now(), limit);
    let changed = 0;
    for (const d of due) {
      await this.uow.run(d.userId, async (r) => {
        const a = await r.audits.findById(d.auditId, { forUpdate: true });
        if (a && (await this.reconcile(r, a)).status !== a.status) changed++;
      });
    }
    await this.lookups.purgePairingCodes(this.clock.now());
    return changed;
  }

  private async closeAndAnalyze(r: Repos, a: AuditRow): Promise<AuditRow> {
    const now = this.clock.now();
    const pausedExtra = a.status === 'paused' && a.pausedAt ? Math.max(0, Math.round((now.getTime() - a.pausedAt.getTime()) / 1000)) : 0;
    const endsAt = a.endsAt < now ? a.endsAt : now;
    const updated = await r.audits.transition(a.id, OPEN_STATUSES, {
      status: 'analyzing',
      // A window finished before it started keeps a 1s span so the CHECK (ends > starts) holds.
      endsAt: endsAt > a.startsAt ? endsAt : new Date(a.startsAt.getTime() + 1000),
      pausedAt: null,
      pausedSeconds: a.pausedSeconds + pausedExtra,
    });
    if (!updated) return (await r.audits.findById(a.id)) ?? a;
    await this.pipeline.startRun(r, a.id);
    return updated;
  }

  private async load(r: Repos, id: string): Promise<AuditRow> {
    const a = await r.audits.findById(id);
    if (!a) throw errors.notFound('Audit');
    return this.reconcile(r, a);
  }

  private async dto(r: Repos, a: AuditRow): Promise<Audit> {
    return toAuditDto(a, (await r.audits.withReports([a.id])).has(a.id));
  }
}

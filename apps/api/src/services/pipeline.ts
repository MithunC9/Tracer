import {
  ActivityEvent,
  AuditReport,
  DEFAULT_CONSTRAINTS,
  DEFAULT_EXCLUSIONS,
  Exclusions,
  PIPELINE_STAGES,
  UserConstraints,
  type PipelineRun,
  type PipelineStage,
  type StageState,
} from '@tracer/schema';
import type { Clock } from '../lib/clock.js';
import { aad, decryptJson, encryptJson } from '../lib/crypto.js';
import { errors } from '../lib/errors.js';
import { canonicalJson, sha256Hex } from '../lib/tokens.js';
import type { PipelineJob } from '../jobs/queue.js';
import type { Metrics } from '../observability/metrics.js';
import type { PipelineEngine, StageContext } from '../pipeline/engine.js';
import type { Repos, UnitOfWork } from '../repositories/index.js';
import type { RunRow, StageRow } from '../repositories/pipeline.js';
import type { Actor, KeyService } from './context.js';

export async function loadExclusions(r: Repos): Promise<Exclusions> {
  const v = await r.exclusions.get();
  const p = v ? Exclusions.safeParse(v) : null;
  return p?.success ? p.data : DEFAULT_EXCLUSIONS;
}

export function parseConstraints(v: unknown): UserConstraints {
  const p = UserConstraints.safeParse({ ...DEFAULT_CONSTRAINTS, ...(v && typeof v === 'object' ? v : {}) });
  return p.success ? p.data : DEFAULT_CONSTRAINTS;
}

const LAST_STAGE = PIPELINE_STAGES[PIPELINE_STAGES.length - 1]!;

export function toRunDto(run: RunRow, stages: StageRow[]): PipelineRun {
  const byStage = new Map(stages.map((s) => [s.stage, s]));
  return {
    id: run.id,
    auditId: run.auditId,
    state: run.state as PipelineRun['state'],
    createdAt: run.createdAt.toISOString(),
    stages: PIPELINE_STAGES.map((stage) => {
      const s = byStage.get(stage);
      return {
        stage,
        state: (s?.state ?? 'pending') as StageState,
        attempts: s?.attempts ?? 0,
        startedAt: s?.startedAt?.toISOString() ?? null,
        finishedAt: s?.finishedAt?.toISOString() ?? null,
        error: s?.error ?? null,
        inputHash: s?.inputHash ?? null,
      };
    }),
  };
}

/**
 * Pipeline orchestration. Each stage is one pg-boss job:
 *
 *   tx1: mark stage running, load earlier outputs, compute input hash, cache lookup
 *        (hit => store output as `skipped`, enqueue next stage, done)
 *   ---  engine.runStage(...)                 (no transaction held while the engine works)
 *   tx2: store encrypted output, mark `succeeded`, enqueue next stage in the same transaction
 *        (last stage => validate AuditReport, store report, audit -> complete)
 *
 * Failures mark the stage `failed` and rethrow so pg-boss retries with backoff; when retries
 * run out pg-boss moves the job to the dead-letter queue and `handleDeadLetter` marks it `dead`.
 * Every step is idempotent on redelivery.
 */
export class PipelineService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly keys: KeyService,
    private readonly engine: PipelineEngine,
    private readonly clock: Clock,
    private readonly metrics: Metrics,
  ) {}

  /** Creates a run and enqueues its first stage inside the caller's transaction. */
  async startRun(r: Repos, auditId: string): Promise<{ run: RunRow; stages: StageRow[] }> {
    const run = await r.pipeline.createRun(auditId, PIPELINE_STAGES);
    await r.jobs.enqueueStage({ runId: run.id, userId: r.userId, auditId, stage: PIPELINE_STAGES[0]! });
    return { run, stages: await r.pipeline.stages(run.id) };
  }

  latest(actor: Actor, auditId: string): Promise<PipelineRun | null> {
    return this.uow.run(actor.userId, async (r) => {
      if (!(await r.audits.findById(auditId))) throw errors.notFound('Audit');
      const run = await r.pipeline.latestRun(auditId);
      return run ? toRunDto(run, await r.pipeline.stages(run.id)) : null;
    });
  }

  rerun(actor: Actor, auditId: string): Promise<PipelineRun> {
    return this.uow.run(actor.userId, async (r) => {
      const audit = await r.audits.findById(auditId, { forUpdate: true });
      if (!audit) throw errors.notFound('Audit');
      if (!['complete', 'failed', 'analyzing'].includes(audit.status)) throw errors.conflict(`Cannot analyze an audit that is ${audit.status}`);
      if (await r.pipeline.activeRun(auditId)) throw errors.conflict('A pipeline run is already in progress');
      await r.audits.transition(auditId, ['complete', 'failed', 'analyzing'], { status: 'analyzing', completedAt: null });
      const { run, stages } = await this.startRun(r, auditId);
      return toRunDto(run, stages);
    });
  }

  report(actor: Actor, auditId: string): Promise<AuditReport> {
    return this.uow.run(actor.userId, async (r) => {
      const row = await r.pipeline.getReport(auditId);
      if (!row) throw errors.notFound('Report');
      const dek = await this.keys.get(r);
      const parsed = AuditReport.safeParse(decryptJson(dek, row.reportEnc, aad.report(r.userId, auditId)));
      if (!parsed.success) throw new Error(`stored report for audit ${auditId} failed validation`);
      return parsed.data;
    });
  }

  /** pg-boss handler for one stage job. */
  async runStageJob(job: PipelineJob, signal?: AbortSignal): Promise<void> {
    const { userId, runId, stage } = job;
    const started = performance.now();
    const prep = await this.uow.run(userId, async (r) => {
      const run = await r.pipeline.getRun(runId);
      const row = await r.pipeline.getStage(runId, stage, { forUpdate: true });
      if (!run || !row || run.state === 'failed') return null; // user deleted / run abandoned: drop the job
      if (row.state === 'succeeded' || row.state === 'skipped') return null; // redelivery after commit
      const audit = await r.audits.findById(job.auditId);
      const user = await r.users.findById(userId);
      if (!audit || !user) return null;

      await r.pipeline.beginAttempt(runId, stage, this.clock.now());
      if (run.state === 'queued') await r.pipeline.setRunState(runId, 'running');

      const dek = await this.keys.get(r);
      const idx = PIPELINE_STAGES.indexOf(stage);
      const outputs: Partial<Record<PipelineStage, unknown>> = {};
      const stageRows = new Map((await r.pipeline.stages(runId)).map((s) => [s.stage, s]));
      for (const s of PIPELINE_STAGES.slice(0, idx)) {
        const sr = stageRows.get(s);
        if (!sr?.outputEnc || !sr.inputHash) throw new Error(`stage ${s} has no output; cannot run ${stage}`);
        outputs[s] = decryptJson(dek, sr.outputEnc, aad.stageOutput(userId, s, sr.inputHash));
      }
      const ctx: StageContext = {
        userId,
        auditId: audit.id,
        runId,
        audit: {
          startsAt: audit.startsAt.toISOString(),
          endsAt: audit.endsAt.toISOString(),
          lengthDays: audit.lengthDays,
          pausedSeconds: audit.pausedSeconds,
        },
        exclusions: await loadExclusions(r),
        constraints: parseConstraints(user.constraints),
        now: this.clock.now().toISOString(),
      };
      const fingerprint = await r.events.fingerprint(audit.id);
      const { now: _now, runId: _run, ...stableCtx } = ctx;
      const inputHash = sha256Hex(
        canonicalJson({
          engine: this.engine.version,
          stage,
          events: fingerprint,
          ctx: stableCtx,
          previous: PIPELINE_STAGES.slice(0, idx).map((s) => sha256Hex(canonicalJson(outputs[s] ?? null))),
        }),
      );

      const cached = await r.pipeline.findCached(stage, inputHash);
      if (cached) {
        const output = decryptJson(dek, cached, aad.stageOutput(userId, stage, inputHash));
        await this.complete(r, job, inputHash, output, 'skipped');
        return { cachedHit: true as const };
      }
      await r.pipeline.updateStage(runId, stage, { inputHash });
      return { ctx, outputs, inputHash, previous: idx > 0 ? outputs[PIPELINE_STAGES[idx - 1]!] : undefined };
    });
    if (!prep) return;
    if ('cachedHit' in prep) {
      this.metrics.stageDuration.observe({ stage, outcome: 'cached' }, (performance.now() - started) / 1000);
      return;
    }

    try {
      let memo: Promise<ActivityEvent[]> | null = null;
      const output = await this.engine.runStage(
        stage,
        {
          events: () => (memo ??= this.loadEvents(userId, job.auditId)),
          previous: prep.previous,
          outputs: prep.outputs,
        },
        { ...prep.ctx, ...(signal ? { signal } : {}) },
      );
      if (output === undefined) throw new Error(`stage ${stage} returned no output`);
      await this.uow.run(userId, (r) => this.complete(r, job, prep.inputHash, output, 'succeeded'));
      this.metrics.stageDuration.observe({ stage, outcome: 'succeeded' }, (performance.now() - started) / 1000);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.metrics.stageFailures.inc({ stage, kind: 'attempt' });
      this.metrics.stageDuration.observe({ stage, outcome: 'failed' }, (performance.now() - started) / 1000);
      await this.uow.run(userId, (r) =>
        r.pipeline.updateStage(runId, stage, { state: 'failed', error: message.slice(0, 1000), finishedAt: this.clock.now() }),
      );
      throw err;
    }
  }

  /** Dead-letter handler: retries are exhausted. */
  async handleDeadLetter(job: PipelineJob): Promise<void> {
    this.metrics.stageFailures.inc({ stage: job.stage, kind: 'dead' });
    await this.uow.run(job.userId, async (r) => {
      const run = await r.pipeline.getRun(job.runId);
      if (!run) return;
      await r.pipeline.updateStage(job.runId, job.stage, { state: 'dead', finishedAt: this.clock.now() });
      await r.pipeline.setRunState(job.runId, 'failed');
      await r.audits.transition(job.auditId, ['analyzing'], { status: 'failed' });
    });
  }

  private async complete(r: Repos, job: PipelineJob, inputHash: string, output: unknown, state: 'succeeded' | 'skipped') {
    const dek = await this.keys.get(r);
    const now = this.clock.now();
    const idx = PIPELINE_STAGES.indexOf(job.stage);
    if (job.stage === LAST_STAGE) {
      const report = AuditReport.safeParse(output);
      if (!report.success) throw new Error(`publish stage produced an invalid AuditReport: ${report.error.message.slice(0, 400)}`);
      if (report.data.auditId !== job.auditId) throw new Error('publish stage produced a report for another audit');
      await r.pipeline.upsertReport(job.auditId, job.runId, encryptJson(dek, report.data, aad.report(r.userId, job.auditId)), now);
      await r.pipeline.setRunState(job.runId, 'succeeded');
      await r.audits.transition(job.auditId, ['analyzing', 'failed'], { status: 'complete', completedAt: now });
    }
    await r.pipeline.updateStage(job.runId, job.stage, {
      state,
      inputHash,
      outputEnc: encryptJson(dek, output, aad.stageOutput(r.userId, job.stage, inputHash)),
      error: null,
      finishedAt: now,
    });
    if (job.stage !== LAST_STAGE) await r.jobs.enqueueStage({ ...job, stage: PIPELINE_STAGES[idx + 1]! });
  }

  private async loadEvents(userId: string, auditId: string): Promise<ActivityEvent[]> {
    return this.uow.run(
      userId,
      async (r) => {
        const dek = await this.keys.get(r);
        const out: ActivityEvent[] = [];
        let after: { ts: Date; id: string } | null = null;
        for (;;) {
          const page = await r.events.page(auditId, after, 2000);
          for (const e of page) out.push(decryptJson<ActivityEvent>(dek, e.payloadEnc, aad.event(userId, e.id)));
          if (page.length < 2000) break;
          const last = page[page.length - 1]!;
          after = { ts: last.ts, id: last.id };
        }
        return out;
      },
      { readOnly: true },
    );
  }
}

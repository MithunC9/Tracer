import { PgBoss } from 'pg-boss';
import { PIPELINE_STAGES } from '@tracer/schema';
import type { Logger } from 'pino';
import type { Tx } from '../db/database.js';
import type { AuditsService } from '../services/audits.js';
import type { PipelineService } from '../services/pipeline.js';
import { QUEUE, type JobQueue, type PipelineJob } from './queue.js';

export interface BossOptions {
  connectionString: string;
  schema: string;
  retryLimit: number;
  retryDelaySeconds: number;
  retryDelayMaxSeconds: number;
  pollIntervalSeconds: number;
  sweepCron: string;
}

const ALL_QUEUES = [...PIPELINE_STAGES.map(QUEUE.stage), QUEUE.deadLetter, QUEUE.sweep];

/**
 * pg-boss lives in its own schema (owned by tracer_app, see migration 0002) in the same
 * Postgres: no Redis. Enqueueing can join the caller's transaction (`db` option), so a stage
 * job exists if and only if the state change that requires it committed.
 */
export class PgBossJobQueue implements JobQueue {
  readonly boss: PgBoss;
  private started = false;

  constructor(
    private readonly opts: BossOptions,
    private readonly log: Logger,
  ) {
    this.boss = new PgBoss({
      connectionString: opts.connectionString,
      schema: opts.schema,
      createSchema: false,
      migrate: true,
      max: 5,
      application_name: 'tracer-jobs',
      // Stage jobs wake workers immediately; polling stays on as the fallback.
      useListenNotify: true,
    });
    this.boss.on('error', (err) => this.log.error({ err }, 'pg-boss error'));
  }

  async start() {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
    await this.boss.createQueue(QUEUE.deadLetter, { retryLimit: 3, retryDelay: 5, retryBackoff: true, deleteAfterSeconds: 7 * 86400 });
    for (const stage of PIPELINE_STAGES) {
      await this.boss.createQueue(QUEUE.stage(stage), {
        retryLimit: this.opts.retryLimit,
        retryDelay: this.opts.retryDelaySeconds,
        retryBackoff: true,
        retryDelayMax: this.opts.retryDelayMaxSeconds,
        expireInSeconds: 15 * 60,
        deadLetter: QUEUE.deadLetter,
        notify: true,
      });
    }
    await this.boss.createQueue(QUEUE.sweep, { policy: 'singleton', retryLimit: 0, expireInSeconds: 120 });
  }

  async enqueueStage(job: PipelineJob, tx?: Tx) {
    if (!this.started) throw new Error('job queue not started');
    await this.boss.send(QUEUE.stage(job.stage), { ...job }, {
      // Same stage of the same run is never queued twice.
      singletonKey: `${job.runId}:${job.stage}`,
      ...(tx ? { db: { executeSql: (text: string, values?: unknown[]) => tx.client.query(text, values as unknown[]) } } : {}),
    });
  }

  async purgeUser(userId: string): Promise<number> {
    if (!this.started) return 0;
    let n = 0;
    for (const q of ALL_QUEUES) {
      const jobs = await this.boss.findJobs(q, { data: { userId } });
      if (jobs.length === 0) continue;
      const res = await this.boss.deleteJob(q, jobs.map((j) => j.id));
      n += res.affected;
    }
    return n;
  }

  /** Registers workers and the per-minute sweep schedule. */
  async startWorkers(pipeline: PipelineService, audits: AuditsService) {
    await this.start();
    // Retries are delayed jobs that NOTIFY does not announce, so keep the backstop poll short too.
    const poll = { pollingIntervalSeconds: this.opts.pollIntervalSeconds, notifyPollingIntervalSeconds: this.opts.pollIntervalSeconds };
    for (const stage of PIPELINE_STAGES) {
      await this.boss.work<PipelineJob>(QUEUE.stage(stage), { ...poll, localConcurrency: 2 }, async ([job]) => {
        if (job) await pipeline.runStageJob(job.data, job.signal);
      });
    }
    await this.boss.work<PipelineJob>(QUEUE.deadLetter, poll, async ([job]) => {
      if (!job) return;
      this.log.warn({ job: { id: job.id, stage: job.data.stage, runId: job.data.runId } }, 'pipeline stage dead-lettered');
      await pipeline.handleDeadLetter(job.data);
    });
    await this.boss.work(QUEUE.sweep, poll, async () => {
      const changed = await audits.sweep();
      if (changed) this.log.info({ changed }, 'audit sweep transitioned audits');
    });
    await this.boss.schedule(QUEUE.sweep, this.opts.sweepCron, {}, { key: 'default' });
  }

  async healthy(): Promise<boolean> {
    if (!this.started) return false;
    try {
      await this.boss.getQueue(QUEUE.deadLetter);
      return true;
    } catch {
      return false;
    }
  }

  async stop() {
    if (!this.started) return;
    this.started = false;
    await this.boss.stop({ graceful: true, timeout: 10_000, close: true });
  }
}

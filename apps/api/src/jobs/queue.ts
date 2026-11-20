import type { PipelineStage } from '@tracer/schema';
import type { Tx } from '../db/database.js';

export interface PipelineJob {
  runId: string;
  userId: string;
  auditId: string;
  stage: PipelineStage;
}

export const QUEUE = {
  stage: (s: PipelineStage) => `pipeline-${s}`,
  deadLetter: 'pipeline-dead-letter',
  sweep: 'audit-sweep',
} as const;

/** Port the services use to schedule background work. Implemented on pg-boss. */
export interface JobQueue {
  /** Enqueue a pipeline stage. With `tx`, the job is inserted inside that transaction (outbox semantics). */
  enqueueStage(job: PipelineJob, tx?: Tx): Promise<void>;
  /** Cancel and delete every queued/active job of a user (account deletion). Returns jobs removed. */
  purgeUser(userId: string): Promise<number>;
}

/** Queue that drops jobs: for API-only processes and unit tests. */
export class RecordingJobQueue implements JobQueue {
  readonly sent: PipelineJob[] = [];
  async enqueueStage(job: PipelineJob) {
    this.sent.push(job);
  }
  async purgeUser(userId: string) {
    const before = this.sent.length;
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i]!.userId === userId) this.sent.splice(i, 1);
    return before - this.sent.length;
  }
}

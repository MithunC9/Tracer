import type { Harness } from './harness.js';

/** Runs every recorded pipeline job synchronously (for harnesses without pg-boss workers). */
export async function drainJobs(h: Harness, max = 100) {
  if (!h.queue) throw new Error('drainJobs needs the recording queue');
  for (let i = 0; i < max && h.queue.sent.length > 0; i++) {
    const job = h.queue.sent.shift()!;
    await h.c.core.pipeline.runStageJob(job);
  }
}

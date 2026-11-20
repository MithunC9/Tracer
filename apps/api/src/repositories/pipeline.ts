import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { PipelineStage, StageState } from '@tracer/schema';
import { llmCache, pipelineRuns, reports, stageOutputs } from '../db/schema.js';
import type { Tx } from '../db/database.js';

export type RunRow = typeof pipelineRuns.$inferSelect;
export type StageRow = typeof stageOutputs.$inferSelect;
export type RunState = 'queued' | 'running' | 'succeeded' | 'failed';

export class PipelineRepo {
  constructor(private readonly tx: Tx) {}

  async createRun(auditId: string, stages: readonly PipelineStage[]): Promise<RunRow> {
    const [run] = await this.tx.db.insert(pipelineRuns).values({ userId: this.tx.userId, auditId, state: 'queued' }).returning();
    await this.tx.db.insert(stageOutputs).values(stages.map((stage) => ({ runId: run!.id, userId: this.tx.userId, stage, state: 'pending' })));
    return run!;
  }

  async getRun(runId: string): Promise<RunRow | null> {
    const [r] = await this.tx.db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.userId, this.tx.userId)));
    return r ?? null;
  }

  async latestRun(auditId: string): Promise<RunRow | null> {
    const [r] = await this.tx.db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.auditId, auditId), eq(pipelineRuns.userId, this.tx.userId)))
      .orderBy(desc(pipelineRuns.createdAt), desc(pipelineRuns.id))
      .limit(1);
    return r ?? null;
  }

  async activeRun(auditId: string): Promise<RunRow | null> {
    const [r] = await this.tx.db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.auditId, auditId), eq(pipelineRuns.userId, this.tx.userId), inArray(pipelineRuns.state, ['queued', 'running'])))
      .limit(1);
    return r ?? null;
  }

  async stages(runId: string): Promise<StageRow[]> {
    return this.tx.db
      .select()
      .from(stageOutputs)
      .where(and(eq(stageOutputs.runId, runId), eq(stageOutputs.userId, this.tx.userId)));
  }

  async getStage(runId: string, stage: PipelineStage, opts: { forUpdate?: boolean } = {}): Promise<StageRow | null> {
    const q = this.tx.db
      .select()
      .from(stageOutputs)
      .where(and(eq(stageOutputs.runId, runId), eq(stageOutputs.stage, stage), eq(stageOutputs.userId, this.tx.userId)));
    const [r] = opts.forUpdate ? await q.for('update') : await q;
    return r ?? null;
  }

  async setRunState(runId: string, state: RunState) {
    await this.tx.db.update(pipelineRuns).set({ state }).where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.userId, this.tx.userId)));
  }

  async updateStage(
    runId: string,
    stage: PipelineStage,
    patch: Partial<{ state: StageState; attempts: number; inputHash: string | null; outputEnc: Buffer | null; error: string | null; startedAt: Date | null; finishedAt: Date | null }>,
  ) {
    await this.tx.db
      .update(stageOutputs)
      .set(patch)
      .where(and(eq(stageOutputs.runId, runId), eq(stageOutputs.stage, stage), eq(stageOutputs.userId, this.tx.userId)));
  }

  async beginAttempt(runId: string, stage: PipelineStage, at: Date): Promise<number> {
    const [r] = await this.tx.db
      .update(stageOutputs)
      .set({ state: 'running', attempts: sql`${stageOutputs.attempts} + 1`, startedAt: at, finishedAt: null, error: null })
      .where(and(eq(stageOutputs.runId, runId), eq(stageOutputs.stage, stage), eq(stageOutputs.userId, this.tx.userId)))
      .returning({ attempts: stageOutputs.attempts });
    return r?.attempts ?? 0;
  }

  /** Any earlier successful output of this stage for the same input (cache hit across runs). */
  async findCached(stage: PipelineStage, inputHash: string): Promise<Buffer | null> {
    const [r] = await this.tx.db
      .select({ out: stageOutputs.outputEnc })
      .from(stageOutputs)
      .where(
        and(
          eq(stageOutputs.userId, this.tx.userId),
          eq(stageOutputs.stage, stage),
          eq(stageOutputs.inputHash, inputHash),
          inArray(stageOutputs.state, ['succeeded', 'skipped']),
          isNotNull(stageOutputs.outputEnc),
        ),
      )
      .limit(1);
    return r?.out ?? null;
  }

  async upsertReport(auditId: string, runId: string, reportEnc: Buffer, at: Date) {
    await this.tx.db
      .insert(reports)
      .values({ auditId, runId, userId: this.tx.userId, reportEnc, createdAt: at })
      .onConflictDoUpdate({ target: reports.auditId, set: { runId, reportEnc, createdAt: at } });
  }

  async getReport(auditId: string) {
    const [r] = await this.tx.db
      .select()
      .from(reports)
      .where(and(eq(reports.auditId, auditId), eq(reports.userId, this.tx.userId)));
    return r ?? null;
  }

  /** Encrypted LLM response cache, per tenant (RLS). */
  async getLlmCache(cacheKey: string): Promise<Buffer | null> {
    const [r] = await this.tx.db
      .select({ v: llmCache.responseEnc })
      .from(llmCache)
      .where(and(eq(llmCache.userId, this.tx.userId), eq(llmCache.cacheKey, cacheKey)));
    return r?.v ?? null;
  }

  async putLlmCache(cacheKey: string, responseEnc: Buffer, at: Date) {
    await this.tx.db
      .insert(llmCache)
      .values({ userId: this.tx.userId, cacheKey, responseEnc, createdAt: at })
      .onConflictDoUpdate({ target: [llmCache.userId, llmCache.cacheKey], set: { responseEnc, createdAt: at } });
  }
}

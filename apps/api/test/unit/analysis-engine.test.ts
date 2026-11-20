import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createLlmClient, validateReport } from '@tracer/llm';
import { AuditReport, DEFAULT_CONSTRAINTS, DEFAULT_EXCLUSIONS, PIPELINE_STAGES, type PipelineStage } from '@tracer/schema';
import { createAnalysisEngine } from '../../src/pipeline/analysis-engine.js';
import type { PipelineEngine, StageContext, StageInput } from '../../src/pipeline/engine.js';
import { loadFixture } from '../../src/scripts/fixtures.js';

const fx = loadFixture('bookkeeper');
const start = fx.groundTruth.startsAt;
const ctx: StageContext = {
  userId: randomUUID(),
  auditId: randomUUID(),
  runId: randomUUID(),
  audit: {
    startsAt: start,
    endsAt: new Date(Date.parse(start) + fx.groundTruth.days * 86_400_000).toISOString(),
    lengthDays: fx.groundTruth.days,
    pausedSeconds: 0,
  },
  exclusions: DEFAULT_EXCLUSIONS,
  constraints: DEFAULT_CONSTRAINTS,
  now: '2026-11-20T00:00:00.000Z',
};

const mockEngine = (identity = 'mock:test') =>
  createAnalysisEngine({ llmIdentity: identity, llmFor: () => createLlmClient({ provider: 'mock', cache: null }) });

/**
 * Runs every stage as a separate call, the way pg-boss jobs do (JSON round trip in between).
 * `tamper` may edit a stage's stored output before later stages read it.
 */
async function runStages(engine: PipelineEngine, upTo: PipelineStage, tamper?: (stage: PipelineStage, out: unknown) => void) {
  const outputs: Partial<Record<PipelineStage, unknown>> = {};
  let previous: unknown;
  for (const stage of PIPELINE_STAGES) {
    const input: StageInput = { events: async () => fx.events, previous, outputs: structuredClone(outputs) };
    if (stage === upTo) return { input, outputs };
    previous = outputs[stage] = JSON.parse(JSON.stringify(await engine.runStage(stage, input, ctx)));
    tamper?.(stage, outputs[stage]);
  }
  throw new Error(`stage ${upTo} not reached`);
}

describe('analysis engine (real deps, mock LLM)', () => {
  it('publishes a report that passes the number validator, with LLM usage carried to publish', async () => {
    const engine = mockEngine();
    const { input } = await runStages(engine, 'publish');
    const report = AuditReport.parse(await engine.runStage('publish', input, ctx));
    expect(report.auditId).toBe(ctx.auditId);
    expect(report.findings.length).toBeGreaterThanOrEqual(3);
    expect(report.findings.some((f) => f.tools.length > 0)).toBe(true); // real catalog ranking
    expect(validateReport(report).passed).toBe(true);
    expect(report.generation.validator.passed).toBe(true);
    expect(report.generation.provider).toBe('mock');
    expect(report.generation.inputTokens).toBeGreaterThan(0); // usage recorded by the narrate job
  });

  it('fails the publish stage when the final report does not validate (it is never published)', async () => {
    const engine = mockEngine();
    // A score that no longer recomputes from its inputs: the validator must reject the report.
    const { input } = await runStages(engine, 'publish', (stage, out) => {
      if (stage === 'score') (out as { score: { outputs: { automationPotential: number } } }[])[0]!.score.outputs.automationPotential += 7;
    });
    await expect(engine.runStage('publish', input, ctx)).rejects.toThrow(/failed validation/);
  });

  it('includes the LLM provider/model in the engine version (cache invalidation)', () => {
    expect(mockEngine('mock:x').version).not.toBe(mockEngine('anthropic:y').version);
  });
});

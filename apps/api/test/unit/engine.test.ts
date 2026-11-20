import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AuditReport, DEFAULT_CONSTRAINTS, DEFAULT_EXCLUSIONS, PIPELINE_STAGES, type ActivityEvent, type PipelineStage } from '@tracer/schema';
import { adaptRunPipeline, type StageContext, type StageInput } from '../../src/pipeline/engine.js';
import { stubEngine } from '../../src/pipeline/stub-engine.js';

const ctx: StageContext = {
  userId: randomUUID(),
  auditId: randomUUID(),
  runId: randomUUID(),
  audit: { startsAt: '2026-11-20T00:00:00.000Z', endsAt: '2026-11-21T00:00:00.000Z', lengthDays: 1, pausedSeconds: 120 },
  exclusions: DEFAULT_EXCLUSIONS,
  constraints: DEFAULT_CONSTRAINTS,
  now: '2026-11-21T00:00:00.000Z',
};
const events: ActivityEvent[] = Array.from({ length: 5 }, (_, i) => ({
  id: randomUUID(),
  ts: new Date(Date.parse(ctx.audit.startsAt) + i * 30_000).toISOString(),
  seq: i,
  schemaVersion: 1,
  redactions: { email: 1 },
  kind: 'app_focus',
  app: { key: 'excel', name: 'Excel' },
  windowTitle: 'x',
  urlHost: null,
}));

async function runAll(engine = stubEngine) {
  const outputs: Partial<Record<PipelineStage, unknown>> = {};
  let previous: unknown;
  for (const stage of PIPELINE_STAGES) {
    const input: StageInput = { events: async () => events, previous, outputs: { ...outputs } };
    previous = outputs[stage] = await engine.runStage(stage, input, ctx);
  }
  return outputs;
}

describe('stub engine', () => {
  it('produces a valid AuditReport for the audit from the last stage', async () => {
    const out = await runAll();
    const report = AuditReport.parse(out.publish);
    expect(report.auditId).toBe(ctx.auditId);
    expect(report.window).toMatchObject({ eventsAnalyzed: 5, daysObserved: 1, pausedMinutes: 2, redactionsApplied: 5 });
    expect(report.findings).toEqual([]);
  });
});

describe('adaptRunPipeline', () => {
  it('runs exactly one stage per call, serving earlier stages from persisted outputs', async () => {
    const computed: string[] = [];
    const runPipeline = async (evs: ActivityEvent[], c: StageContext, _deps: unknown, store: Parameters<Parameters<typeof adaptRunPipeline>[0]>[3]) => {
      let prev: unknown = evs.length;
      for (const s of PIPELINE_STAGES) {
        const cached = await store.get(s, 'h');
        if (cached !== undefined) {
          prev = cached;
          continue;
        }
        computed.push(s);
        const out = s === 'publish' ? { auditId: c.auditId, prev } : `${s}(${String(prev)})`;
        await store.put(s, 'h', out);
        prev = out;
      }
      return prev;
    };
    const engine = adaptRunPipeline(runPipeline, {}, 'a-1', PIPELINE_STAGES);
    const outputs: Partial<Record<PipelineStage, unknown>> = {};
    for (const s of PIPELINE_STAGES) {
      outputs[s] = await engine.runStage(s, { events: async () => events, previous: undefined, outputs: { ...outputs } }, ctx);
    }
    expect(computed).toEqual([...PIPELINE_STAGES]);
    expect(outputs.segment).toBe('segment(sessionize(5))');
    expect(outputs.publish).toEqual({ auditId: ctx.auditId, prev: 'validate(narrate(recommend(score(cluster(segment(sessionize(5)))))))' });
  });
});

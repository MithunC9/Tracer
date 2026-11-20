import { describe, expect, it } from 'vitest';
import { AuditReport, PIPELINE_STAGES, SCORING } from '@tracer/schema';
import {
  basicValidate,
  evaluatePersona,
  extractNumbers,
  fallbackDeps,
  InMemoryStageStore,
  matchClusters,
  runPipeline,
  summarize,
  type PipelineDeps,
} from '../src/index.js';
import { PERSONAS, synthesize } from './synth.js';

const ctx = (startsAt: string) => ({
  auditId: '0190c6a0-0000-7000-8000-000000000001',
  startsAt,
  daysPlanned: 7,
  excludedApps: 2,
  excludedDomains: 1,
  generatedAt: '2026-11-09T00:00:00.000Z',
});

describe('runPipeline', () => {
  const { events, groundTruth } = synthesize(PERSONAS[0]!, 11);

  it('produces a report that passes AuditReport.parse and the number validator', async () => {
    const res = await runPipeline(events, ctx(groundTruth.startsAt), fallbackDeps);
    const r = AuditReport.parse(res.report);
    expect(r.findings.length).toBeGreaterThanOrEqual(3);
    expect(r.findings.length).toBeLessThanOrEqual(10);
    expect(r.generation.validator.passed).toBe(true);
    expect(r.generation.validator.checkedNumbers).toBeGreaterThan(0);
    expect(r.window.eventsAnalyzed).toBe(events.length);
    expect(r.window.excludedApps).toBe(2);
    expect(r.window.pausedMinutes).toBeGreaterThan(0);
    expect(r.window.redactionsApplied).toBeGreaterThan(0);
    // ranked by reclaimable hours, rank 1..n
    r.findings.forEach((f, i) => {
      expect(f.rank).toBe(i + 1);
      if (i) expect(r.findings[i - 1]!.score.outputs.reclaimableHoursPerWeek).toBeGreaterThanOrEqual(f.score.outputs.reclaimableHoursPerWeek);
      expect(f.diyOption.cost).toBe('free');
      expect(f.diyOption.estSetupMinutes).toBe(f.recipe.estSetupMinutes);
      expect(f.metrics.occurrences).toBeGreaterThanOrEqual(SCORING.minOccurrences);
      expect(f.evidence.length).toBeGreaterThan(0);
      for (const n of extractNumbers(`${f.narrative.headline} ${f.narrative.body}`)) expect(f.allowedNumbers).toContain(n);
    });
    // summary calculation: one line per finding + total, and it adds up
    const calc = r.summary.calculation;
    expect(calc).toHaveLength(r.findings.length + 1);
    const sum = Math.round(r.findings.reduce((a, f) => a + f.score.outputs.reclaimableHoursPerWeek, 0) * 10) / 10;
    expect(calc[calc.length - 1]!.value).toBe(sum);
    expect(r.summary.reclaimableHoursPerWeek).toBe(sum);
    expect(r.summary.topFindingId).toBe(r.findings[0]!.id);
    // honest limitations from the data
    expect(r.limitations).toContain('2 apps were excluded by you.');
    expect(r.limitations.some((l) => l.startsWith('Observed 5 of 7'))).toBe(true);
    expect(r.limitations).toContain(`Workflows seen fewer than ${SCORING.minOccurrences} times are not reported.`);
    expect(r.methodology.length).toBeGreaterThanOrEqual(4);
    expect(res.statuses.map((s) => s.stage)).toEqual(PIPELINE_STAGES);
    expect(res.statuses.every((s) => s.state === 'succeeded' && s.inputHash)).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await runPipeline(events, ctx(groundTruth.startsAt), fallbackDeps);
    const b = await runPipeline([...events].reverse(), ctx(groundTruth.startsAt), fallbackDeps);
    expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
  });

  it('reuses cached stage outputs on a rerun and resumes after a failure', async () => {
    const store = new InMemoryStageStore();
    let narrations = 0;
    const deps: PipelineDeps = {
      ...fallbackDeps,
      narrateFinding: async (f) => {
        narrations++;
        return fallbackDeps.narrateFinding(f);
      },
    };
    const first = await runPipeline(events, ctx(groundTruth.startsAt), deps, store);
    const calls = narrations;
    const second = await runPipeline(events, ctx(groundTruth.startsAt), deps, store);
    expect(narrations).toBe(calls);
    expect(second.report).toEqual(first.report);
    expect(second.statuses.every((s) => s.attempts === 0)).toBe(true);

    // validation throws -> stage fails, earlier stages are kept; fixing it resumes from cache
    const store2 = new InMemoryStageStore();
    const broken: PipelineDeps = { ...fallbackDeps, validate: () => { throw new Error('validator down'); } };
    await expect(runPipeline(events, ctx(groundTruth.startsAt), broken, store2)).rejects.toThrow('validator down');
    expect(store2.statuses.find((s) => s.stage === 'validate' && s.state === 'failed')?.error).toBe('validator down');
    const resumed = await runPipeline(events, ctx(groundTruth.startsAt), fallbackDeps, store2);
    const byStage = new Map(resumed.statuses.map((s) => [s.stage, s.attempts]));
    expect(byStage.get('cluster')).toBe(0);
    expect(byStage.get('validate')).toBe(1);
  });

  it('falls back to template prose when the narrator invents numbers or fails', async () => {
    const liar: PipelineDeps = {
      ...fallbackDeps,
      narrateFinding: async () => ({ headline: 'Saves 999 hours', body: 'Trust us: 12345 minutes.' }),
      narrateSummary: async () => {
        throw new Error('LLM unavailable');
      },
    };
    const res = await runPipeline(events, ctx(groundTruth.startsAt), liar);
    expect(res.report.generation.validator.passed).toBe(true);
    expect(res.report.findings.every((f) => !f.narrative.headline.includes('999'))).toBe(true);
    expect(res.report.limitations.some((l) => l.includes('template'))).toBe(true);
    expect(basicValidate(res.report).passed).toBe(true);
  });

  it('handles an empty audit', async () => {
    const res = await runPipeline([], { auditId: '0190c6a0-0000-7000-8000-000000000001', generatedAt: '2026-11-09T00:00:00.000Z' }, fallbackDeps);
    expect(res.report.findings).toEqual([]);
    expect(res.report.summary.reclaimableHoursPerWeek).toBe(0);
    AuditReport.parse(res.report);
  });
});

describe('evaluation', () => {
  it('matches by majority overlap of active time', () => {
    const gt = {
      persona: 'p',
      description: '',
      startsAt: '2026-11-02T00:00:00.000Z',
      days: 1,
      workflows: [{ id: 'w', label: 'W', path: [], occurrences: [{ start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T09:10:00.000Z' }], minutesPerWeek: 10 }],
      distractors: [],
    };
    const sess = (id: string, s: string, e: string) => ({ id, appKey: 'x', urlHost: null, windowTitle: null, start: s, end: e, activeSeconds: 0, eventIds: [], clipboardEvents: 0, digestText: '', action: 'read' as const });
    const sessions = [sess('a', '2026-11-02T09:00:00.000Z', '2026-11-02T09:06:00.000Z'), sess('b', '2026-11-02T09:20:00.000Z', '2026-11-02T09:25:00.000Z')];
    const ep = { id: 'e', sessionIds: ['a', 'b'], start: '', end: '', activeSeconds: 0, path: [], dayIndex: 0 };
    const [m] = matchClusters([{ id: 'f', label: 'F', episodeIds: ['e'] }], [ep], sessions, gt);
    expect(m!.matched).toBe('w');
    expect(m!.overlap).toBeCloseTo(6 / 11, 2);
  });

  it('meets recall >= 0.8 and precision >= 0.75 on the synthetic personas', async () => {
    const results = [];
    for (const p of PERSONAS) for (const seed of [11, 29]) {
      const { events, groundTruth } = synthesize(p, seed);
      results.push(await evaluatePersona(events, groundTruth));
    }
    const s = summarize(results);
    expect(s.recall).toBeGreaterThanOrEqual(0.8);
    expect(s.precision).toBeGreaterThanOrEqual(0.75);
  });
});

describe('performance', () => {
  it('runs 20k events through the full pipeline in < 5s', async () => {
    const all = [];
    let k = 0;
    while (all.length < 20000) {
      const { events } = synthesize(PERSONAS[k % PERSONAS.length]!, 500 + k, { days: 14, startsAt: '2026-11-02T00:00:00.000Z' });
      all.push(...events);
      k++;
    }
    const events = all.slice(0, 20000);
    const t0 = performance.now();
    const res = await runPipeline(events, { auditId: '0190c6a0-0000-7000-8000-000000000001', startsAt: '2026-11-02T00:00:00.000Z', daysPlanned: 14, generatedAt: '2026-11-16T00:00:00.000Z' }, fallbackDeps, new InMemoryStageStore());
    const ms = performance.now() - t0;
    expect(res.report.window.eventsAnalyzed).toBe(20000);
    expect(ms).toBeLessThan(5000);
  });
});

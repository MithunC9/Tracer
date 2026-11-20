import {
  DEFAULT_CONSTRAINTS,
  type ActivityEvent,
  type AuditReport,
  type FocusSession,
  type Narrative,
  type PipelineStage,
  type ScoredCluster,
  type StageStatus,
  type TaskEpisode,
  type UserConstraints,
  type WorkflowCluster,
} from '@tracer/schema';
import { clusterWorkflows } from './cluster.js';
import { resolveConfig, STAGE_VERSIONS, type AnalysisConfig } from './config.js';
import { genericRecipe, templateFindingNarrative, templateSummaryNarrative } from './fallback.js';
import type { PipelineDeps, Recommendation, RecommendInput, StageStore, UsageReport, ValidationResult } from './ports.js';
import { buildReport, draftFindings, summaryFacts, windowFacts, type ReportContext, type WindowFacts } from './report.js';
import { scoreClusters } from './score.js';
import { segmentTasks } from './segment.js';
import { sessionizeWithStats, type CaptureStats } from './sessionize.js';
import { hashEmbed } from './text.js';
import { hashOf } from './util.js';

export interface PipelineContext extends ReportContext {
  constraints?: UserConstraints;
  config?: Partial<AnalysisConfig>;
  /** Clock for stage status timestamps (tests). */
  now?: () => Date;
}

export interface PipelineResult {
  report: AuditReport;
  sessions: FocusSession[];
  stats: CaptureStats;
  episodes: TaskEpisode[];
  clusters: WorkflowCluster[];
  scored: ScoredCluster[];
  window: WindowFacts;
  statuses: StageStatus[];
}

const NO_USAGE: UsageReport = { provider: 'template', model: 'none', inputTokens: 0, outputTokens: 0, costUsd: 0, cacheHits: 0 };

class StageRunner {
  readonly statuses: StageStatus[] = [];
  constructor(
    private readonly store: StageStore | undefined,
    private readonly cfg: AnalysisConfig,
    private readonly now: () => Date,
  ) {}

  private async emit(s: StageStatus) {
    const i = this.statuses.findIndex((x) => x.stage === s.stage);
    if (i >= 0) this.statuses[i] = s;
    else this.statuses.push(s);
    await this.store?.onStatus?.(s);
  }

  /** Hash the input (+ stage version + config), reuse a cached output when present, emit status. */
  async run<O>(stage: PipelineStage, input: unknown, compute: () => O | Promise<O>): Promise<O> {
    const inputHash = hashOf({ stage, version: STAGE_VERSIONS[stage], config: this.cfg, input });
    const startedAt = this.now().toISOString();
    const cached = this.store ? await this.store.get<O>(stage, inputHash) : undefined;
    if (cached !== undefined) {
      await this.emit({ stage, state: 'succeeded', attempts: 0, startedAt, finishedAt: this.now().toISOString(), error: null, inputHash });
      return cached;
    }
    await this.emit({ stage, state: 'running', attempts: 1, startedAt, finishedAt: null, error: null, inputHash });
    try {
      const out = await compute();
      await this.store?.put(stage, inputHash, out);
      await this.emit({ stage, state: 'succeeded', attempts: 1, startedAt, finishedAt: this.now().toISOString(), error: null, inputHash });
      return out;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.emit({ stage, state: 'failed', attempts: 1, startedAt, finishedAt: this.now().toISOString(), error: msg.slice(0, 500), inputHash });
      throw err;
    }
  }
}

/**
 * sessionize -> segment -> cluster -> score -> recommend -> narrate -> validate -> publish.
 * Each stage is cached by input hash in `store` (when given) so reruns are cheap and a failed
 * run resumes from the last good stage.
 */
export async function runPipeline(events: readonly ActivityEvent[], ctx: PipelineContext, deps: PipelineDeps, store?: StageStore): Promise<PipelineResult> {
  const cfg = resolveConfig(ctx.config);
  const runner = new StageRunner(store, cfg, ctx.now ?? (() => new Date()));
  const embed = deps.embed ? (t: string) => deps.embed!(t) : (t: string) => hashEmbed(t);
  const constraints = ctx.constraints ?? DEFAULT_CONSTRAINTS;
  const notes: string[] = [];

  const { sessions, stats } = await runner.run('sessionize', { events }, () => sessionizeWithStats(events, cfg));
  const win = windowFacts(sessions, stats, ctx);

  const episodes = await runner.run('segment', { sessions, auditStartsAt: win.startsAt, embedder: deps.embed ? 'injected' : 'hashEmbed' }, () =>
    segmentTasks(sessions, { ...cfg, auditStartsAt: win.startsAt }, embed),
  );

  const clusters = await runner.run('cluster', { episodes }, () => clusterWorkflows(episodes, cfg));

  const scored = await runner.run('score', { clusters, daysObserved: win.daysObserved, episodes: episodes.map((e) => ({ id: e.id, path: e.path })) }, () =>
    scoreClusters(clusters, { daysObserved: Math.max(1, win.daysObserved), episodes }),
  );
  const top = scored.slice(0, cfg.maxFindings);

  const recInputs: RecommendInput[] = top.map((c) => ({
    label: c.label,
    canonicalPath: c.canonicalPath,
    requirements: c.requirements,
    riskFlags: c.score.inputs.riskFlags,
  }));
  const recs = await runner.run('recommend', { recInputs, constraints }, () => {
    let failed = 0;
    const out: Recommendation[] = recInputs.map((r) => {
      try {
        return deps.recommend(r, constraints);
      } catch {
        failed++;
        return { tools: [], recipe: genericRecipe(r) };
      }
    });
    return { recs: out, failed };
  });
  if (recs.failed) notes.push('Tool suggestions were unavailable for some workflows; a generic do-it-yourself recipe is shown instead.');

  const drafts = draftFindings(top, recs.recs, win.daysObserved);
  const sFacts = summaryFacts(drafts, win, stats);

  const narr = await runner.run('narrate', { findings: drafts.map((d) => d.facts), summary: sFacts }, async () => {
    let fallbacks = 0;
    const findings: Narrative[] = [];
    for (const d of drafts) {
      try {
        findings.push(await deps.narrateFinding(d.facts));
      } catch {
        fallbacks++;
        findings.push(templateFindingNarrative(d.facts));
      }
    }
    let summary: Narrative;
    try {
      summary = await deps.narrateSummary(sFacts);
    } catch {
      fallbacks++;
      summary = templateSummaryNarrative(sFacts);
    }
    return { findings, summary, fallbacks };
  });
  if (narr.fallbacks) notes.push('Some summaries were written from a template because the writing assistant was unavailable.');

  const usage = deps.usage?.() ?? NO_USAGE;
  const episodeMap = new Map(episodes.map((e) => [e.id, e]));
  const assemble = (narratives: { findings: Narrative[]; summary: Narrative }, validator: { passed: boolean; checkedNumbers: number }, extra: string[]) =>
    buildReport({ ctx, cfg, stats, win, drafts, episodes: episodeMap, narratives, validator, usage, clustersFound: scored.length, notes: [...notes, ...extra] });

  const draftReport = assemble(narr, { passed: false, checkedNumbers: 0 }, []);
  const validation = await runner.run('validate', { report: { ...draftReport, generatedAt: null, generation: null } }, () => {
    const first: ValidationResult = deps.validate(draftReport);
    if (first.passed) return { result: first, usedTemplate: false };
    // Untraceable number in prose: fall back to template prose (only allowed numbers) and re-check.
    const templ = { findings: drafts.map((d) => templateFindingNarrative(d.facts)), summary: templateSummaryNarrative(sFacts) };
    const second = deps.validate(assemble(templ, { passed: false, checkedNumbers: 0 }, []));
    return { result: second, usedTemplate: true, firstErrors: first.errors.length };
  });

  const finalNarr = validation.usedTemplate
    ? { findings: drafts.map((d) => templateFindingNarrative(d.facts)), summary: templateSummaryNarrative(sFacts) }
    : narr;
  const finalNotes = validation.usedTemplate ? ['Generated summaries mentioned numbers we could not trace to your data, so plain template text is shown instead.'] : [];
  const report = await runner.run('publish', { draft: { ...draftReport, generatedAt: null, generation: null }, validation, usedTemplate: validation.usedTemplate }, () =>
    assemble(finalNarr, { passed: validation.result.passed, checkedNumbers: validation.result.checkedNumbers }, finalNotes),
  );

  return { report, sessions, stats, episodes, clusters, scored, window: win, statuses: runner.statuses };
}

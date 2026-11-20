import {
  hashEmbed,
  hashOf,
  resolveConfig,
  runPipeline,
  STAGE_VERSIONS,
  type PipelineContext,
  type PipelineDeps,
  type StageStore as AnalysisStageStore,
  type UsageReport,
} from '@tracer/analysis';
import { recipeFor, recommendTools } from '@tracer/catalog';
import { allowedNumbersFor, allowedNumbersForSummary, assertValidReport, createLlmClient, narrateFinding, narrateSummary, validateReport, type LlmCache, type LlmClient } from '@tracer/llm';
import { PIPELINE_STAGES, type AuditReport } from '@tracer/schema';
import { adaptRunPipeline, type PipelineEngine, type StageContext, type StageStore } from './engine.js';

/** Bump when the glue in this file changes the output of any stage. */
const GLUE_VERSION = 1;

/** Usage snapshot persisted inside the narrate output, so `publish` (a later job) reports it. */
const USAGE_KEY = 'llmUsage';

export function usageOf(llm: LlmClient): UsageReport {
  const u = llm.usage();
  return {
    provider: llm.providerName,
    model: llm.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    costUsd: u.costUsd,
    cacheHits: u.cacheHits,
  };
}

/**
 * The real collaborators of `@tracer/analysis`: catalog ranking + recipe, LLM narration through
 * `@tracer/llm` (mock provider by default), the number validator and the local hash embedder.
 * Shared by the API engine, the seed, `pnpm verify:reports` and the end-to-end test.
 */
export function createRealDeps(llm: LlmClient, usage?: () => UsageReport): PipelineDeps {
  return {
    recommend: (input, constraints) => ({ tools: recommendTools(input.requirements, constraints), recipe: recipeFor(input) }),
    narrateFinding: (facts) => narrateFinding(llm, facts),
    narrateSummary: (facts) => narrateSummary(llm, facts),
    validate: (report) => {
      const r = validateReport(report);
      return { passed: r.passed, checkedNumbers: r.checkedNumbers, errors: r.errors };
    },
    embed: (text) => hashEmbed(text),
    // The validator's own definition of "derivable", so narration and validation cannot disagree.
    allowedNumbers: { finding: (src) => allowedNumbersFor(src), summary: (src) => allowedNumbersForSummary(src) },
    usage: usage ?? (() => usageOf(llm)),
  };
}

export function pipelineContextFor(ctx: StageContext): PipelineContext {
  return {
    auditId: ctx.auditId,
    startsAt: ctx.audit.startsAt,
    endsAt: ctx.audit.endsAt,
    daysPlanned: ctx.audit.lengthDays,
    excludedApps: ctx.exclusions.apps.length,
    excludedDomains: ctx.exclusions.domains.length,
    generatedAt: ctx.now,
    constraints: ctx.constraints,
  };
}

export interface AnalysisEngineOptions {
  /** A fresh client per stage execution (usage counters are per client). `userId` scopes the cache. */
  llmFor(userId: string): LlmClient;
  /** Provider/model of the clients `llmFor` builds: part of the engine version (cache key). */
  llmIdentity: string;
}

/**
 * `PipelineEngine` backed by `@tracer/analysis.runPipeline`, one stage per job via
 * `adaptRunPipeline`. Two additions on top of the adapter:
 *  - narrate: the LLM usage of that job is stored with the stage output, and later stages read it
 *    back for `report.generation` (each stage runs in its own job, maybe another process).
 *  - publish: `assertValidReport` runs on the final report; an untraceable number fails the
 *    stage, so the report is never stored (retries, then dead letter -> audit `failed`).
 */
export function createAnalysisEngine(o: AnalysisEngineOptions): PipelineEngine {
  const version = `analysis:${hashOf({ STAGE_VERSIONS, config: resolveConfig(), glue: GLUE_VERSION }).slice(0, 12)}:${o.llmIdentity}`;
  return {
    version,
    async runStage(stage, input, ctx) {
      const llm = o.llmFor(ctx.userId);
      const persisted = (input.outputs.narrate as Record<string, unknown> | undefined)?.[USAGE_KEY] as UsageReport | undefined;
      const deps = createRealDeps(llm, () => (stage === 'narrate' || !persisted ? usageOf(llm) : persisted));
      const inner = adaptRunPipeline(
        (events, sctx, d, store: StageStore) => runPipeline(events, pipelineContextFor(sctx), d, store as unknown as AnalysisStageStore),
        deps,
        version,
        PIPELINE_STAGES,
      );
      const out = await inner.runStage(stage, input, ctx);
      if (stage === 'narrate' && out && typeof out === 'object') return { ...(out as object), [USAGE_KEY]: usageOf(llm) };
      if (stage === 'publish') assertValidReport(out as AuditReport);
      return out;
    },
  };
}

/** Default wiring from env: LLM_PROVIDER (mock|anthropic), ANTHROPIC_*; cache per tenant when given. */
export function analysisEngineFromEnv(cacheFor?: (userId: string) => LlmCache, env: Record<string, string | undefined> = process.env): PipelineEngine {
  const probe = createLlmClient({ env, cache: null });
  return createAnalysisEngine({
    llmIdentity: `${probe.providerName}:${probe.model}`,
    llmFor: (userId) => createLlmClient({ env, ...(cacheFor ? { cache: cacheFor(userId) } : {}) }),
  });
}

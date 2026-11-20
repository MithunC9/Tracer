import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { REPORT_VERSION } from './config.js';
import { RankedTool } from './catalog.js';
import { PathStep } from './pipeline.js';
import { CalcStep, ScoreBreakdown } from './scoring.js';

/**
 * The Audit Report. Numbers come from code; the LLM only supplies prose fields
 * marked `narrative`. The report validator (packages/llm) extracts every number
 * from narrative prose and rejects the report if it is not in `allowedNumbers`
 * for that finding/summary.
 */

export const Occurrence = z.object({
  episodeId: z.string(),
  start: IsoDateTime,
  end: IsoDateTime,
  minutes: z.number().nonnegative(),
  dayIndex: z.number().int().nonnegative(),
});
export type Occurrence = z.infer<typeof Occurrence>;

export const RecipeStep = z.object({
  n: z.number().int().positive(),
  instruction: z.string().max(400),
  appKey: z.string().nullable(),
  note: z.string().max(240).nullable(),
});
export type RecipeStep = z.infer<typeof RecipeStep>;

export const Recipe = z
  .object({
    templateId: z.string(),
    title: z.string().max(120),
    /** What the user needs before starting */
    prerequisites: z.array(z.string().max(160)),
    steps: z.array(RecipeStep).min(1),
    estSetupMinutes: z.number().int().positive(),
    difficulty: z.enum(['easy', 'moderate', 'technical']),
    /** Where a human must stay in the loop (risk mitigation) */
    keepHumanFor: z.array(z.string().max(160)),
  })
  .meta({ id: 'Recipe' });
export type Recipe = z.infer<typeof Recipe>;

/** Narrative text written by the LLM (or the mock). Numbers inside must be traceable. */
export const Narrative = z.object({
  headline: z.string().max(140),
  body: z.string().max(1200),
});
export type Narrative = z.infer<typeof Narrative>;

export const Finding = z
  .object({
    /** Stable workflow cluster id (wf_...) */
    id: z.string(),
    rank: z.number().int().positive(),
    label: z.string().max(120),
    path: z.array(PathStep).min(1),
    metrics: z.object({
      occurrences: z.number().int().positive(),
      daysSeen: z.number().int().positive(),
      totalMinutes: z.number().nonnegative(),
      avgMinutes: z.number().nonnegative(),
      weeklyHours: z.number().nonnegative(),
    }),
    score: ScoreBreakdown,
    evidence: z.array(Occurrence).min(1),
    recipe: Recipe,
    /** Ranked by fit only. A DIY option (the recipe) is always present. */
    tools: z.array(RankedTool),
    diyOption: z.object({ label: z.string(), estSetupMinutes: z.number().int().positive(), cost: z.literal('free') }),
    narrative: Narrative,
    /** Every number the narrative is allowed to mention (computed by code). */
    allowedNumbers: z.array(z.number()),
  })
  .meta({ id: 'Finding' });
export type Finding = z.infer<typeof Finding>;

export const AuditReport = z
  .object({
    reportVersion: z.literal(REPORT_VERSION),
    auditId: Uuid,
    generatedAt: IsoDateTime,
    window: z.object({
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
      daysPlanned: z.number().int().positive(),
      daysObserved: z.number().int().nonnegative(),
      activeHoursObserved: z.number().nonnegative(),
      eventsAnalyzed: z.number().int().nonnegative(),
      pausedMinutes: z.number().nonnegative(),
      excludedApps: z.number().int().nonnegative(),
      excludedDomains: z.number().int().nonnegative(),
      redactionsApplied: z.number().int().nonnegative(),
    }),
    summary: z.object({
      reclaimableHoursPerWeek: z.number().nonnegative(),
      /** Shown in "how we got this number" */
      calculation: z.array(CalcStep),
      topFindingId: z.string().nullable(),
      narrative: Narrative,
      allowedNumbers: z.array(z.number()),
    }),
    findings: z.array(Finding),
    methodology: z.array(z.object({ title: z.string(), body: z.string() })),
    limitations: z.array(z.string()),
    generation: z.object({
      provider: z.string(),
      model: z.string(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
      cacheHits: z.number().int().nonnegative(),
      validator: z.object({ passed: z.boolean(), checkedNumbers: z.number().int().nonnegative() }),
    }),
  })
  .meta({ id: 'AuditReport' });
export type AuditReport = z.infer<typeof AuditReport>;

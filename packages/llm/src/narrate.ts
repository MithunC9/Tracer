import { Narrative, type Finding, type PathStep, type ScoreBreakdown } from '@tracer/schema';
import type { z } from 'zod';
import type { LlmClient } from './client.js';
import { bannedWordsIn, disallowedNumbers } from './numbers.js';
import {
  FINDING_INSTRUCTIONS,
  NARRATOR_SYSTEM,
  PROMPT_VERSION,
  renderPrompt,
  SUMMARY_INSTRUCTIONS,
  TASKS,
} from './prompts.js';

export interface FindingFacts {
  label: string;
  path: PathStep[];
  metrics: Finding['metrics'];
  score: ScoreBreakdown;
  recipeTitle: string;
  topToolNames: string[];
  allowedNumbers: number[];
}

export interface SummaryFacts {
  reclaimableHoursPerWeek: number;
  daysObserved: number;
  findingCount: number;
  topFindingLabel: string | null;
  allowedNumbers: number[];
  /** Optional; include it in allowedNumbers too if you pass it. */
  topFindingHoursPerWeek?: number;
  /** Labels of all findings (names may contain digits; they are masked during number checks). */
  findingLabels?: string[];
}

export interface NarrateOptions {
  /**
   * Reject (and repair-retry) prose that mentions numbers outside allowedNumbers or uses
   * banned words. Default true. Turn off only to test the downstream validator.
   */
  enforce?: boolean;
  maxTokens?: number;
}

/** Phrases that may contain digits legitimately (names). Masked before number extraction. */
export function findingIgnorePhrases(f: {
  label: string;
  path: readonly PathStep[];
  recipeTitle?: string;
  toolNames?: readonly string[];
}): string[] {
  return [f.label, ...f.path.flatMap((p) => [p.label, p.appKey]), f.recipeTitle ?? '', ...(f.toolNames ?? [])].filter(
    (s) => s.length > 0,
  );
}

/** Narrative schema plus the house rules, so violations trigger the client's repair retry. */
export function guardedNarrative(allowed: readonly number[], ignorePhrases: readonly string[]): z.ZodType<Narrative> {
  return Narrative.superRefine((n, ctx) => {
    for (const field of ['headline', 'body'] as const) {
      const bad = disallowedNumbers(n[field], allowed, ignorePhrases);
      if (bad.length) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `uses numbers not in allowed_numbers: ${bad.map((b) => b.raw).join(', ')}. Use only allowed numbers, exactly as written, or no number.`,
        });
      }
      const banned = bannedWordsIn(n[field]);
      if (banned.length) {
        ctx.addIssue({ code: 'custom', path: [field], message: `uses banned words: ${banned.join(', ')}` });
      }
    }
  });
}

export async function narrateFinding(client: LlmClient, facts: FindingFacts, opts: NarrateOptions = {}): Promise<Narrative> {
  const promptFacts = {
    label: facts.label,
    path: facts.path.map((p) => ({ appKey: p.appKey, action: p.action, label: p.label })),
    metrics: facts.metrics,
    score: { inputs: facts.score.inputs, outputs: facts.score.outputs },
    recipeTitle: facts.recipeTitle,
    topToolNames: facts.topToolNames,
    allowedNumbers: facts.allowedNumbers,
  };
  const ignore = findingIgnorePhrases({
    label: facts.label,
    path: facts.path,
    recipeTitle: facts.recipeTitle,
    toolNames: facts.topToolNames,
  });
  const schema = opts.enforce === false ? Narrative : guardedNarrative(facts.allowedNumbers, ignore);
  const res = await client.generateStructured({
    schema,
    system: NARRATOR_SYSTEM,
    prompt: renderPrompt(TASKS.finding, promptFacts, FINDING_INSTRUCTIONS),
    task: TASKS.finding,
    cacheKey: `${PROMPT_VERSION}:${opts.enforce === false ? 'raw' : 'guarded'}`,
    schemaName: 'narrative',
    maxTokens: opts.maxTokens ?? 4000,
  });
  return res.data;
}

export async function narrateSummary(client: LlmClient, facts: SummaryFacts, opts: NarrateOptions = {}): Promise<Narrative> {
  const promptFacts: Record<string, unknown> = {
    reclaimableHoursPerWeek: facts.reclaimableHoursPerWeek,
    daysObserved: facts.daysObserved,
    findingCount: facts.findingCount,
    topFindingLabel: facts.topFindingLabel,
    allowedNumbers: facts.allowedNumbers,
  };
  if (facts.topFindingHoursPerWeek !== undefined) promptFacts.topFindingHoursPerWeek = facts.topFindingHoursPerWeek;
  const ignore = [...(facts.findingLabels ?? []), facts.topFindingLabel ?? ''].filter(Boolean);
  const schema = opts.enforce === false ? Narrative : guardedNarrative(facts.allowedNumbers, ignore);
  const res = await client.generateStructured({
    schema,
    system: NARRATOR_SYSTEM,
    prompt: renderPrompt(TASKS.summary, promptFacts, SUMMARY_INSTRUCTIONS),
    task: TASKS.summary,
    cacheKey: `${PROMPT_VERSION}:${opts.enforce === false ? 'raw' : 'guarded'}`,
    schemaName: 'narrative',
    maxTokens: opts.maxTokens ?? 4000,
  });
  return res.data;
}

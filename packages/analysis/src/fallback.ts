import type { AuditReport, Narrative, Recipe, RiskTag } from '@tracer/schema';
import { appName } from './apps.js';
import type { FindingFacts, PipelineDeps, RecommendInput, SummaryFacts, ValidationResult } from './ports.js';

/**
 * Built-in deps so the package runs standalone (tests, eval, offline). The API injects the
 * real catalog ranker, LLM narrator and number validator instead.
 */

const KEEP_HUMAN: Record<RiskTag, string> = {
  money: 'Anything that moves or commits money',
  irreversible: 'Steps that cannot be undone',
  credentials: 'Handling passwords and logins',
  health: 'Anything involving health information',
  pii: 'Checking personal data before it is shared',
};

export function genericRecipe(input: RecommendInput): Recipe {
  const apps = [...new Set(input.canonicalPath.map((s) => s.appKey))];
  const stepsText = input.canonicalPath.map((s) => s.label).join(', then ');
  const title = `Do it yourself: streamline ${input.label}`.slice(0, 120);
  return {
    templateId: 'generic-diy',
    title,
    prerequisites: [`Access to ${apps.map(appName).join(', ')}`.slice(0, 160)],
    steps: [
      { n: 1, instruction: `Next time you do this, write down each step as you go: ${stepsText}.`.slice(0, 400), appKey: null, note: null },
      {
        n: 2,
        instruction: 'Pick the step that is the same every time (an export, a copy-paste, a status update) and automate that one first, using a saved export, a template, or the import feature of the destination app.',
        appKey: input.canonicalPath[0]?.appKey ?? null,
        note: null,
      },
      { n: 3, instruction: 'Run the automated step next to your manual process for a week and compare the results before relying on it.', appKey: null, note: null },
    ],
    estSetupMinutes: 30 + 10 * Math.min(6, input.canonicalPath.length),
    difficulty: input.requirements.involvesJudgement ? 'moderate' : 'easy',
    keepHumanFor: input.riskFlags.map((t) => KEEP_HUMAN[t]),
  };
}

const fmt = (n: number) => String(n);

/** Template narrator: mentions only numbers present in `allowedNumbers`. */
export function templateFindingNarrative(f: FindingFacts): Narrative {
  const allowed = new Set(f.allowedNumbers);
  const o = f.score.outputs;
  const m = f.metrics;
  const shortLabel = f.label.length > 80 ? f.label.slice(0, 79) + '…' : f.label;
  const headline = allowed.has(o.reclaimableHoursPerWeek)
    ? `${shortLabel}: about ${fmt(o.reclaimableHoursPerWeek)} h/week to reclaim`
    : `${shortLabel}: a recurring workflow`;
  const parts: string[] = [];
  if (allowed.has(m.occurrences) && allowed.has(m.daysSeen) && allowed.has(m.avgMinutes))
    parts.push(`You did this ${fmt(m.occurrences)} times on ${fmt(m.daysSeen)} different days, about ${fmt(m.avgMinutes)} minutes each time.`);
  if (allowed.has(o.automationPotential) && allowed.has(100))
    parts.push(`Automation potential is ${fmt(o.automationPotential)} out of 100, with ${o.confidenceLabel} confidence that this is a real habit.`);
  // `why` is code-generated from score inputs, all of which are allowed numbers.
  if (extractNumbers(o.why).every((n) => allowed.has(n))) parts.push(o.why);
  parts.push(`A good first step: ${f.recipeTitle}.`);
  if (f.topToolNames.length) parts.push(`Tools that fit: ${f.topToolNames.slice(0, 3).join(', ')}.`);
  return { headline: headline.slice(0, 140), body: parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1200) };
}

export function templateSummaryNarrative(s: SummaryFacts): Narrative {
  const allowed = new Set(s.allowedNumbers);
  if (s.findingCount === 0) {
    return {
      headline: 'No recurring workflows stood out',
      body: allowed.has(s.daysObserved)
        ? `Across ${fmt(s.daysObserved)} observed days we did not find a multi-step task you repeated often enough to report.`
        : 'We did not find a multi-step task you repeated often enough to report.',
    };
  }
  const headline = allowed.has(s.reclaimableHoursPerWeek)
    ? `About ${fmt(s.reclaimableHoursPerWeek)} hours a week could be reclaimed`
    : 'Some of your week could be reclaimed';
  const body =
    (allowed.has(s.daysObserved) && allowed.has(s.findingCount)
      ? `Across ${fmt(s.daysObserved)} observed days we found ${fmt(s.findingCount)} recurring workflows worth automating.`
      : 'We found recurring workflows worth automating.') + (s.topFindingLabel ? ` The biggest opportunity is ${s.topFindingLabel}.` : '');
  return { headline: headline.slice(0, 140), body: body.slice(0, 1200) };
}

/** Numbers in prose: 1,234.5 / 12 / 0.7 / 45%. Digits glued to letters (e.g. "Office365") are ignored. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![A-Za-z0-9_.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![A-Za-z0-9_])|(?<![A-Za-z0-9_.])-?\d+(?:\.\d+)?(?![A-Za-z0-9_])/g;
  for (const m of text.matchAll(re)) out.push(Number(m[0].replace(/,/g, '')));
  return out;
}

const includesNum = (allowed: readonly number[], n: number) => allowed.some((a) => Math.abs(a - n) < 1e-9);

/** Basic validator: every number in narrative prose must be in that section's allowedNumbers. */
export function basicValidate(report: AuditReport): ValidationResult {
  const errors: { where: string; number: number }[] = [];
  let checked = 0;
  const check = (where: string, n: { headline: string; body: string }, allowed: number[]) => {
    for (const x of [...extractNumbers(n.headline), ...extractNumbers(n.body)]) {
      checked++;
      if (!includesNum(allowed, x)) errors.push({ where, number: x });
    }
  };
  check('summary', report.summary.narrative, report.summary.allowedNumbers);
  for (const f of report.findings) check(`finding:${f.id}`, f.narrative, f.allowedNumbers);
  return { passed: errors.length === 0, checkedNumbers: checked, errors };
}

export const fallbackDeps: PipelineDeps = {
  recommend: (input) => ({ tools: [], recipe: genericRecipe(input) }),
  narrateFinding: async (facts) => templateFindingNarrative(facts),
  narrateSummary: async (facts) => templateSummaryNarrative(facts),
  validate: basicValidate,
};

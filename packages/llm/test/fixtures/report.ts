import {
  automationPotential,
  confidence,
  confidenceLabel,
  reclaimableHours,
  REPORT_VERSION,
  round,
  SCORING,
  weeklyHours,
  type AuditReport,
  type Finding,
  type Narrative,
  type PathStep,
  type RiskTag,
  type ScoreBreakdown,
} from '@tracer/schema';
import { allowedNumbersFor, allowedNumbersForSummary } from '../../src/allowed.js';
import { buildSummaryCalculation } from '../../src/validate.js';

const DAYS_OBSERVED = 7;
const START = Date.parse('2026-11-09T08:00:00.000Z');

interface Spec {
  id: string;
  label: string;
  path: PathStep[];
  minutes: number[];
  dayIndexes: number[];
  repeatability: number;
  ruleBasedShare: number;
  integrationFeasibility: number;
  risk: number;
  riskFlags: RiskTag[];
  cohesion: number;
  recipeTitle: string;
  tools: { id: string; name: string }[];
}

const SPECS: Spec[] = [
  {
    id: 'wf_0123456789',
    label: 'Stripe payout reconciliation in Sheets',
    path: [
      { appKey: 'stripe', action: 'export', label: 'Export payouts CSV in Stripe' },
      { appKey: 'google-sheets', action: 'paste', label: 'Paste into the Q4 ledger sheet' },
      { appKey: 'google-sheets', action: 'reconcile', label: 'Match payouts to invoices' },
    ],
    minutes: [22, 18, 25, 20, 19],
    dayIndexes: [0, 1, 2, 3, 4],
    repeatability: 0.8,
    ruleBasedShare: 0.7,
    integrationFeasibility: 0.9,
    risk: 0.4,
    riskFlags: ['money'],
    cohesion: 0.9,
    recipeTitle: 'Sync Stripe payouts to a sheet daily',
    tools: [
      { id: 'zapier', name: 'Zapier' },
      { id: 'make', name: 'Make' },
    ],
  },
  {
    id: 'wf_abcdef0123',
    label: 'Copy meeting notes into Notion',
    path: [
      { appKey: 'zoom', action: 'read', label: 'Open the Zoom summary' },
      { appKey: 'notion', action: 'paste', label: 'Paste into the meetings database' },
    ],
    minutes: [10, 12, 9, 11],
    dayIndexes: [0, 2, 3, 5],
    repeatability: 0.6,
    ruleBasedShare: 0.5,
    integrationFeasibility: 0.6,
    risk: 0,
    riskFlags: [],
    cohesion: 0.7,
    recipeTitle: 'Send Zoom summaries to Notion',
    tools: [{ id: '1password', name: '1Password Connect' }],
  },
];

export function buildFinding(spec: Spec, rank: number): Finding {
  const totalMinutes = spec.minutes.reduce((a, b) => a + b, 0);
  const occurrences = spec.minutes.length;
  const daysSeen = new Set(spec.dayIndexes).size;
  const wh = weeklyHours(totalMinutes, DAYS_OBSERVED);
  const inputs = {
    weeklyHours: wh,
    repeatability: spec.repeatability,
    ruleBasedShare: spec.ruleBasedShare,
    integrationFeasibility: spec.integrationFeasibility,
    risk: spec.risk,
    riskFlags: spec.riskFlags,
    occurrences,
    daysSeen,
    daysObserved: DAYS_OBSERVED,
    cohesion: spec.cohesion,
  };
  const ap = automationPotential(inputs);
  const conf = confidence(inputs);
  const score: ScoreBreakdown = {
    inputs,
    outputs: {
      automationPotential: ap,
      confidence: conf,
      confidenceLabel: confidenceLabel(conf),
      reclaimableHoursPerWeek: reclaimableHours(wh, ap),
      why: 'Same steps each time, mostly copy and paste between apps with good integrations.',
    },
    formulaVersion: SCORING.version,
  };
  const metrics = { occurrences, daysSeen, totalMinutes, avgMinutes: round(totalMinutes / occurrences, 1), weeklyHours: wh };
  const recipe = {
    templateId: `tpl-${spec.id}`,
    title: spec.recipeTitle,
    prerequisites: ['An account on the automation tool'],
    steps: [{ n: 1, instruction: 'Connect the source app.', appKey: spec.path[0]!.appKey, note: null }],
    estSetupMinutes: 30,
    difficulty: 'easy' as const,
    keepHumanFor: ['Final review'],
  };
  const f: Finding = {
    id: spec.id,
    rank,
    label: spec.label,
    path: spec.path,
    metrics,
    score,
    evidence: spec.minutes.map((min, i) => {
      const start = START + spec.dayIndexes[i]! * 86_400_000 + i * 3_600_000;
      return {
        episodeId: `ep_${spec.id}_${i}`,
        start: new Date(start).toISOString(),
        end: new Date(start + min * 60_000).toISOString(),
        minutes: min,
        dayIndex: spec.dayIndexes[i]!,
      };
    }),
    recipe,
    tools: spec.tools.map((t, i) => ({
      entryId: t.id,
      name: t.name,
      vendor: t.name,
      rank: i + 1,
      fitScore: 80 - i * 10,
      reasons: [],
      pricingTier: 'freemium' as const,
      priceNote: 'Free tier available',
      setupEffort: 'hour' as const,
      url: `https://example.com/${t.id}`,
      affiliate: null,
    })),
    diyOption: { label: recipe.title, estSetupMinutes: recipe.estSetupMinutes, cost: 'free' },
    narrative: { headline: '', body: '' },
    allowedNumbers: [],
  };
  f.allowedNumbers = allowedNumbersFor({ metrics, score, path: spec.path, recipe });
  f.narrative = handNarrative(f);
  return f;
}

/** Hand-written prose that only uses allowed numbers, exactly as computed. */
function handNarrative(f: Finding): Narrative {
  const o = f.score.outputs;
  const tool = f.tools[0]?.name ?? 'a script';
  return {
    headline: `${f.label}: ${o.reclaimableHoursPerWeek} h/week to win back`,
    body:
      `You ran this ${f.metrics.occurrences} times on ${f.metrics.daysSeen} of ${f.score.inputs.daysObserved} days, ` +
      `about ${f.metrics.avgMinutes} minutes each, or ${f.metrics.weeklyHours} hours a week. ` +
      `Automation potential is ${o.automationPotential} and confidence is ${Math.round(o.confidence * 100)}%. ` +
      `${tool} fits it; the recipe "${f.recipe.title}" takes ${f.recipe.estSetupMinutes} minutes to set up.`,
  };
}

export function buildReport(overrides?: { findingNarratives?: Narrative[]; summaryNarrative?: Narrative }): AuditReport {
  const findings = SPECS.map((s, i) => buildFinding(s, i + 1)).sort(
    (a, b) => b.score.outputs.reclaimableHoursPerWeek - a.score.outputs.reclaimableHoursPerWeek,
  );
  findings.forEach((f, i) => {
    f.rank = i + 1;
    const n = overrides?.findingNarratives?.[i];
    if (n) f.narrative = n;
  });
  const total = round(
    findings.reduce((s, f) => s + f.score.outputs.reclaimableHoursPerWeek, 0),
    1,
  );
  const window = {
    startsAt: new Date(START).toISOString(),
    endsAt: new Date(START + DAYS_OBSERVED * 86_400_000).toISOString(),
    daysPlanned: 7,
    daysObserved: DAYS_OBSERVED,
    activeHoursObserved: 31.5,
    eventsAnalyzed: 18_250,
    pausedMinutes: 40,
    excludedApps: 3,
    excludedDomains: 2,
    redactionsApplied: 57,
  };
  const summaryAllowed = allowedNumbersForSummary({
    reclaimableHoursPerWeek: total,
    daysObserved: DAYS_OBSERVED,
    findingCount: findings.length,
    daysPlanned: window.daysPlanned,
    activeHoursObserved: window.activeHoursObserved,
    topFindingHoursPerWeek: findings[0]!.score.outputs.reclaimableHoursPerWeek,
  });
  return {
    reportVersion: REPORT_VERSION,
    auditId: '6f1c1f9e-6c1d-4a4e-9a51-2a8f3c0d7b11',
    generatedAt: '2026-11-16T09:00:00.000Z',
    window,
    summary: {
      reclaimableHoursPerWeek: total,
      calculation: buildSummaryCalculation(findings),
      topFindingId: findings[0]!.id,
      narrative: overrides?.summaryNarrative ?? {
        headline: `About ${total} hours a week look automatable`,
        body: `Over ${DAYS_OBSERVED} days and ${window.activeHoursObserved} active hours, Tracer found ${findings.length} repeated workflows. The biggest is "${findings[0]!.label}".`,
      },
      allowedNumbers: summaryAllowed,
    },
    findings,
    methodology: [{ title: 'Weekly hours', body: 'Minutes observed divided by calendar weeks observed.' }],
    limitations: ['Only one week observed.'],
    generation: {
      provider: 'mock',
      model: 'mock-1',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      cacheHits: 0,
      validator: { passed: true, checkedNumbers: 0 },
    },
  };
}

export const clone = <T>(x: T): T => structuredClone(x);

import {
  AuditReport,
  REPORT_VERSION,
  SCORING,
  type CalcStep,
  type FocusSession,
  type Finding,
  type Narrative,
  type Occurrence,
  type ScoredCluster,
  type TaskEpisode,
} from '@tracer/schema';
import type { AnalysisConfig } from './config.js';
import { extractNumbers } from './fallback.js';
import type { FindingFacts, Recommendation, SummaryFacts, UsageReport, ValidationResult } from './ports.js';
import type { CaptureStats } from './sessionize.js';
import { DAY_MS, r1, toIso, toMs } from './util.js';

export interface ReportContext {
  auditId: string;
  startsAt?: string;
  endsAt?: string;
  daysPlanned?: number;
  /** Counts from the user's exclusion settings (shown in the report; never the names). */
  excludedApps?: number;
  excludedDomains?: number;
  generatedAt?: string;
}

export interface WindowFacts {
  startsAt: string;
  endsAt: string;
  daysPlanned: number;
  daysObserved: number;
  activeHoursObserved: number;
}

/**
 * Days observed = calendar days from the first to the last day with captured activity
 * (inclusive), minus days with no activity that were (almost) entirely paused, capped at the
 * planned length. Days without activity inside that span (a weekend) count as observed: you
 * were measured and did not do the work, which is the honest weekly rate.
 */
export function windowFacts(sessions: readonly FocusSession[], stats: CaptureStats, ctx: ReportContext): WindowFacts {
  const firstEv = stats.firstEventAt ? toMs(stats.firstEventAt) : NaN;
  const lastEv = stats.lastEventAt ? toMs(stats.lastEventAt) : NaN;
  const start = ctx.startsAt ? toMs(ctx.startsAt) : Number.isFinite(firstEv) ? Math.floor(firstEv / DAY_MS) * DAY_MS : toMs(ctx.generatedAt ?? '1970-01-01T00:00:00.000Z');
  const plannedFromCtx = ctx.daysPlanned ?? (ctx.endsAt ? Math.ceil((toMs(ctx.endsAt) - start) / DAY_MS) : undefined);
  const dayOf = (t: number) => Math.floor((t - start) / DAY_MS);
  const activeDays = new Map<number, number>();
  for (const s of sessions) {
    const d = dayOf(toMs(s.start));
    activeDays.set(d, (activeDays.get(d) ?? 0) + s.activeSeconds);
  }
  const days = [...activeDays.keys()].filter((d) => d >= 0).sort((a, b) => a - b);
  const lastDataDay = Number.isFinite(lastEv) ? dayOf(lastEv) : 0;
  const daysPlanned = Math.max(1, plannedFromCtx ?? lastDataDay + 1);
  let daysObserved = 0;
  if (days.length) {
    const firstDay = days[0]!;
    const lastDay = Math.min(days[days.length - 1]!, daysPlanned - 1);
    for (let d = firstDay; d <= lastDay; d++) {
      if (activeDays.has(d)) {
        daysObserved++;
        continue;
      }
      const ds = start + d * DAY_MS;
      const de = ds + DAY_MS;
      const pausedMs = stats.pausedRanges.reduce((a, [ps, pe]) => a + Math.max(0, Math.min(pe, de) - Math.max(ps, ds)), 0);
      if (pausedMs < 0.9 * DAY_MS) daysObserved++;
    }
    daysObserved = Math.min(daysPlanned, Math.max(1, daysObserved));
  }
  const endsAt = ctx.endsAt ?? toIso(Number.isFinite(lastEv) ? lastEv : start + daysPlanned * DAY_MS);
  return {
    startsAt: toIso(start),
    endsAt,
    daysPlanned,
    daysObserved,
    activeHoursObserved: r1(sessions.reduce((a, s) => a + s.activeSeconds, 0) / 3600),
  };
}

const uniqSorted = (xs: number[]) => [...new Set(xs.filter((x) => Number.isFinite(x)).map((x) => Math.round(x * 1e6) / 1e6))].sort((a, b) => a - b);

/** Every number a finding's prose may mention: metrics, score inputs/outputs (also as %), and numbers already in code-generated text. */
export function findingAllowedNumbers(c: ScoredCluster, rank: number, rec: Recommendation, daysObserved: number, label: string): number[] {
  const i = c.score.inputs;
  const o = c.score.outputs;
  const pct = (x: number) => Math.round(x * 100);
  const base = [
    rank,
    c.occurrences,
    c.daysSeen,
    c.totalMinutes,
    Math.round(c.totalMinutes),
    c.avgMinutes,
    Math.round(c.avgMinutes),
    i.weeklyHours,
    Math.round(i.weeklyHours),
    i.repeatability,
    pct(i.repeatability),
    i.ruleBasedShare,
    pct(i.ruleBasedShare),
    i.integrationFeasibility,
    pct(i.integrationFeasibility),
    i.risk,
    pct(i.risk),
    i.cohesion,
    pct(i.cohesion),
    daysObserved,
    i.daysObserved,
    o.automationPotential,
    o.confidence,
    pct(o.confidence),
    o.reclaimableHoursPerWeek,
    Math.round(o.reclaimableHoursPerWeek),
    Math.round(o.reclaimableHoursPerWeek * 60),
    c.canonicalPath.length,
    rec.recipe.estSetupMinutes,
    rec.recipe.steps.length,
    rec.tools.length,
    SCORING.captureRate,
    pct(SCORING.captureRate),
    SCORING.minOccurrences,
    100,
    ...extractNumbers(label),
    ...extractNumbers(rec.recipe.title),
    ...extractNumbers(o.why),
    ...rec.tools.slice(0, 3).flatMap((t) => extractNumbers(t.name)),
  ];
  return uniqSorted(base);
}

export function occurrencesFor(c: ScoredCluster, episodes: ReadonlyMap<string, TaskEpisode>, max: number): Occurrence[] {
  const occ = c.episodeIds
    .map((id) => episodes.get(id))
    .filter((e): e is TaskEpisode => !!e)
    .map((e) => ({ episodeId: e.id, start: e.start, end: e.end, minutes: r1(e.activeSeconds / 60), dayIndex: e.dayIndex }))
    .sort((a, b) => toMs(a.start) - toMs(b.start));
  return occ.slice(0, Math.max(1, max));
}

export interface FindingDraft {
  cluster: ScoredCluster;
  rank: number;
  rec: Recommendation;
  allowedNumbers: number[];
  facts: FindingFacts;
}

export function draftFindings(top: readonly ScoredCluster[], recs: readonly Recommendation[], daysObserved: number): FindingDraft[] {
  return top.map((c, idx) => {
    const rec = recs[idx]!;
    const rank = idx + 1;
    const allowedNumbers = findingAllowedNumbers(c, rank, rec, daysObserved, c.label);
    const metrics = metricsOf(c);
    return {
      cluster: c,
      rank,
      rec,
      allowedNumbers,
      facts: {
        label: c.label,
        path: c.canonicalPath,
        metrics,
        score: c.score,
        recipeTitle: rec.recipe.title,
        topToolNames: rec.tools.slice(0, 3).map((t) => t.name),
        allowedNumbers,
      },
    };
  });
}

const metricsOf = (c: ScoredCluster): Finding['metrics'] => ({
  occurrences: c.occurrences,
  daysSeen: c.daysSeen,
  totalMinutes: c.totalMinutes,
  avgMinutes: c.avgMinutes,
  weeklyHours: c.score.inputs.weeklyHours,
});

/** Summary total is the sum of the per-finding (already rounded) values, so the calculation adds up on screen. */
export function summaryCalculation(drafts: readonly FindingDraft[]): { total: number; steps: CalcStep[] } {
  const steps: CalcStep[] = drafts.map((d) => {
    const i = d.cluster.score.inputs;
    const o = d.cluster.score.outputs;
    return {
      label: `#${d.rank} ${d.cluster.label}`,
      expression: `${i.weeklyHours} h/week × ${o.automationPotential}% automation potential × ${SCORING.captureRate} capture rate`,
      value: o.reclaimableHoursPerWeek,
      unit: 'h/week',
    };
  });
  const total = r1(drafts.reduce((a, d) => a + d.cluster.score.outputs.reclaimableHoursPerWeek, 0));
  steps.push({
    label: 'Total reclaimable time',
    expression: drafts.length ? drafts.map((d) => String(d.cluster.score.outputs.reclaimableHoursPerWeek)).join(' + ') : '0',
    value: total,
    unit: 'h/week',
  });
  return { total, steps };
}

export function summaryFacts(drafts: readonly FindingDraft[], win: WindowFacts, stats: CaptureStats): SummaryFacts {
  const { total } = summaryCalculation(drafts);
  const top = drafts[0]?.cluster.label ?? null;
  return {
    reclaimableHoursPerWeek: total,
    daysObserved: win.daysObserved,
    findingCount: drafts.length,
    topFindingLabel: top,
    allowedNumbers: uniqSorted([
      total,
      Math.round(total),
      win.daysObserved,
      win.daysPlanned,
      drafts.length,
      win.activeHoursObserved,
      Math.round(win.activeHoursObserved),
      stats.eventsAnalyzed,
      SCORING.minOccurrences,
      SCORING.captureRate,
      Math.round(SCORING.captureRate * 100),
      100,
      ...drafts.map((d) => d.cluster.score.outputs.reclaimableHoursPerWeek),
      ...drafts.map((d) => d.cluster.score.inputs.weeklyHours),
      ...drafts.map((d) => d.rank),
      ...(top ? extractNumbers(top) : []),
    ]),
  };
}

export function methodology(cfg: AnalysisConfig): { title: string; body: string }[] {
  const w = SCORING.weights;
  return [
    {
      title: 'What we measured',
      body: `Only which app or website was in front, its window title, a redacted summary of on-screen text, when the clipboard changed (never what was copied) and when you were idle. Time counts while a window is in front and you are active; after ${Math.round(cfg.idleThresholdSeconds / 60)} minutes without input the clock stops. Quick alt-tab flicks under ${cfg.flickerSeconds} seconds are folded into the window you returned to.`,
    },
    {
      title: 'How we found workflows',
      body: `Focus sessions are grouped into tasks: a new task starts after a ${Math.round(cfg.episodeGapSeconds / 60)}-minute break or when the topic clearly changes. Short interruptions (a chat ping, a quick email check) that you return from are left out of the task. Tasks are then compared across days by the order of apps and actions, which apps they use, and the words in window titles. Tasks that are similar enough are grouped into one workflow. Only workflows seen at least ${SCORING.minOccurrences} times are reported.`,
    },
    {
      title: 'How we scored them',
      body: `Automation potential (0-100) = ${w.repeatability} × repeatability + ${w.ruleBasedShare} × rule-based share + ${w.integrationFeasibility} × integration feasibility, then reduced by up to ${Math.round(SCORING.riskPenalty * 100)}% for risk (money, personal data, irreversible actions). Repeatability is how consistent the steps are each time; rule-based share is the share of steps that need no judgement (copy, paste, export, import); integration feasibility reflects whether the apps have APIs and no-code connectors.`,
    },
    {
      title: 'What "reclaimable" means',
      body: `Weekly hours = total minutes observed / 60 / (days observed / 7). Reclaimable hours = weekly hours × automation potential × ${SCORING.captureRate}. The ${SCORING.captureRate} factor is a deliberate haircut: automation never removes all of the time, because someone still reviews results and handles exceptions.`,
    },
    {
      title: 'Confidence',
      body: 'Confidence combines how often a workflow was seen, on how many different days, and how similar the occurrences were to each other. Low confidence means it may be a coincidence rather than a habit.',
    },
  ];
}

export interface LimitationInputs {
  win: WindowFacts;
  stats: CaptureStats;
  excludedApps: number;
  excludedDomains: number;
  clustersFound: number;
  findingsReported: number;
  maxFindings: number;
  notes: readonly string[];
}

export function limitations(x: LimitationInputs): string[] {
  const out: string[] = [];
  const { win, stats } = x;
  if (win.daysObserved < win.daysPlanned) out.push(`Observed ${win.daysObserved} of ${win.daysPlanned} planned days.`);
  if (win.daysObserved > 0 && win.daysObserved < 5) out.push('With fewer than 5 days observed, weekly estimates are rough.');
  if (x.excludedApps > 0) out.push(`${x.excludedApps} ${x.excludedApps === 1 ? 'app was' : 'apps were'} excluded by you.`);
  if (x.excludedDomains > 0) out.push(`${x.excludedDomains} ${x.excludedDomains === 1 ? 'website was' : 'websites were'} excluded by you.`);
  out.push('Time in excluded apps, excluded websites and private browser windows is not counted.');
  if (stats.pausedMinutes > 0) out.push(`Capture was paused for ${Math.round(stats.pausedMinutes)} minutes; nothing from that time is included.`);
  if (stats.silentGaps > 0) out.push(`There ${stats.silentGaps === 1 ? 'was 1 gap' : `were ${stats.silentGaps} gaps`} with no data at all (computer asleep or agent offline); that time is not counted.`);
  out.push(`Workflows seen fewer than ${SCORING.minOccurrences} times are not reported.`);
  out.push('Single-step activities and pure reading (for example, checking chat) are not reported as workflows.');
  if (x.clustersFound > x.findingsReported && x.findingsReported >= x.maxFindings) out.push(`Only the top ${x.maxFindings} workflows are shown; ${x.clustersFound - x.findingsReported} smaller ones were left out.`);
  out.push('Actions such as "export" or "paste" are inferred from window titles and on-screen text, and can be wrong.');
  out.push('Work away from this computer (phone, paper, meetings in person) is invisible to Tracer.');
  out.push(...x.notes);
  return out;
}

export interface BuildReportInput {
  ctx: ReportContext;
  cfg: AnalysisConfig;
  stats: CaptureStats;
  win: WindowFacts;
  drafts: readonly FindingDraft[];
  episodes: ReadonlyMap<string, TaskEpisode>;
  narratives: { findings: Narrative[]; summary: Narrative };
  validator: { passed: boolean; checkedNumbers: number };
  usage: UsageReport;
  clustersFound: number;
  notes: readonly string[];
}

/** Assemble the AuditReport (numbers from code, prose from the narrator) and validate its shape. */
export function buildReport(x: BuildReportInput): AuditReport {
  const findings: Finding[] = x.drafts.map((d, idx) => {
    const c = d.cluster;
    return {
      id: c.id,
      rank: d.rank,
      label: c.label,
      path: c.canonicalPath,
      metrics: metricsOf(c),
      score: c.score,
      evidence: occurrencesFor(c, x.episodes, x.cfg.maxEvidencePerFinding),
      recipe: d.rec.recipe,
      tools: d.rec.tools,
      diyOption: { label: d.rec.recipe.title, estSetupMinutes: d.rec.recipe.estSetupMinutes, cost: 'free' as const },
      narrative: x.narratives.findings[idx]!,
      allowedNumbers: d.allowedNumbers,
    };
  });
  const calc = summaryCalculation(x.drafts);
  const sf = summaryFacts(x.drafts, x.win, x.stats);
  const report: AuditReport = {
    reportVersion: REPORT_VERSION,
    auditId: x.ctx.auditId,
    generatedAt: x.ctx.generatedAt ?? new Date().toISOString(),
    window: {
      startsAt: x.win.startsAt,
      endsAt: x.win.endsAt,
      daysPlanned: x.win.daysPlanned,
      daysObserved: x.win.daysObserved,
      activeHoursObserved: x.win.activeHoursObserved,
      eventsAnalyzed: x.stats.eventsAnalyzed,
      pausedMinutes: x.stats.pausedMinutes,
      excludedApps: x.ctx.excludedApps ?? 0,
      excludedDomains: x.ctx.excludedDomains ?? 0,
      redactionsApplied: x.stats.redactionsApplied,
    },
    summary: {
      reclaimableHoursPerWeek: calc.total,
      calculation: calc.steps,
      topFindingId: findings[0]?.id ?? null,
      narrative: x.narratives.summary,
      allowedNumbers: sf.allowedNumbers,
    },
    findings,
    methodology: methodology(x.cfg),
    limitations: limitations({
      win: x.win,
      stats: x.stats,
      excludedApps: x.ctx.excludedApps ?? 0,
      excludedDomains: x.ctx.excludedDomains ?? 0,
      clustersFound: x.clustersFound,
      findingsReported: findings.length,
      maxFindings: x.cfg.maxFindings,
      notes: x.notes,
    }),
    generation: {
      provider: x.usage.provider,
      model: x.usage.model,
      inputTokens: Math.round(x.usage.inputTokens),
      outputTokens: Math.round(x.usage.outputTokens),
      costUsd: x.usage.costUsd,
      cacheHits: Math.round(x.usage.cacheHits),
      validator: { passed: x.validator.passed, checkedNumbers: x.validator.checkedNumbers },
    },
  };
  return AuditReport.parse(report);
}

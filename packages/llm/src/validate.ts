import {
  AuditReport,
  automationPotential,
  confidence,
  confidenceLabel,
  reclaimableHours,
  round,
  SCORING,
  weeklyHours,
  type CalcStep,
  type Finding,
} from '@tracer/schema';
import { allowedNumbersFor, allowedNumbersForSummary } from './allowed.js';
import { findingIgnorePhrases } from './narrate.js';
import { bannedWordsIn, extractNumbers, fmt, isAllowed } from './numbers.js';

export interface ValidationIssue {
  location: string;
  value: string;
  reason: string;
}

export interface ValidationResult {
  passed: boolean;
  /** Numeric tokens found in narrative prose and checked against allowedNumbers. */
  checkedNumbers: number;
  errors: ValidationIssue[];
  /** Style problems (banned words). Do not fail the report. */
  warnings: ValidationIssue[];
}

export class ReportValidationError extends Error {
  readonly result: ValidationResult;
  constructor(result: ValidationResult) {
    super(
      `Report failed validation with ${result.errors.length} error(s):\n` +
        result.errors
          .slice(0, 20)
          .map((e) => `  ${e.location}: ${e.reason} (${e.value})`)
          .join('\n'),
    );
    this.name = 'ReportValidationError';
    this.result = result;
  }
}

const EPS = 1e-9;
const eq = (a: number, b: number) => Math.abs(a - b) < EPS;

export const TOTAL_STEP_UNIT = 'h/week';

/**
 * The summary calculation convention the validator checks: one step per finding
 * (its reclaimable h/week, in rank order), then a final total step. Use this in the pipeline.
 */
export function buildSummaryCalculation(findings: Pick<Finding, 'label' | 'score'>[]): CalcStep[] {
  const steps: CalcStep[] = findings.map((f) => ({
    label: f.label,
    expression: `${fmt(f.score.inputs.weeklyHours)} h/week × ${fmt(f.score.outputs.automationPotential)}% × ${fmt(SCORING.captureRate)}`,
    value: f.score.outputs.reclaimableHoursPerWeek,
    unit: TOTAL_STEP_UNIT,
  }));
  const total = round(
    findings.reduce((s, f) => s + f.score.outputs.reclaimableHoursPerWeek, 0),
    1,
  );
  steps.push({
    label: 'Reclaimable per week',
    expression: findings.length ? findings.map((f) => fmt(f.score.outputs.reclaimableHoursPerWeek)).join(' + ') : '0',
    value: total,
    unit: TOTAL_STEP_UNIT,
  });
  return steps;
}

/**
 * Validate an Audit Report: every number in narrative prose must be in that section's
 * allowedNumbers (findings may also use summary numbers), every allowed number must be
 * derivable from computed data, and every computed figure must recompute exactly.
 */
export function validateReport(input: AuditReport | unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let checkedNumbers = 0;

  const parsed = AuditReport.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) {
      errors.push({ location: i.path.join('.') || '(root)', value: '', reason: `schema: ${i.message}` });
    }
    return { passed: false, checkedNumbers, errors, warnings };
  }
  const report = parsed.data;
  const { summary, findings, window } = report;
  const err = (location: string, value: unknown, reason: string) =>
    errors.push({ location, value: typeof value === 'string' ? value : JSON.stringify(value), reason });

  // ---- 1. prose numbers -------------------------------------------------------------
  const allNames = findings.flatMap((f) =>
    findingIgnorePhrases({ label: f.label, path: f.path, recipeTitle: f.recipe.title, toolNames: f.tools.map((t) => t.name) }),
  );
  const checkProse = (loc: string, text: string, allowed: readonly number[], ignore: readonly string[]) => {
    for (const n of extractNumbers(text, ignore)) {
      checkedNumbers++;
      if (!isAllowed(n, allowed)) err(loc, n.raw, 'number in prose is not in allowedNumbers');
    }
    for (const w of bannedWordsIn(text)) warnings.push({ location: loc, value: w, reason: 'banned word' });
  };
  checkProse('summary.narrative.headline', summary.narrative.headline, summary.allowedNumbers, allNames);
  checkProse('summary.narrative.body', summary.narrative.body, summary.allowedNumbers, allNames);
  findings.forEach((f, i) => {
    const ignore = findingIgnorePhrases({
      label: f.label,
      path: f.path,
      recipeTitle: f.recipe.title,
      toolNames: f.tools.map((t) => t.name),
    });
    const allowed = [...f.allowedNumbers, ...summary.allowedNumbers];
    checkProse(`findings[${i}].narrative.headline`, f.narrative.headline, allowed, ignore);
    checkProse(`findings[${i}].narrative.body`, f.narrative.body, allowed, ignore);
  });

  // ---- 2. allowedNumbers must be traceable to computed data ---------------------------
  findings.forEach((f, i) => {
    const derivable = allowedNumbersFor({ metrics: f.metrics, score: f.score, path: f.path, recipe: f.recipe });
    for (const a of f.allowedNumbers) {
      if (!derivable.some((d) => eq(d, a))) err(`findings[${i}].allowedNumbers`, a, 'allowed number is not derivable from computed data');
    }
  });
  const summaryDerivable = allowedNumbersForSummary({
    reclaimableHoursPerWeek: summary.reclaimableHoursPerWeek,
    daysObserved: window.daysObserved,
    findingCount: findings.length,
    daysPlanned: window.daysPlanned,
    activeHoursObserved: window.activeHoursObserved,
    ...(findings[0] ? { topFindingHoursPerWeek: findings[0].score.outputs.reclaimableHoursPerWeek } : {}),
  });
  for (const a of summary.allowedNumbers) {
    if (!summaryDerivable.some((d) => eq(d, a))) err('summary.allowedNumbers', a, 'allowed number is not derivable from computed data');
  }

  // ---- 3. per-finding recomputation ---------------------------------------------------
  const ids = new Set<string>();
  findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    const { inputs: si, outputs: so } = f.score;
    const m = f.metrics;
    if (ids.has(f.id)) err(`${at}.id`, f.id, 'duplicate finding id');
    ids.add(f.id);

    const ap = automationPotential(si);
    if (!eq(so.automationPotential, ap)) err(`${at}.score.outputs.automationPotential`, so.automationPotential, `does not recompute (expected ${ap})`);
    const conf = confidence(si);
    if (!eq(so.confidence, conf)) err(`${at}.score.outputs.confidence`, so.confidence, `does not recompute (expected ${conf})`);
    const label = confidenceLabel(conf);
    if (so.confidenceLabel !== label) err(`${at}.score.outputs.confidenceLabel`, so.confidenceLabel, `does not match confidence (expected ${label})`);
    const rh = reclaimableHours(si.weeklyHours, ap);
    if (!eq(so.reclaimableHoursPerWeek, rh)) err(`${at}.score.outputs.reclaimableHoursPerWeek`, so.reclaimableHoursPerWeek, `does not recompute (expected ${rh})`);

    const wh = weeklyHours(m.totalMinutes, si.daysObserved);
    if (!eq(m.weeklyHours, wh)) err(`${at}.metrics.weeklyHours`, m.weeklyHours, `does not equal weeklyHours(totalMinutes, daysObserved) = ${wh}`);
    if (!eq(si.weeklyHours, m.weeklyHours)) err(`${at}.score.inputs.weeklyHours`, si.weeklyHours, `does not match metrics.weeklyHours (${m.weeklyHours})`);
    if (si.occurrences !== m.occurrences) err(`${at}.score.inputs.occurrences`, si.occurrences, `does not match metrics.occurrences (${m.occurrences})`);
    if (si.daysSeen !== m.daysSeen) err(`${at}.score.inputs.daysSeen`, si.daysSeen, `does not match metrics.daysSeen (${m.daysSeen})`);
    if (window.daysObserved > 0 && si.daysObserved !== window.daysObserved) {
      err(`${at}.score.inputs.daysObserved`, si.daysObserved, `does not match window.daysObserved (${window.daysObserved})`);
    }
    if (m.daysSeen > si.daysObserved) err(`${at}.metrics.daysSeen`, m.daysSeen, 'exceeds daysObserved');

    const avg = m.totalMinutes / m.occurrences;
    if (Math.abs(m.avgMinutes - avg) > 0.051) err(`${at}.metrics.avgMinutes`, m.avgMinutes, `does not equal totalMinutes/occurrences (${round(avg, 2)})`);

    if (f.evidence.length !== m.occurrences) err(`${at}.evidence`, f.evidence.length, `evidence count does not equal occurrences (${m.occurrences})`);
    const evMinutes = f.evidence.reduce((s, e) => s + e.minutes, 0);
    if (Math.abs(evMinutes - m.totalMinutes) > Math.max(1, 0.5 * f.evidence.length)) {
      err(`${at}.metrics.totalMinutes`, m.totalMinutes, `does not match sum of evidence minutes (${round(evMinutes, 1)})`);
    }
    const days = new Set(f.evidence.map((e) => e.dayIndex)).size;
    if (days !== m.daysSeen) err(`${at}.metrics.daysSeen`, m.daysSeen, `does not match distinct evidence days (${days})`);
    if (m.occurrences < SCORING.minOccurrences) err(`${at}.metrics.occurrences`, m.occurrences, `below minOccurrences (${SCORING.minOccurrences})`);
  });

  // ---- 4. ranks and ordering -----------------------------------------------------------
  findings.forEach((f, i) => {
    if (f.rank !== i + 1) err(`findings[${i}].rank`, f.rank, `ranks must be 1..n in array order (expected ${i + 1})`);
    const prev = findings[i - 1];
    if (prev && f.score.outputs.reclaimableHoursPerWeek > prev.score.outputs.reclaimableHoursPerWeek + EPS) {
      err(`findings[${i}].score.outputs.reclaimableHoursPerWeek`, f.score.outputs.reclaimableHoursPerWeek, 'findings not ordered by reclaimable hours (desc)');
    }
  });

  // ---- 5. summary --------------------------------------------------------------------
  const total = round(
    findings.reduce((s, f) => s + f.score.outputs.reclaimableHoursPerWeek, 0),
    1,
  );
  if (!eq(summary.reclaimableHoursPerWeek, total)) {
    err('summary.reclaimableHoursPerWeek', summary.reclaimableHoursPerWeek, `does not equal sum of findings (${total})`);
  }
  const expectedTop = findings[0]?.id ?? null;
  if (summary.topFindingId !== expectedTop) err('summary.topFindingId', summary.topFindingId, `expected ${expectedTop}`);

  const calc = summary.calculation;
  if (findings.length > 0 && calc.length === 0) err('summary.calculation', [], 'calculation steps missing');
  if (calc.length > 0) {
    const last = calc[calc.length - 1] as CalcStep;
    if (!eq(last.value, summary.reclaimableHoursPerWeek)) {
      err(`summary.calculation[${calc.length - 1}].value`, last.value, `final step must equal summary.reclaimableHoursPerWeek (${summary.reclaimableHoursPerWeek})`);
    }
    const parts = calc.slice(0, -1).filter((s) => s.unit === last.unit);
    const sum = round(
      parts.reduce((s, p) => s + p.value, 0),
      1,
    );
    if (!eq(sum, last.value)) err('summary.calculation', sum, `steps do not sum to the total (${last.value})`);
    if (parts.length !== findings.length) err('summary.calculation', parts.length, `expected one ${last.unit} step per finding (${findings.length})`);
  }

  return { passed: errors.length === 0, checkedNumbers, errors, warnings };
}

export function assertValidReport(report: AuditReport | unknown): ValidationResult {
  const r = validateReport(report);
  if (!r.passed) throw new ReportValidationError(r);
  return r;
}

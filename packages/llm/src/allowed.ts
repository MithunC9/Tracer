import { round, type Finding, type PathStep, type ScoreBreakdown } from '@tracer/schema';
import { uniqSorted } from './numbers.js';

/**
 * The single definition of which numbers prose may mention. The pipeline uses it to
 * fill `allowedNumbers`; the validator recomputes it from the report and rejects any
 * allowed number that is not derivable from computed data.
 */
export interface FindingNumberSource {
  metrics: Finding['metrics'];
  score: ScoreBreakdown;
  path?: readonly PathStep[];
  recipe?: { estSetupMinutes: number };
}

const pct = (u: number) => round(u * 100, 0);

export function allowedNumbersFor(f: FindingNumberSource): number[] {
  const { metrics: m, score } = f;
  const i = score.inputs;
  const o = score.outputs;
  const ns: number[] = [
    // counts and days
    m.occurrences,
    m.daysSeen,
    i.occurrences,
    i.daysSeen,
    i.daysObserved,
    // time
    m.totalMinutes,
    round(m.totalMinutes, 0),
    round(m.totalMinutes / 60, 1),
    m.avgMinutes,
    round(m.avgMinutes, 0),
    round(m.avgMinutes, 1),
    m.weeklyHours,
    i.weeklyHours,
    // score outputs
    o.automationPotential,
    o.confidence,
    pct(o.confidence),
    o.reclaimableHoursPerWeek,
    // score inputs, as 0..1 and as percentages
    i.repeatability,
    pct(i.repeatability),
    i.ruleBasedShare,
    pct(i.ruleBasedShare),
    i.integrationFeasibility,
    pct(i.integrationFeasibility),
  ];
  if (f.path) ns.push(f.path.length);
  if (f.recipe) ns.push(f.recipe.estSetupMinutes);
  return uniqSorted(ns);
}

export interface SummaryNumberSource {
  reclaimableHoursPerWeek: number;
  daysObserved: number;
  findingCount: number;
  daysPlanned?: number;
  activeHoursObserved?: number;
  /** Reclaimable hours of the top finding, so the summary can name it. */
  topFindingHoursPerWeek?: number;
}

export function allowedNumbersForSummary(s: SummaryNumberSource): number[] {
  const ns = [s.reclaimableHoursPerWeek, s.daysObserved, s.findingCount];
  if (s.daysPlanned !== undefined) ns.push(s.daysPlanned);
  if (s.activeHoursObserved !== undefined) ns.push(s.activeHoursObserved, round(s.activeHoursObserved, 0));
  if (s.topFindingHoursPerWeek !== undefined) ns.push(s.topFindingHoursPerWeek);
  return uniqSorted(ns);
}

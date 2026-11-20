import {
  automationPotential,
  confidence,
  confidenceLabel,
  reclaimableHours,
  SCORING,
  weeklyHours,
  type RiskTag,
  type ScoreInputs,
  type ScoreOutputs,
  type ScoredCluster,
  type TaskEpisode,
  type WorkflowCluster,
} from '@tracer/schema';
import { ruleWeight } from './actions.js';
import { appAutomationScore, appDef } from './apps.js';
import { sequenceSimilarity } from './similarity.js';
import { mean, r2 } from './util.js';

/** Risk weight per tag; a workflow's risk = min(1, sum over its distinct flags). */
export const RISK_WEIGHTS: Record<RiskTag, number> = { money: 0.4, irreversible: 0.3, credentials: 0.3, health: 0.3, pii: 0.15 };

const RISK_ORDER: RiskTag[] = ['money', 'irreversible', 'credentials', 'health', 'pii'];
const RISK_WORDS: Record<RiskTag, string> = {
  money: 'money',
  irreversible: 'actions that are hard to undo',
  credentials: 'credentials',
  health: 'health data',
  pii: 'personal data',
};

export interface ScoreContext {
  daysObserved: number;
  /** Member episodes (for repeatability). Missing episodes fall back to the cluster's cohesion. */
  episodes?: readonly TaskEpisode[];
}

export function riskFor(cluster: Pick<WorkflowCluster, 'canonicalPath'>): { risk: number; riskFlags: RiskTag[] } {
  const flags = new Set<RiskTag>();
  for (const s of cluster.canonicalPath) {
    for (const t of appDef(s.appKey)?.risk ?? []) flags.add(t);
    if (s.action === 'approve') flags.add('irreversible');
  }
  const riskFlags = RISK_ORDER.filter((t) => flags.has(t));
  return { risk: r2(Math.min(1, riskFlags.reduce((a, t) => a + RISK_WEIGHTS[t], 0))), riskFlags };
}

export function computeInputs(cluster: WorkflowCluster, ctx: ScoreContext): ScoreInputs {
  const daysObserved = Math.max(1, Math.round(ctx.daysObserved));
  const byId = new Map((ctx.episodes ?? []).map((e) => [e.id, e]));
  const members = cluster.episodeIds.map((id) => byId.get(id)).filter((e): e is TaskEpisode => !!e);
  const repeatability = members.length ? mean(members.map((m) => sequenceSimilarity(m.path, cluster.canonicalPath))) : cluster.cohesion;
  const ruleBasedShare = mean(cluster.canonicalPath.map((s) => ruleWeight(s.action)));
  const appScores = [...new Set(cluster.canonicalPath.map((s) => s.appKey))].map(appAutomationScore);
  const integrationFeasibility = 0.5 * mean(appScores) + 0.5 * Math.min(...appScores);
  const { risk, riskFlags } = riskFor(cluster);
  return {
    weeklyHours: weeklyHours(cluster.totalMinutes, daysObserved),
    repeatability: r2(repeatability),
    ruleBasedShare: r2(ruleBasedShare),
    integrationFeasibility: r2(integrationFeasibility),
    risk,
    riskFlags,
    occurrences: cluster.occurrences,
    daysSeen: cluster.daysSeen,
    daysObserved,
    cohesion: r2(cluster.cohesion),
  };
}

/** One plain sentence from the inputs (template, never the LLM). */
export function whySentence(i: ScoreInputs): string {
  const rule =
    i.ruleBasedShare >= 0.66 ? 'Mostly mechanical steps' : i.ruleBasedShare >= 0.4 ? 'A mix of mechanical steps and judgement' : 'Mostly judgement work';
  const integ =
    i.integrationFeasibility >= 0.7
      ? 'apps that connect well to automation tools'
      : i.integrationFeasibility >= 0.4
        ? 'apps with partial automation support'
        : 'apps that are hard to automate';
  const risk = i.riskFlags.length && i.risk >= 0.3 ? `; score reduced because it involves ${i.riskFlags.slice(0, 2).map((t) => RISK_WORDS[t]).join(' and ')}` : '';
  const s = `Seen ${i.occurrences} times on ${i.daysSeen} of ${i.daysObserved} days (${i.weeklyHours} h/week). ${rule} in ${integ}${risk}.`;
  return s.length <= 240 ? s : s.slice(0, 239) + '…';
}

export function computeOutputs(i: ScoreInputs): ScoreOutputs {
  const ap = automationPotential(i);
  const c = confidence(i);
  return {
    automationPotential: ap,
    confidence: c,
    confidenceLabel: confidenceLabel(c),
    reclaimableHoursPerWeek: reclaimableHours(i.weeklyHours, ap),
    why: whySentence(i),
  };
}

/** Rank order: reclaimable hours desc, then weekly hours desc, then id. */
export const compareScored = (a: ScoredCluster, b: ScoredCluster) =>
  b.score.outputs.reclaimableHoursPerWeek - a.score.outputs.reclaimableHoursPerWeek ||
  b.score.inputs.weeklyHours - a.score.inputs.weeklyHours ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function scoreClusters(clusters: readonly WorkflowCluster[], ctx: ScoreContext): ScoredCluster[] {
  return clusters
    .map((c) => {
      const inputs = computeInputs(c, ctx);
      return { ...c, score: { inputs, outputs: computeOutputs(inputs), formulaVersion: SCORING.version } };
    })
    .sort(compareScored);
}

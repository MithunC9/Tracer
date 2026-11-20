import type {
  CapabilityTag,
  CatalogEntry,
  ClusterRequirements,
  FitReason,
  RankedTool,
  SetupEffort,
  SkillLevel,
  UserConstraints,
} from '@tracer/schema';
import { APP_BY_KEY } from '@tracer/schema';

/**
 * Fit-only ranking. This module is a pure function of (requirements, entries, constraints).
 * It deliberately has no way to receive any revenue data: the inputs are the strict
 * `CatalogEntry` (which has no money-to-us fields) and the user's own constraints.
 * Links and disclosures are attached later, in disclose.ts, without reordering.
 *
 * Score budget (sums to 100 for a perfect fit):
 *   capability 50 · integration 25 · budget 10 · platform 5 · skill 5 · effort 5
 * Penalties (negative deltas): skill above the user's level, closed source when the user
 * prefers open source, and an AI assistant when a rule-based tool already covers the job.
 */

export type UnlinkedRankedTool = Omit<RankedTool, 'affiliate'>;

export interface RankOptions {
  /** Max tools returned. Default 5. */
  limit?: number;
}

export const DEFAULT_RANK_LIMIT = 5;

export const RANK_WEIGHTS = {
  capability: 50,
  integration: 25,
  budget: 10,
  platform: 5,
  skill: 5,
  effort: 5,
  /** Weight of a trigger capability relative to a work capability. */
  triggerCapabilityWeight: 0.5,
  /** Share of integration credit for generic (screen/browser) automation of an app. */
  genericIntegrationCredit: 0.6,
  /** Share of integration credit when the workflow names no specific apps. */
  noAppsIntegrationCredit: 0.5,
  closedSourcePenalty: -8,
  unneededLlmPenalty: -10,
} as const;

const BUDGET_POINTS: Record<UserConstraints['budget'], Record<CatalogEntry['pricingTier'], number | null>> = {
  free_only: { free: 10, included: 10, freemium: 6, paid: null },
  low: { free: 10, included: 10, freemium: 8, paid: 2 },
  any: { free: 10, included: 10, freemium: 9, paid: 7 },
};

const EFFORT_POINTS: Record<SetupEffort, number> = { minutes: 5, hour: 3, afternoon: 1, days: -2 };
const EFFORT_TEXT: Record<SetupEffort, string> = {
  minutes: 'Set up in minutes',
  hour: 'About an hour to set up',
  afternoon: 'An afternoon to set up',
  days: 'Several days to set up',
};

const SKILL_ORDER: Record<SkillLevel, number> = { none: 0, some: 1, technical: 2 };
const SKILL_TEXT: Record<SkillLevel, string> = {
  none: 'no technical skill',
  some: 'some comfort with formulas or settings',
  technical: 'scripting or coding',
};

const PLATFORM_TEXT: Record<UserConstraints['platform'], string> = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const isTrigger = (c: CapabilityTag) => c.startsWith('trigger_');
const capWeight = (c: CapabilityTag) => (isTrigger(c) ? RANK_WEIGHTS.triggerCapabilityWeight : 1);
const appName = (key: string) => APP_BY_KEY.get(key)?.name ?? key.replace(/^other:/, '');
const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** True for tools whose output is generated text rather than rule-based actions. */
export const isLlmTool = (e: CatalogEntry) => e.category === 'ai_assistant';

/** Share (0..1) of required capability weight the entry covers. */
export function capabilityCoverage(req: ClusterRequirements, e: CatalogEntry): { share: number; missing: CapabilityTag[]; covered: CapabilityTag[] } {
  const needed = uniq(req.capabilities);
  const have = new Set(e.capabilities);
  let total = 0;
  let got = 0;
  const missing: CapabilityTag[] = [];
  const covered: CapabilityTag[] = [];
  for (const c of needed) {
    const w = capWeight(c);
    total += w;
    if (have.has(c)) {
      got += w;
      covered.push(c);
    } else missing.push(c);
  }
  return { share: total === 0 ? 0 : got / total, missing, covered };
}

export type Exclusion = 'platform' | 'budget' | 'host_app' | 'not_a_crm_job' | 'no_capability';

/**
 * Hard filters. Returns the reason an entry is excluded, or null if it may be ranked.
 * - platform: no build for the user's OS and no web version.
 * - budget: paid-only tool for a free-only budget.
 * - host_app: a native feature (its host app is `integrations[0]`) of an app the workflow
 *   does not use. Gmail filters are no help to an Outlook user.
 * - not_a_crm_job: CRM products are only suggested when the workflow needs `crm_sync`.
 * - no_capability: covers none of the needed capabilities.
 */
export function exclusionReason(req: ClusterRequirements, e: CatalogEntry, c: UserConstraints): Exclusion | null {
  if (!e.platforms.includes(c.platform) && !e.platforms.includes('web')) return 'platform';
  if (BUDGET_POINTS[c.budget][e.pricingTier] === null) return 'budget';
  if (e.category === 'native_feature' && req.apps.length > 0) {
    const host = e.integrations[0];
    if (host === undefined || !req.apps.includes(host)) return 'host_app';
  }
  if (e.category === 'crm' && !req.capabilities.includes('crm_sync')) return 'not_a_crm_job';
  if (capabilityCoverage(req, e).covered.length === 0) return 'no_capability';
  return null;
}

function scoreEntry(req: ClusterRequirements, e: CatalogEntry, c: UserConstraints, ruleBasedToolCoversAll: boolean): { fitScore: number; reasons: FitReason[] } {
  const reasons: FitReason[] = [];
  const W = RANK_WEIGHTS;

  // capability
  const cov = capabilityCoverage(req, e);
  const needed = uniq(req.capabilities);
  reasons.push({
    factor: 'capability',
    delta: round1(W.capability * cov.share),
    note:
      cov.missing.length === 0
        ? needed.length === 1
          ? 'Covers the needed capability'
          : `Covers all ${needed.length} needed capabilities`
        : `Covers ${cov.covered.length} of ${needed.length} needed capabilities (missing: ${cov.missing.join(', ')})`,
  });

  // integration
  const apps = uniq(req.apps);
  if (apps.length === 0) {
    reasons.push({ factor: 'integration', delta: round1(W.integration * W.noAppsIntegrationCredit), note: 'No specific apps to connect' });
  } else {
    const direct: string[] = [];
    const generic: string[] = [];
    const none: string[] = [];
    for (const a of apps) {
      if (e.integrations.includes(a)) direct.push(a);
      else if (e.integrations.includes('*')) generic.push(a);
      else none.push(a);
    }
    const share = (direct.length + generic.length * W.genericIntegrationCredit) / apps.length;
    const parts: string[] = [];
    if (direct.length) parts.push(`connects to ${direct.map(appName).join(', ')}`);
    if (generic.length) parts.push(`drives ${generic.map(appName).join(', ')} through the screen or browser`);
    if (none.length) parts.push(`no connection to ${none.map(appName).join(', ')}`);
    const text = parts.join('; ');
    reasons.push({ factor: 'integration', delta: round1(W.integration * share), note: text.charAt(0).toUpperCase() + text.slice(1) });
  }

  // platform (hard-filtered already, so one of these holds)
  if (e.platforms.includes(c.platform)) reasons.push({ factor: 'platform', delta: W.platform, note: `Runs natively on ${PLATFORM_TEXT[c.platform]}` });
  else reasons.push({ factor: 'platform', delta: 3, note: 'Runs in the browser' });

  // budget
  const bp = BUDGET_POINTS[c.budget][e.pricingTier] ?? 0;
  const budgetNote: Record<CatalogEntry['pricingTier'], string> = {
    free: 'Free',
    included: 'No extra cost if you already pay for the host app',
    freemium: c.budget === 'free_only' ? 'Free tier available; limits may apply' : 'Free tier, paid plans for more',
    paid: c.budget === 'low' ? 'Paid only; stretches a low budget' : 'Paid',
  };
  reasons.push({ factor: 'budget', delta: bp, note: budgetNote[e.pricingTier] });

  // skill
  const gap = SKILL_ORDER[e.skillLevel] - SKILL_ORDER[c.skill];
  if (gap <= 0) reasons.push({ factor: 'skill', delta: W.skill, note: `Needs ${SKILL_TEXT[e.skillLevel]}; within your comfort level` });
  else reasons.push({ factor: 'skill', delta: gap === 1 ? -5 : -12, note: `Needs ${SKILL_TEXT[e.skillLevel]}, above your stated level` });

  // effort
  reasons.push({ factor: 'effort', delta: EFFORT_POINTS[e.setupEffort], note: EFFORT_TEXT[e.setupEffort] });

  // open source
  if (c.preferOpenSource) {
    reasons.push(
      e.openSource
        ? { factor: 'open_source', delta: 0, note: 'Open source or self-hostable' }
        : { factor: 'open_source', delta: W.closedSourcePenalty, note: 'Not open source; you asked to prefer open source' },
    );
  }

  // unneeded AI
  if (isLlmTool(e) && !req.involvesJudgement && ruleBasedToolCoversAll) {
    reasons.push({
      factor: 'capability',
      delta: W.unneededLlmPenalty,
      note: 'A rule-based tool already covers this; an AI assistant adds run-to-run variation without need',
    });
  }

  const total = reasons.reduce((s, r) => s + r.delta, 0);
  return { fitScore: clamp(round1(total), 0, 100), reasons };
}

/**
 * Rank catalog entries for one workflow by fit only. Pure and deterministic:
 * same inputs, same output, inputs untouched. Ties break on entry id (ascending).
 *
 * Exactly three required parameters plus an optional options bag with a default, so
 * `rankTools.length === 3`. There is no slot for anything except fit inputs.
 */
export function rankTools(
  req: ClusterRequirements,
  entries: readonly CatalogEntry[],
  constraints: UserConstraints,
  opts: RankOptions = {},
): UnlinkedRankedTool[] {
  const limit = Math.max(0, Math.floor(opts.limit ?? DEFAULT_RANK_LIMIT));
  const eligible = entries.filter((e) => exclusionReason(req, e, constraints) === null);
  const ruleBasedToolCoversAll = eligible.some((e) => !isLlmTool(e) && capabilityCoverage(req, e).missing.length === 0);

  const scored = eligible.map((e) => ({ e, ...scoreEntry(req, e, constraints, ruleBasedToolCoversAll) }));
  scored.sort((a, b) => b.fitScore - a.fitScore || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));

  return scored.slice(0, limit).map(({ e, fitScore, reasons }, i) => ({
    entryId: e.id,
    name: e.name,
    vendor: e.vendor,
    rank: i + 1,
    fitScore,
    reasons,
    pricingTier: e.pricingTier,
    priceNote: e.priceNote,
    setupEffort: e.setupEffort,
    url: e.url,
  }));
}

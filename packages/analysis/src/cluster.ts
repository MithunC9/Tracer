import { SCORING, type PathStep, type TaskEpisode, type WorkflowCluster } from '@tracer/schema';
import { appName } from './apps.js';
import { DEFAULT_CONFIG, type AnalysisConfig } from './config.js';
import { deriveRequirements } from './requirements.js';
import { centerEmbeddings, episodeSimilarity } from './similarity.js';
import { cosine } from './text.js';
import { clamp01, r1, sha256Hex, toMs } from './util.js';

/** Verbs that only consume information. A path made only of these has nothing to automate. */
const PASSIVE = new Set(['read', 'navigate', 'unknown']);

/**
 * Id signature = the ordered apps of the canonical path (consecutive repeats collapsed).
 * Actions are left out on purpose: they are inferred from titles and wobble between audits
 * ("paste" vs "edit"), while the app hand-off chain is what makes a workflow the same one.
 */
export function pathSignature(path: readonly Pick<PathStep, 'appKey'>[]): string {
  const apps: string[] = [];
  for (const s of path) if (apps[apps.length - 1] !== s.appKey) apps.push(s.appKey);
  return apps.join('>');
}

/** `wf_` + first 10 hex of sha256(signature). */
export const workflowId = (signature: string) => `wf_${sha256Hex(signature).slice(0, 10)}`;

/** "Stripe Dashboard → Google Sheets → QuickBooks Online"; single-app: "Google Sheets: Export → Edit". */
export function workflowLabel(path: readonly PathStep[]): string {
  const apps = [...new Set(path.map((s) => s.appKey))];
  let label: string;
  if (apps.length > 1) label = apps.map(appName).join(' → ');
  else {
    const verbs = [...new Set(path.map((s) => s.action))].map((v) => v.charAt(0).toUpperCase() + v.slice(1));
    label = `${appName(apps[0]!)}: ${verbs.join(' → ')}`;
  }
  return label.length > 120 ? label.slice(0, 119) + '…' : label;
}

/** Average-linkage agglomerative clustering over a dense similarity matrix. Deterministic. */
export function averageLinkage(n: number, sim: Float64Array, threshold: number): number[][] {
  const members: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i]);
  const active = new Uint8Array(n).fill(1);
  const best = new Int32Array(n).fill(-1);
  const S = (i: number, j: number) => sim[i * n + j]!;
  const recompute = (i: number) => {
    let b = -1;
    let bv = -Infinity;
    for (let j = 0; j < n; j++) {
      if (j === i || !active[j]) continue;
      const v = S(i, j);
      if (v > bv) {
        bv = v;
        b = j;
      }
    }
    best[i] = b;
  };
  for (let i = 0; i < n; i++) recompute(i);
  for (;;) {
    let bi = -1;
    let bv = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!active[i] || best[i]! < 0) continue;
      const v = S(i, best[i]!);
      if (v > bv) {
        bv = v;
        bi = i;
      }
    }
    if (bi < 0 || bv < threshold) break;
    const i = Math.min(bi, best[bi]!);
    const j = Math.max(bi, best[bi]!);
    const ni = members[i]!.length;
    const nj = members[j]!.length;
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === i || k === j) continue;
      const v = (ni * S(i, k) + nj * S(j, k)) / (ni + nj);
      sim[i * n + k] = v;
      sim[k * n + i] = v;
    }
    members[i] = [...members[i]!, ...members[j]!];
    members[j] = null;
    active[j] = 0;
    recompute(i);
    for (let k = 0; k < n; k++) {
      if (!active[k] || k === i) continue;
      if (best[k] === i || best[k] === j) recompute(k);
      else if (best[k]! >= 0 && S(k, i) > S(k, best[k]!)) best[k] = i;
    }
  }
  return members.filter((m): m is number[] => !!m).map((m) => m.sort((a, b) => a - b));
}

/**
 * Consensus path: the medoid's steps that are present (same app; or same app+action) in at
 * least `support` of the occurrences, consecutive duplicates collapsed, capped at maxSteps
 * (lowest-support steps dropped first).
 */
export function consensusPath(medoid: readonly PathStep[], members: readonly TaskEpisode[], support: number, maxSteps: number): PathStep[] {
  const scored = medoid.map((st, idx) => {
    let full = 0;
    let app = 0;
    for (const m of members) {
      if (m.path.some((p) => p.appKey === st.appKey && p.action === st.action)) full++;
      if (m.path.some((p) => p.appKey === st.appKey)) app++;
    }
    const n = Math.max(1, members.length);
    return { st, idx, full: full / n, app: app / n };
  });
  let keep = scored.filter((x) => x.full >= support);
  if (new Set(keep.map((x) => x.st.appKey)).size < 2) keep = scored.filter((x) => x.full >= support || x.app >= support);
  if (!keep.length) keep = scored;
  // collapse consecutive duplicates
  const collapsed: typeof keep = [];
  for (const x of keep) {
    const top = collapsed[collapsed.length - 1];
    if (top && top.st.appKey === x.st.appKey && top.st.action === x.st.action) continue;
    collapsed.push(x);
  }
  let out = collapsed;
  if (out.length > maxSteps) {
    const allowed = new Set(
      [...out]
        .sort((a, b) => b.full - a.full || b.app - a.app || a.idx - b.idx)
        .slice(0, maxSteps)
        .map((x) => x.idx),
    );
    out = out.filter((x) => allowed.has(x.idx));
  }
  return out.map((x) => ({ ...x.st }));
}

export interface ClusterOptions extends Partial<AnalysisConfig> {
  minOccurrences?: number;
}

/**
 * Find recurring workflows across days: pairwise episode similarity (sequence + app share +
 * text), average-linkage clustering with a fixed threshold, then keep clusters seen at least
 * SCORING.minOccurrences times whose consensus path has >= minPathSteps steps and is not
 * pure reading.
 */
export function clusterWorkflows(episodes: readonly TaskEpisode[], opts: ClusterOptions = {}): WorkflowCluster[] {
  const cfg: AnalysisConfig = { ...DEFAULT_CONFIG, ...opts, simWeights: { ...DEFAULT_CONFIG.simWeights, ...(opts.simWeights ?? {}) } };
  const minOcc = opts.minOccurrences ?? SCORING.minOccurrences;
  const eps = [...episodes].filter((e) => e.path.length > 0).sort((a, b) => toMs(a.start) - toMs(b.start) || (a.id < b.id ? -1 : 1));
  const n = eps.length;
  if (n === 0) return [];
  const sim = new Float64Array(n * n);
  const text = centerEmbeddings(eps.map((e) => e.embedding));
  for (let i = 0; i < n; i++) {
    sim[i * n + i] = 1;
    for (let j = i + 1; j < n; j++) {
      const v = episodeSimilarity(eps[i]!, eps[j]!, cfg.simWeights, text[i], text[j]);
      sim[i * n + j] = v;
      sim[j * n + i] = v;
    }
  }
  const original = sim.slice();
  const groups = averageLinkage(n, sim, cfg.clusterThreshold);

  const drafts: (Omit<WorkflowCluster, 'id'> & { signature: string; firstStart: number; members: TaskEpisode[] })[] = [];
  for (const g of groups) {
    if (g.length < minOcc) continue;
    const members = g.map((i) => eps[i]!);
    // medoid: max total similarity to the rest
    let medoid = g[0]!;
    let bestSum = -Infinity;
    let pairSum = 0;
    let pairs = 0;
    for (const i of g) {
      let s = 0;
      for (const j of g) if (i !== j) s += original[i * n + j]!;
      if (s > bestSum) {
        bestSum = s;
        medoid = i;
      }
      pairSum += s;
      pairs += g.length - 1;
    }
    const cohesion = clamp01(pairs ? pairSum / pairs : 1);
    let tSum = 0;
    let tN = 0;
    for (let a = 0; a < g.length; a++)
      for (let b = a + 1; b < g.length; b++) {
        tSum += cosine(text[g[a]!], text[g[b]!]);
        tN++;
      }
    if (tN && tSum / tN < cfg.minTextCohesion) continue;
    const canonicalPath = consensusPath(eps[medoid]!.path, members, cfg.consensusSupport, cfg.maxPathSteps);
    const distinct = new Set(canonicalPath.map((s) => `${s.appKey}:${s.action}`)).size;
    if (distinct < cfg.minPathSteps) continue;
    if (canonicalPath.every((s) => PASSIVE.has(s.action))) continue;
    const totalSeconds = members.reduce((a, m) => a + m.activeSeconds, 0);
    drafts.push({
      signature: pathSignature(canonicalPath),
      firstStart: toMs(members[0]!.start),
      members,
      label: workflowLabel(canonicalPath),
      episodeIds: members.map((m) => m.id),
      canonicalPath,
      occurrences: members.length,
      daysSeen: new Set(members.map((m) => m.dayIndex)).size,
      totalMinutes: r1(totalSeconds / 60),
      avgMinutes: r1(totalSeconds / 60 / members.length),
      cohesion: Math.round(cohesion * 1000) / 1000,
      representativeEpisodeId: eps[medoid]!.id,
      requirements: deriveRequirements(canonicalPath, members),
    });
  }

  // Stable ids. Two clusters with the same canonical path are disambiguated by order of first
  // appearance (earliest keeps the plain signature, then #2, #3...).
  drafts.sort((a, b) => a.firstStart - b.firstStart);
  const used = new Set<string>();
  const out: WorkflowCluster[] = [];
  for (const d of drafts) {
    let sig = d.signature;
    for (let k = 2; used.has(sig); k++) sig = `${d.signature}#${k}`;
    used.add(sig);
    const { signature: _s, firstStart: _f, members: _m, ...rest } = d;
    out.push({ id: workflowId(sig), ...rest });
  }
  return out.sort((a, b) => b.totalMinutes - a.totalMinutes || (a.id < b.id ? -1 : 1));
}

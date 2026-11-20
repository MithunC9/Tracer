import type { PathStep, TaskEpisode } from '@tracer/schema';
import type { AnalysisConfig } from './config.js';
import { cosine } from './text.js';

type Tok = Pick<PathStep, 'appKey' | 'action'>;

/** Step match score: same app and action = 1, same app = 0.6, else 0. */
export const stepMatch = (a: Tok, b: Tok): number => (a.appKey !== b.appKey ? 0 : a.action === b.action ? 1 : 0.6);

/** Weighted longest common subsequence of two paths. */
export function weightedLcs(a: readonly Tok[], b: readonly Tok[]): number {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Float64Array(n + 1);
  let cur = new Float64Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const w = stepMatch(a[i - 1]!, b[j - 1]!);
      const diag = prev[j - 1]! + w;
      cur[j] = Math.max(prev[j]!, cur[j - 1]!, w > 0 ? diag : 0);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[n]!;
}

/** Order-aware path similarity in 0..1: 2*wLCS / (|a| + |b|). Tolerates inserted/skipped steps. */
export function sequenceSimilarity(a: readonly Tok[], b: readonly Tok[]): number {
  if (!a.length || !b.length) return 0;
  return Math.min(1, (2 * weightedLcs(a, b)) / (a.length + b.length));
}

/** Cosine of app-usage count vectors (order-free). */
export function appShareSimilarity(a: readonly Tok[], b: readonly Tok[]): number {
  const ca = new Map<string, number>();
  const cb = new Map<string, number>();
  for (const s of a) ca.set(s.appKey, (ca.get(s.appKey) ?? 0) + 1);
  for (const s of b) cb.set(s.appKey, (cb.get(s.appKey) ?? 0) + 1);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of ca) {
    na += v * v;
    dot += v * (cb.get(k) ?? 0);
  }
  for (const v of cb.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Episode similarity = weighted sum of sequence, app-share and text similarity (all 0..1). */
export function episodeSimilarity(a: TaskEpisode, b: TaskEpisode, w: AnalysisConfig['simWeights']): number {
  const seq = sequenceSimilarity(a.path, b.path);
  const app = appShareSimilarity(a.path, b.path);
  const txt = Math.max(0, cosine(a.embedding, b.embedding));
  return w.sequence * seq + w.appShare * app + w.text * txt;
}

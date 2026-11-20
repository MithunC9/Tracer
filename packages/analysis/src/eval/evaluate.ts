import type { ActivityEvent, FocusSession, GroundTruth, TaskEpisode } from '@tracer/schema';
import type { AnalysisConfig } from '../config.js';
import { fallbackDeps } from '../fallback.js';
import { runPipeline } from '../pipeline.js';
import type { PipelineDeps } from '../ports.js';
import { toMs } from '../util.js';

export interface ClusterMatch {
  findingId: string;
  label: string;
  occurrences: number;
  /** Planted workflow id holding the majority of this cluster's active time, or null. */
  matched: string | null;
  /** Share of the cluster's active time inside that workflow's occurrences. */
  overlap: number;
}

export interface PersonaEval {
  persona: string;
  planted: number;
  plantedMatched: number;
  reported: number;
  reportedMatched: number;
  precision: number;
  recall: number;
  missed: string[];
  clusters: ClusterMatch[];
  ms: number;
}

/** Seconds of [s,e) covered by a sorted, merged list of intervals. */
function overlapSeconds(s: number, e: number, ivs: readonly [number, number][]): number {
  let tot = 0;
  for (const [a, b] of ivs) {
    if (b <= s) continue;
    if (a >= e) break;
    tot += Math.min(b, e) - Math.max(a, s);
  }
  return tot / 1000;
}

function merged(ivs: [number, number][]): [number, number][] {
  const s = [...ivs].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const iv of s) {
    const top = out[out.length - 1];
    if (top && iv[0] <= top[1]) top[1] = Math.max(top[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/**
 * A reported cluster matches a planted workflow when >= `threshold` of its episodes' active
 * time (sum over their focus sessions) falls inside that workflow's occurrence intervals.
 * recall = planted workflows matched by some reported cluster / planted;
 * precision = reported clusters matching some planted workflow / reported.
 */
export function matchClusters(
  findings: readonly { id: string; label: string; episodeIds: readonly string[] }[],
  episodes: readonly TaskEpisode[],
  sessions: readonly FocusSession[],
  gt: GroundTruth,
  threshold = 0.5,
): ClusterMatch[] {
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const sesById = new Map(sessions.map((s) => [s.id, s]));
  const wfIvs = gt.workflows.map((w) => ({ id: w.id, ivs: merged(w.occurrences.map((o) => [toMs(o.start), toMs(o.end)] as [number, number])) }));
  return findings.map((f) => {
    let total = 0;
    const per = new Map<string, number>();
    for (const eid of f.episodeIds) {
      const ep = epById.get(eid);
      if (!ep) continue;
      for (const sid of ep.sessionIds) {
        const s = sesById.get(sid);
        if (!s) continue;
        const a = toMs(s.start);
        const b = toMs(s.end);
        total += (b - a) / 1000;
        for (const w of wfIvs) per.set(w.id, (per.get(w.id) ?? 0) + overlapSeconds(a, b, w.ivs));
      }
    }
    let best: string | null = null;
    let bestV = 0;
    for (const [id, v] of per) if (v > bestV) [best, bestV] = [id, v];
    const overlap = total > 0 ? bestV / total : 0;
    return { findingId: f.id, label: f.label, occurrences: f.episodeIds.length, matched: overlap >= threshold ? best : null, overlap: Math.round(overlap * 100) / 100 };
  });
}

export async function evaluatePersona(
  events: readonly ActivityEvent[],
  gt: GroundTruth,
  opts: { deps?: PipelineDeps; config?: Partial<AnalysisConfig> } = {},
): Promise<PersonaEval> {
  const t0 = performance.now();
  const res = await runPipeline(
    events,
    { auditId: '00000000-0000-4000-8000-000000000000', startsAt: gt.startsAt, daysPlanned: gt.days, generatedAt: gt.startsAt, config: opts.config },
    opts.deps ?? fallbackDeps,
  );
  const ms = performance.now() - t0;
  const clusterById = new Map(res.scored.map((c) => [c.id, c]));
  const findings = res.report.findings.map((f) => ({ id: f.id, label: f.label, episodeIds: clusterById.get(f.id)?.episodeIds ?? [] }));
  const clusters = matchClusters(findings, res.episodes, res.sessions, gt);
  const matchedPlanted = new Set(clusters.map((c) => c.matched).filter((x): x is string => !!x));
  const reportedMatched = clusters.filter((c) => c.matched).length;
  return {
    persona: gt.persona,
    planted: gt.workflows.length,
    plantedMatched: matchedPlanted.size,
    reported: clusters.length,
    reportedMatched,
    precision: clusters.length ? reportedMatched / clusters.length : gt.workflows.length ? 0 : 1,
    recall: gt.workflows.length ? matchedPlanted.size / gt.workflows.length : 1,
    missed: gt.workflows.filter((w) => !matchedPlanted.has(w.id)).map((w) => w.label),
    clusters,
    ms: Math.round(ms),
  };
}

export interface EvalSummary {
  personas: PersonaEval[];
  precision: number;
  recall: number;
  passed: boolean;
}

export const EVAL_TARGETS = { recall: 0.8, precision: 0.75 } as const;

/** Micro-averaged over personas. */
export function summarize(personas: PersonaEval[]): EvalSummary {
  const planted = personas.reduce((a, p) => a + p.planted, 0);
  const pm = personas.reduce((a, p) => a + p.plantedMatched, 0);
  const rep = personas.reduce((a, p) => a + p.reported, 0);
  const rm = personas.reduce((a, p) => a + p.reportedMatched, 0);
  const precision = rep ? rm / rep : 0;
  const recall = planted ? pm / planted : 1;
  return { personas, precision, recall, passed: recall >= EVAL_TARGETS.recall && precision >= EVAL_TARGETS.precision };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function formatTable(s: EvalSummary): string {
  const rows = [
    '| persona | planted | matched | reported | correct | recall | precision | ms |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...s.personas.map((p) => `| ${p.persona} | ${p.planted} | ${p.plantedMatched} | ${p.reported} | ${p.reportedMatched} | ${pct(p.recall)} | ${pct(p.precision)} | ${p.ms} |`),
    `| **overall (micro)** | ${s.personas.reduce((a, p) => a + p.planted, 0)} | ${s.personas.reduce((a, p) => a + p.plantedMatched, 0)} | ${s.personas.reduce((a, p) => a + p.reported, 0)} | ${s.personas.reduce((a, p) => a + p.reportedMatched, 0)} | ${pct(s.recall)} | ${pct(s.precision)} | |`,
  ];
  return rows.join('\n');
}

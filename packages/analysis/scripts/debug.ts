/** Dev aid: dump episodes of a synthetic persona with ground-truth labels and cluster membership. */
import { fallbackDeps, runPipeline } from '../src/index.js';
import { PERSONAS, synthesize } from '../test/synth.js';

const pi = Number(process.argv[2] ?? 0);
const seed = Number(process.argv[3] ?? 47);
const verbose = process.argv[4] === 'v';
const { events, groundTruth: gt } = synthesize(PERSONAS[pi]!, seed);
const res = await runPipeline(events, { auditId: '00000000-0000-4000-8000-000000000000', startsAt: gt.startsAt, daysPlanned: 7, generatedAt: gt.startsAt }, fallbackDeps);
const ses = new Map(res.sessions.map((s) => [s.id, s]));
const wfOf = (start: string, end: string) => {
  const a = Date.parse(start);
  const b = Date.parse(end);
  for (const w of gt.workflows) for (const o of w.occurrences) if (Math.min(b, Date.parse(o.end)) - Math.max(a, Date.parse(o.start)) > (b - a) / 2) return w.id;
  return '-';
};
const clusterOf = new Map<string, string>();
for (const c of res.clusters) for (const e of c.episodeIds) clusterOf.set(e, c.label);
for (const e of res.episodes) {
  const wf = wfOf(e.start, e.end);
  const cl = clusterOf.get(e.id) ?? '';
  if (!verbose && wf === '-' && !cl) continue;
  console.log(`${e.start.slice(5, 16)} d${e.dayIndex} ${(e.activeSeconds / 60).toFixed(1)}m [${wf}] {${cl}} ${e.path.map((p) => p.appKey + ':' + p.action).join(' > ')}`);
  if (verbose) for (const sid of e.sessionIds) {
    const s = ses.get(sid)!;
    console.log(`      ${s.start.slice(11, 19)} ${s.activeSeconds}s ${s.appKey} ${s.action} ${s.windowTitle}`);
  }
}
for (const w of gt.workflows) console.log(w.id, w.occurrences.map((o) => o.start.slice(5, 16)).join(' '));
{
  const { centerEmbeddings, cosine } = await import('../src/index.js');
  const idx = new Map(res.episodes.map((e, i) => [e.id, i]));
  const cen = centerEmbeddings(res.episodes.map((e) => e.embedding));
  for (const c of res.clusters) {
    const v = c.episodeIds.map((id) => cen[idx.get(id)!]);
    let s = 0;
    let n = 0;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) {
      s += cosine(v[i], v[j]);
      n++;
    }
    console.log('textcoh', (s / n).toFixed(2), c.label, c.occurrences, c.avgMinutes);
  }
}
console.log(res.report.findings.map((f) => `${f.rank} ${f.label} occ=${f.metrics.occurrences} coh=${f.score.inputs.cohesion}`).join('\n'));

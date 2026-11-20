/** Dev aid: canonical paths/ids of each persona across seeds (id stability check). */
import { clusterWorkflows, pathSignature, segmentTasks, sessionize } from '../src/index.js';
import { PERSONAS, synthesize } from '../test/synth.js';

for (const p of PERSONAS) {
  for (const seed of [11, 29, 47]) {
    const { events, groundTruth } = synthesize(p, seed);
    const cl = clusterWorkflows(segmentTasks(sessionize(events), { auditStartsAt: groundTruth.startsAt }));
    for (const c of cl) console.log(p.name, seed, c.id, pathSignature(c.canonicalPath));
  }
}

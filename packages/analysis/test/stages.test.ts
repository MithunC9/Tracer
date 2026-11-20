import { describe, expect, it } from 'vitest';
import {
  automationPotential,
  confidence,
  confidenceLabel,
  reclaimableHours,
  ScoredCluster,
  TaskEpisode,
  weeklyHours,
  WorkflowCluster,
  type FocusSession,
  type PathStep,
} from '@tracer/schema';
import {
  averageLinkage,
  clusterWorkflows,
  compareScored,
  consensusPath,
  cosine,
  hashEmbed,
  pathSignature,
  scoreClusters,
  segmentTasks,
  sequenceSimilarity,
  sessionize,
  tokenize,
  workflowId,
  workflowLabel,
} from '../src/index.js';
import { createHash } from 'node:crypto';
import { PERSONAS, synthesize } from './synth.js';

let n = 0;
function ses(startSec: number, secs: number, appKey: string, title: string, extra: Partial<FocusSession> = {}): FocusSession {
  const t0 = Date.parse('2026-11-02T09:00:00.000Z');
  return {
    id: `ses_${(n++).toString().padStart(4, '0')}`,
    appKey,
    urlHost: null,
    windowTitle: title,
    start: new Date(t0 + startSec * 1000).toISOString(),
    end: new Date(t0 + (startSec + secs) * 1000).toISOString(),
    activeSeconds: secs,
    eventIds: [],
    clipboardEvents: 0,
    digestText: '',
    action: 'edit',
    ...extra,
  };
}

describe('hashEmbed', () => {
  it('is deterministic, has the contract dimension and unit norm', () => {
    const a = hashEmbed('Export payouts to CSV');
    expect(a).toHaveLength(256);
    expect(a).toEqual(hashEmbed('Export payouts to CSV'));
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 9);
    expect(hashEmbed('', 16)).toEqual(new Array(16).fill(0));
  });
  it('similar text is closer than unrelated text; digits and redactions ignored', () => {
    const a = hashEmbed('Payout reconciliation November');
    expect(cosine(a, hashEmbed('Payouts reconciliation 2026 November'))).toBeGreaterThan(0.8);
    expect(cosine(a, hashEmbed('Hiring plan for design team'))).toBeLessThan(0.2);
    expect(tokenize('Invoice INV-2041 for [REDACTED:email] - Gmail')).toEqual(['invoice', 'inv']);
  });
});

describe('segmentTasks', () => {
  it('splits on long gaps, drops short interruptions, and labels the path', () => {
    n = 0;
    const s = [
      ses(0, 300, 'stripe', 'Payouts', { action: 'export', digestText: 'payouts export' }),
      ses(300, 60, 'slack', 'general', { action: 'read', digestText: 'random chatter lunch' }),
      ses(360, 400, 'stripe', 'Payouts', { action: 'copy', clipboardEvents: 1, digestText: 'payouts export' }),
      ses(760, 500, 'google_sheets', 'Revenue sheet', { action: 'paste' }),
      // 30 min later: a new task
      ses(3060, 600, 'google_docs', 'Offsite agenda', { action: 'compose' }),
    ];
    const eps = segmentTasks(s, { auditStartsAt: '2026-11-01T00:00:00.000Z' });
    expect(eps).toHaveLength(2);
    expect(eps[0]!.sessionIds).toEqual([s[0]!.id, s[2]!.id, s[3]!.id]);
    expect(eps[0]!.activeSeconds).toBe(1200);
    expect(eps[0]!.path.map((p) => p.label)).toEqual(['Export in Stripe Dashboard', 'Copy from Stripe Dashboard', 'Paste into Google Sheets']);
    expect(eps[0]!.dayIndex).toBe(1);
    expect(eps[0]!.embedding).toHaveLength(256);
    for (const e of eps) TaskEpisode.parse(e);
  });

  it('splits on a topic shift to an unrelated app', () => {
    n = 0;
    const s = [
      ses(0, 600, 'excel', 'Cash forecast', { digestText: 'cash forecast inflows' }),
      ses(600, 600, 'figma', 'Logo concepts', { digestText: 'logo brand colors' }),
    ];
    expect(segmentTasks(s)).toHaveLength(2);
  });

  it('starts a new episode when the first step restarts with a new document', () => {
    n = 0;
    const s = [
      ses(0, 120, 'gmail', 'Invoice from Acme', { action: 'read', digestText: 'invoice amount due' }),
      ses(120, 200, 'quickbooks', 'Create bill', { digestText: 'bill vendor amount' }),
      ses(320, 120, 'gmail', 'Invoice from Globex', { action: 'read', digestText: 'invoice amount due' }),
      ses(440, 200, 'quickbooks', 'Create bill', { digestText: 'bill vendor amount' }),
    ];
    expect(segmentTasks(s)).toHaveLength(2);
  });
});

describe('clustering helpers', () => {
  const p = (...xs: [string, PathStep['action']][]) => xs.map(([appKey, action]) => ({ appKey, action, label: `${action} ${appKey}` }));
  it('sequence similarity tolerates a skipped or inserted step', () => {
    const a = p(['stripe', 'export'], ['google_sheets', 'paste'], ['quickbooks', 'edit']);
    expect(sequenceSimilarity(a, a)).toBe(1);
    expect(sequenceSimilarity(a, p(['stripe', 'export'], ['quickbooks', 'edit']))).toBeCloseTo(0.8);
    expect(sequenceSimilarity(a, p(['figma', 'edit']))).toBe(0);
  });
  it('average linkage merges only above threshold', () => {
    const sim = Float64Array.from([1, 0.9, 0.1, 0.9, 1, 0.2, 0.1, 0.2, 1]);
    expect(averageLinkage(3, sim, 0.5)).toEqual([[0, 1], [2]]);
  });
  it('stable id = wf_ + 10 hex of sha256(signature)', () => {
    const path = p(['stripe', 'export'], ['google_sheets', 'paste']);
    const sig = pathSignature(path);
    expect(sig).toBe('stripe>google_sheets');
    expect(pathSignature(p(['stripe', 'copy'], ['google_sheets', 'edit']))).toBe(sig);
    expect(workflowId(sig)).toBe('wf_' + createHash('sha256').update(sig).digest('hex').slice(0, 10));
    expect(workflowLabel(path)).toBe('Stripe Dashboard → Google Sheets');
    expect(workflowLabel(p(['excel', 'export'], ['excel', 'edit']))).toBe('Excel: Export → Edit');
  });
  it('consensus path drops steps seen in fewer than half of the occurrences', () => {
    const full = p(['stripe', 'export'], ['slack', 'read'], ['google_sheets', 'paste']);
    const mk = (path: PathStep[], i: number) => ({ id: `e${i}`, sessionIds: ['s'], start: '2026-11-02T09:00:00.000Z', end: '2026-11-02T09:10:00.000Z', activeSeconds: 600, path, dayIndex: i });
    const members = [mk(full, 0), mk(p(['stripe', 'export'], ['google_sheets', 'paste']), 1), mk(p(['stripe', 'export'], ['google_sheets', 'paste']), 2)];
    expect(consensusPath(full, members, 0.5, 8).map((s) => s.appKey)).toEqual(['stripe', 'google_sheets']);
  });
});

describe('cluster + score on a synthetic week', () => {
  const { events, groundTruth } = synthesize(PERSONAS[0]!, 11);
  const sessions = sessionize(events);
  const episodes = segmentTasks(sessions, { auditStartsAt: groundTruth.startsAt });
  const clusters = clusterWorkflows(episodes);

  it('clusters validate, are deterministic, and have >= minOccurrences', () => {
    expect(clusters.length).toBeGreaterThanOrEqual(3);
    for (const c of clusters) {
      WorkflowCluster.parse(c);
      expect(c.occurrences).toBeGreaterThanOrEqual(3);
      expect(c.canonicalPath.length).toBeGreaterThanOrEqual(2);
    }
    expect(clusterWorkflows(segmentTasks(sessionize([...events].reverse()), { auditStartsAt: groundTruth.startsAt }))).toEqual(clusters);
  });

  it('ids are stable across reruns and across re-audits with different data', () => {
    const run = (seed: number) => {
      const o = synthesize(PERSONAS[2]!, seed);
      return clusterWorkflows(segmentTasks(sessionize(o.events), { auditStartsAt: o.groundTruth.startsAt }));
    };
    const c1 = run(11);
    const c2 = run(47);
    const shared = c1.filter((c) => c2.some((d) => d.id === c.id));
    // the same workflow found in a different week gets the same id
    expect(shared.length).toBeGreaterThanOrEqual(2);
  });

  it('score outputs recompute exactly from inputs with the schema functions', () => {
    const scored = scoreClusters(clusters, { daysObserved: 7, episodes });
    for (const c of scored) {
      ScoredCluster.parse(c);
      const i = c.score.inputs;
      const o = c.score.outputs;
      expect(i.weeklyHours).toBe(weeklyHours(c.totalMinutes, 7));
      expect(o.automationPotential).toBe(automationPotential(i));
      expect(o.confidence).toBe(confidence(i));
      expect(o.confidenceLabel).toBe(confidenceLabel(o.confidence));
      expect(o.reclaimableHoursPerWeek).toBe(reclaimableHours(i.weeklyHours, o.automationPotential));
      expect(o.why.length).toBeLessThanOrEqual(240);
      expect(o.why).toMatch(/^Seen \d+ times on \d+ of 7 days/);
    }
    // ranked by reclaimable hours desc
    for (let k = 1; k < scored.length; k++) expect(compareScored(scored[k - 1]!, scored[k]!)).toBeLessThanOrEqual(0);
    for (let k = 1; k < scored.length; k++)
      expect(scored[k - 1]!.score.outputs.reclaimableHoursPerWeek).toBeGreaterThanOrEqual(scored[k]!.score.outputs.reclaimableHoursPerWeek);
  });

  it('flags money risk for payment apps and derives requirements', () => {
    const scored = scoreClusters(clusters, { daysObserved: 7, episodes });
    const payout = scored.find((c) => c.canonicalPath.some((s) => s.appKey === 'stripe'));
    expect(payout?.score.inputs.riskFlags).toContain('money');
    expect(payout?.requirements.capabilities.length).toBeGreaterThan(0);
    expect(payout?.requirements.apps).toContain('stripe');
  });
});

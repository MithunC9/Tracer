import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessLogEntry, AuditReport, automationPotential, DeletionReceipt, reclaimableHours, weeklyHours } from '@tracer/schema';
import { sampleAccessLog, sampleDeletionReceipt, sampleReport } from '../src/fixtures/index.js';

describe('sample fixtures', () => {
  it('sample report passes AuditReport.parse', () => {
    expect(() => AuditReport.parse(sampleReport)).not.toThrow();
  });

  it('every derived number matches the scoring formula', () => {
    for (const f of sampleReport.findings) {
      const i = f.score.inputs;
      expect(f.metrics.weeklyHours).toBe(weeklyHours(f.metrics.totalMinutes, sampleReport.window.daysObserved));
      expect(f.score.outputs.automationPotential).toBe(automationPotential(i));
      expect(f.score.outputs.reclaimableHoursPerWeek).toBe(reclaimableHours(i.weeklyHours, f.score.outputs.automationPotential));
      expect(f.metrics.totalMinutes).toBe(f.evidence.reduce((a, e) => a + e.minutes, 0));
      expect(f.metrics.occurrences).toBeGreaterThanOrEqual(3);
    }
    const ranks = sampleReport.findings.map((f) => f.rank);
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
    expect(sampleReport.summary.topFindingId).toBe(sampleReport.findings[0]?.id);
  });

  it('narrative numbers are all in allowedNumbers', () => {
    const nums = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    for (const f of sampleReport.findings) {
      for (const n of nums(`${f.narrative.headline} ${f.narrative.body}`)) expect(f.allowedNumbers).toContain(n);
    }
    const s = sampleReport.summary;
    for (const n of nums(`${s.narrative.headline} ${s.narrative.body}`)) expect(s.allowedNumbers).toContain(n);
  });

  it('privacy fixtures parse', () => {
    expect(() => DeletionReceipt.parse(sampleDeletionReceipt)).not.toThrow();
    for (const e of sampleAccessLog) expect(() => AccessLogEntry.parse(e)).not.toThrow();
  });
});

describe('tokens', () => {
  const cwd = resolve(__dirname, '..');
  it('tokens.css is generated from tokens.ts', () => {
    expect(() => execFileSync('node', ['scripts/tokens.mjs', '--check'], { cwd, stdio: 'pipe' })).not.toThrow();
  });
  it('every text/background pair passes WCAG AA', () => {
    expect(() => execFileSync('node', ['scripts/contrast.mjs'], { cwd, stdio: 'pipe' })).not.toThrow();
  });
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditReport } from '@tracer/schema';
import { describe, expect, it } from 'vitest';
import {
  allowedNumbersFor,
  assertValidReport,
  createLlmClient,
  LlmClient,
  MockProvider,
  narrateFinding,
  narrateSummary,
  ReportValidationError,
  validateReport,
} from '../src/index.js';
import { buildReport, clone } from './fixtures/report.js';

const locations = (r: ReturnType<typeof validateReport>) => r.errors.map((e) => e.location);

async function narratedReport(client: LlmClient, enforce = true): Promise<AuditReport> {
  const report = buildReport();
  for (const f of report.findings) {
    f.narrative = await narrateFinding(
      client,
      {
        label: f.label,
        path: f.path,
        metrics: f.metrics,
        score: f.score,
        recipeTitle: f.recipe.title,
        topToolNames: f.tools.map((t) => t.name),
        allowedNumbers: f.allowedNumbers,
      },
      { enforce },
    );
  }
  report.summary.narrative = await narrateSummary(
    client,
    {
      reclaimableHoursPerWeek: report.summary.reclaimableHoursPerWeek,
      daysObserved: report.window.daysObserved,
      findingCount: report.findings.length,
      topFindingLabel: report.findings[0]!.label,
      topFindingHoursPerWeek: report.findings[0]!.score.outputs.reclaimableHoursPerWeek,
      findingLabels: report.findings.map((f) => f.label),
      allowedNumbers: report.summary.allowedNumbers,
    },
    { enforce },
  );
  return report;
}

describe('validateReport: passing reports', () => {
  it('passes the hand-built fixture and checks its numbers', () => {
    const r = validateReport(buildReport());
    expect(r.errors).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.checkedNumbers).toBeGreaterThan(15);
    expect(() => assertValidReport(buildReport())).not.toThrow();
  });

  it('passes a report narrated end to end by the mock', async () => {
    const report = await narratedReport(createLlmClient({ provider: 'mock' }));
    const r = validateReport(report);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.checkedNumbers).toBeGreaterThan(5);
  });

  it('finding prose may use summary-level numbers', () => {
    const report = buildReport();
    report.findings[1]!.narrative.body += ` That is part of the ${report.summary.reclaimableHoursPerWeek} h/week total.`;
    expect(validateReport(report).passed).toBe(true);
  });
});

describe('validateReport: hallucinated numbers', () => {
  it('catches a number the mock hallucinated (guard off)', async () => {
    const client = new LlmClient({ provider: new MockProvider({ faultMode: 'hallucinate_number' }) });
    const report = await narratedReport(client, false);
    const r = validateReport(report);
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.location === 'findings[0].narrative.body' && e.value === '37.5')).toBe(true);
    expect(r.errors.every((e) => e.reason.includes('not in allowedNumbers'))).toBe(true);
  });

  it('rejects rounded variants and percentages that were not allowed', () => {
    const report = buildReport();
    const f = report.findings[0]!;
    const wh = f.metrics.weeklyHours; // 1.7
    const off = Math.round((wh + 0.1) * 10) / 10;
    expect([...f.allowedNumbers, ...report.summary.allowedNumbers]).not.toContain(off);
    f.narrative.body = `Roughly ${off} hours a week, 99% of it copy-paste.`;
    const r = validateReport(report);
    expect(r.errors.map((e) => e.value)).toEqual([String(off), '99%']);
  });

  it('summary prose may not borrow finding-only numbers', () => {
    const report = buildReport();
    const ap = report.findings[0]!.score.outputs.automationPotential;
    expect(report.summary.allowedNumbers).not.toContain(ap);
    report.summary.narrative.body += ` The top one scores ${ap}.`;
    expect(locations(validateReport(report))).toEqual(['summary.narrative.body']);
  });

  it('spelled-out numbers are checked; "one" is not', () => {
    const report = buildReport();
    report.findings[0]!.narrative.body += ' One of the steps happens eleven times.';
    const r = validateReport(report);
    expect(r.errors.map((e) => e.value)).toEqual(['eleven']);
  });

  it('cannot whitelist a hallucination by editing allowedNumbers', () => {
    const report = buildReport();
    report.findings[0]!.allowedNumbers.push(37.5);
    report.findings[0]!.narrative.body += ' That is 37.5 hours a month.';
    const r = validateReport(report);
    expect(r.passed).toBe(false);
    expect(r.errors).toEqual([expect.objectContaining({ location: 'findings[0].allowedNumbers', value: '37.5' })]);
  });

  it('banned words are warnings', () => {
    const report = buildReport();
    report.summary.narrative.body += ' Leverage seamless automation.';
    const r = validateReport(report);
    expect(r.passed).toBe(true);
    expect(r.warnings.map((w) => w.value)).toEqual(['leverage', 'seamless']);
  });
});

describe('validateReport: tampered computed data', () => {
  const tamper = (fn: (r: AuditReport) => void) => {
    const report = clone(buildReport());
    fn(report);
    return validateReport(report);
  };

  it('tampered automation potential', () => {
    const r = tamper((rep) => {
      rep.findings[0]!.score.outputs.automationPotential += 5;
    });
    expect(locations(r)).toContain('findings[0].score.outputs.automationPotential');
    expect(r.passed).toBe(false);
  });

  it('tampered reclaimable hours (and the summary no longer sums)', () => {
    const r = tamper((rep) => {
      rep.findings[1]!.score.outputs.reclaimableHoursPerWeek = 0.2;
    });
    expect(locations(r)).toEqual(
      expect.arrayContaining(['findings[1].score.outputs.reclaimableHoursPerWeek', 'summary.reclaimableHoursPerWeek']),
    );
  });

  it('tampered confidence and label', () => {
    const r = tamper((rep) => {
      rep.findings[0]!.score.outputs.confidence = 0.99;
      rep.findings[0]!.score.outputs.confidenceLabel = 'high';
    });
    expect(locations(r)).toContain('findings[0].score.outputs.confidence');
  });

  it('weekly hours that do not follow from total minutes', () => {
    const r = tamper((rep) => {
      rep.findings[0]!.metrics.totalMinutes += 120;
    });
    expect(locations(r)).toEqual(expect.arrayContaining(['findings[0].metrics.weeklyHours', 'findings[0].metrics.avgMinutes']));
  });

  it('evidence count and days', () => {
    const r = tamper((rep) => {
      rep.findings[0]!.evidence.pop();
    });
    expect(locations(r)).toContain('findings[0].evidence');
  });

  it('ranks must be contiguous and ordered by reclaimable hours', () => {
    const r1 = tamper((rep) => {
      rep.findings[1]!.rank = 3;
    });
    expect(locations(r1)).toContain('findings[1].rank');
    const r2 = tamper((rep) => {
      rep.findings.reverse();
      rep.findings.forEach((f, i) => (f.rank = i + 1));
    });
    expect(locations(r2)).toEqual(expect.arrayContaining(['findings[1].score.outputs.reclaimableHoursPerWeek', 'summary.topFindingId']));
  });

  it('summary calculation must sum', () => {
    const r = tamper((rep) => {
      rep.summary.calculation[0]!.value += 1;
    });
    expect(locations(r)).toContain('summary.calculation');
  });

  it('schema violations are reported, not thrown', () => {
    const r = validateReport({ reportVersion: 1 });
    expect(r.passed).toBe(false);
    expect(r.errors[0]!.reason).toMatch(/^schema:/);
  });

  it('assertValidReport throws with the error list', () => {
    const report = buildReport();
    report.findings[0]!.score.outputs.automationPotential = 1;
    expect(() => assertValidReport(report)).toThrow(ReportValidationError);
  });
});

describe('allowedNumbersFor', () => {
  it('includes metrics, scores, AP, confidence %, weekly + reclaimable hours, occurrences, days', () => {
    const f = buildReport().findings[0]!;
    const a = allowedNumbersFor(f);
    const o = f.score.outputs;
    for (const n of [
      f.metrics.occurrences,
      f.metrics.daysSeen,
      f.score.inputs.daysObserved,
      f.metrics.weeklyHours,
      o.automationPotential,
      o.confidence,
      Math.round(o.confidence * 100),
      o.reclaimableHoursPerWeek,
      f.path.length,
    ]) {
      expect(a).toContain(n);
    }
    expect([...a].sort((x, y) => x - y)).toEqual(a);
  });
});

describe('validate-report CLI', () => {
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  const bin = join(pkg, 'dist/bin/validate-report.js');
  const run = (file: string) => {
    try {
      return { code: 0, out: execFileSync(process.execPath, [bin, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { code: err.status, out: err.stdout };
    }
  };

  it.skipIf(!existsSync(bin))('exits 0 for a valid report and 1 for a tampered one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracer-llm-'));
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify(buildReport()));
    const t = buildReport();
    t.findings[0]!.narrative.body += ' It saves 42 hours.';
    writeFileSync(bad, JSON.stringify(t));
    expect(run(good)).toMatchObject({ code: 0 });
    const r = run(bad);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL/);
    expect(r.out).toMatch(/findings\[0\]\.narrative\.body/);
    expect(run(join(dir, 'missing.json')).code).toBe(2);
  });
});

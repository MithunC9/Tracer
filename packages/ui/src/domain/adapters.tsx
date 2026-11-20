import type { AuditReport } from '@tracer/schema';
import type { ReactNode } from 'react';
import type { LedgerRow } from './LedgerTable.js';
import type { WeekStripRow } from './WeekStrip.js';
import { PathTrail } from './PathTrail.js';

/** Findings -> ledger rows. `detail` lets the caller decide what an expanded row shows. */
export function ledgerRowsFromReport(report: AuditReport, detail?: (f: AuditReport['findings'][number]) => ReactNode): LedgerRow[] {
  return report.findings.map((f) => ({
    id: f.id,
    rank: f.rank,
    label: f.label,
    weeklyHours: f.metrics.weeklyHours,
    automationPotential: f.score.outputs.automationPotential,
    confidence: f.score.outputs.confidenceLabel,
    meta: <PathTrail steps={f.path} variant="compact" />,
    detail: detail ? detail(f) : undefined,
  }));
}

/** Findings -> week strip rows; the top finding is highlighted. */
export function weekRowsFromReport(report: AuditReport): WeekStripRow[] {
  return report.findings.map((f) => ({
    id: f.id,
    label: f.label,
    occurrences: f.evidence,
    highlight: f.id === report.summary.topFindingId,
  }));
}

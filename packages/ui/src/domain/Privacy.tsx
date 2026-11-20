import type { AccessLogEntry, DeletionReceipt as DeletionReceiptT } from '@tracer/schema';
import type { ReactNode } from 'react';
import { cx, fmtDateTime, fmtInt } from '../lib.js';
import { EmptyState, ErrorState, RuledSkeleton } from '../primitives/Feedback.js';

/* ---------- PrivacyLedger ---------- */

export interface PrivacyItem {
  item: ReactNode;
  note?: ReactNode;
}

export interface PrivacyLedgerProps {
  captured: readonly PrivacyItem[];
  notCaptured: readonly PrivacyItem[];
  capturedTitle?: ReactNode;
  notCapturedTitle?: ReactNode;
  className?: string;
}

/** Two ruled columns: what Tracer records, and what it never does. */
export function PrivacyLedger({ captured, notCaptured, capturedTitle = 'Recorded', notCapturedTitle = 'Never recorded', className }: PrivacyLedgerProps) {
  const col = (title: ReactNode, items: readonly PrivacyItem[], kind: 'yes' | 'no') => (
    <section className="tr-pledger__col" data-kind={kind}>
      <h3 className="tr-pledger__title">
        <span className="tr-pledger__mark tr-num" aria-hidden="true">
          {kind === 'yes' ? '+' : '×'}
        </span>
        {title}
        <span className="tr-pledger__count tr-num">{items.length}</span>
      </h3>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <span className="tr-pledger__item">{it.item}</span>
            {it.note ? <span className="tr-pledger__note">{it.note}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className={cx('tr-pledger', className)}>
      {col(capturedTitle, captured, 'yes')}
      {col(notCapturedTitle, notCaptured, 'no')}
    </div>
  );
}

/* ---------- AccessLogTable ---------- */

export interface AccessLogTableProps {
  entries: readonly AccessLogEntry[];
  caption?: ReactNode;
  timeZone?: string;
  loading?: boolean;
  error?: { title: ReactNode; body?: ReactNode; onRetry?: () => void; requestId?: string } | null;
  className?: string;
}

const actorWord = { user: 'You', device: 'Your device', system: 'Tracer' } as const;

/** Every read and write of your data, newest first. Dense, mono, nothing hidden. */
export function AccessLogTable({ entries, caption = 'Access log', timeZone = 'UTC', loading, error, className }: AccessLogTableProps) {
  if (loading) return <RuledSkeleton lines={6} label="Loading access log" className={className} />;
  if (error)
    return (
      <ErrorState title={error.title} onRetry={error.onRetry} requestId={error.requestId} className={className}>
        {error.body}
      </ErrorState>
    );
  if (entries.length === 0)
    return (
      <EmptyState title="No access recorded yet" kicker="Empty log" className={className}>
        Every time you, your device or Tracer reads or changes your data, a line appears here.
      </EmptyState>
    );
  return (
    <div className={cx('tr-access', className)}>
      <table className="tr-access__table">
        <caption className="tr-access__caption">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">When ({timeZone})</th>
            <th scope="col">Who</th>
            <th scope="col">Action</th>
            <th scope="col">Resource</th>
            <th scope="col" className="tr-access__req">
              Request
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} data-actor={e.actor}>
              <td className="tr-num tr-access__when">{fmtDateTime(e.at, timeZone)}</td>
              <td>{actorWord[e.actor]}</td>
              <td className="tr-num">{e.action}</td>
              <td className="tr-num tr-access__res">{e.resource}</td>
              <td className="tr-num tr-access__req">{e.requestId ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- DeletionReceipt ---------- */

export interface DeletionReceiptProps {
  receipt: DeletionReceiptT;
  timeZone?: string;
  className?: string;
}

const chunk = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'g')) ?? [s];

/**
 * A printed receipt for a deletion: what was removed, table by table, with the
 * server's signature. Mono, narrow, perforated edges. Prints as is.
 */
export function DeletionReceipt({ receipt: r, timeZone = 'UTC', className }: DeletionReceiptProps) {
  const total = r.tables.reduce((a, t) => a + t.rowsDeleted, 0);
  return (
    <article className={cx('tr-receipt', className)} aria-label="Deletion receipt">
      <header className="tr-receipt__head">
        <p className="tr-receipt__brand">TRACER</p>
        <h3 className="tr-receipt__title">Certificate of deletion</h3>
        <p className="tr-receipt__id">No. {r.receiptId}</p>
      </header>
      <dl className="tr-receipt__kv">
        <div>
          <dt>Requested</dt>
          <dd>{fmtDateTime(r.requestedAt, timeZone)}</dd>
        </div>
        <div>
          <dt>Completed</dt>
          <dd>{fmtDateTime(r.completedAt, timeZone)}</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>sha256:{r.subjectHash.slice(0, 12)}…</dd>
        </div>
      </dl>
      <table className="tr-receipt__table">
        <caption className="tr-vh">Rows deleted per table</caption>
        <thead>
          <tr>
            <th scope="col">Table</th>
            <th scope="col">Rows</th>
          </tr>
        </thead>
        <tbody>
          {r.tables.map((t) => (
            <tr key={t.table}>
              <th scope="row">{t.table}</th>
              <td>{fmtInt(t.rowsDeleted)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{fmtInt(total)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="tr-receipt__purge">
        Derived data purge: <strong>{r.derivedDataPurge === 'complete' ? 'COMPLETE' : 'SCHEDULED'}</strong>
      </p>
      <div className="tr-receipt__sig">
        <p>HMAC-SHA256 signature</p>
        <p className="tr-receipt__sighex">
          {chunk(r.signature, 8).map((c, i) => (
            <span key={i}>{c} </span>
          ))}
        </p>
      </div>
      <p className="tr-receipt__foot">Keep this receipt. It proves the deletion without identifying you.</p>
    </article>
  );
}

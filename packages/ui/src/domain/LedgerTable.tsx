'use client';
import { Fragment, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx, fmt, pad2 } from '../lib.js';
import { Collapse } from '../primitives/Disclosure.js';
import { EmptyState, ErrorState, RuledSkeleton } from '../primitives/Feedback.js';
import { ConfidenceMarks, HoursBar, PotentialTicks, type ConfidenceLevel } from './glyphs.js';

export interface LedgerRow {
  id: string;
  rank: number;
  label: string;
  weeklyHours: number;
  /** 0..100 */
  automationPotential: number;
  confidence: ConfidenceLevel;
  /** A short line under the label (e.g. the app path). */
  meta?: ReactNode;
  /** Revealed when the row is expanded. */
  detail?: ReactNode;
}

export type LedgerSortKey = 'rank' | 'weeklyHours' | 'automationPotential' | 'confidence';

export interface LedgerTableProps {
  rows: readonly LedgerRow[];
  /** Caption (visible). Tables always have one. */
  caption: ReactNode;
  /** Row drawn with the signal color (the top finding). Follows the row when sorting. */
  highlightId?: string | null;
  sortable?: boolean;
  defaultExpanded?: readonly string[];
  onToggle?: (id: string, open: boolean) => void;
  loading?: boolean;
  error?: { title: ReactNode; body?: ReactNode; onRetry?: () => void } | null;
  empty?: { title: ReactNode; body?: ReactNode };
  className?: string;
}

const confRank: Record<ConfidenceLevel, number> = { low: 0, medium: 1, high: 2 };
const COLS = 5;

/**
 * The ranked ledger of workflows. Keyboard: Tab enters the ledger once; Up/Down move
 * between rows, Home/End jump, Enter or Space expands. Rows expand smoothly
 * (instantly under reduced motion).
 */
export function LedgerTable({
  rows,
  caption,
  highlightId,
  sortable = false,
  defaultExpanded = [],
  onToggle,
  loading,
  error,
  empty = { title: 'No repeated workflows found', body: 'Nothing happened often enough to count. A workflow needs at least three occurrences.' },
  className,
}: LedgerTableProps) {
  const base = useId();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded));
  const [sort, setSort] = useState<{ key: LedgerSortKey; dir: 'asc' | 'desc' }>({ key: 'rank', dir: 'asc' });
  const [focusIdx, setFocusIdx] = useState(0);
  const btns = useRef<Array<HTMLButtonElement | null>>([]);

  const sorted = useMemo(() => {
    const val = (r: LedgerRow) => (sort.key === 'confidence' ? confRank[r.confidence] : r[sort.key]);
    const xs = [...rows].sort((a, b) => {
      const d = val(a) - val(b);
      return (sort.dir === 'asc' ? d : -d) || a.rank - b.rank;
    });
    return xs;
  }, [rows, sort]);

  const max = Math.max(0, ...rows.map((r) => r.weeklyHours));

  const toggle = (id: string) => {
    setOpen((s) => {
      const n = new Set(s);
      const willOpen = !n.has(id);
      if (willOpen) n.add(id);
      else n.delete(id);
      onToggle?.(id, willOpen);
      return n;
    });
  };

  const move = (i: number) => {
    const j = Math.max(0, Math.min(sorted.length - 1, i));
    setFocusIdx(j);
    btns.current[j]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        move(0);
        break;
      case 'End':
        e.preventDefault();
        move(sorted.length - 1);
        break;
      case 'ArrowRight':
        if (!open.has(sorted[i]!.id)) {
          e.preventDefault();
          toggle(sorted[i]!.id);
        }
        break;
      case 'ArrowLeft':
        if (open.has(sorted[i]!.id)) {
          e.preventDefault();
          toggle(sorted[i]!.id);
        }
        break;
    }
  };

  const header = (key: LedgerSortKey, label: ReactNode, short: string, cls: string) => {
    const active = sort.key === key;
    const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    const content = (
      <>
        <span className="tr-ledger__hlong">{label}</span>
        <span className="tr-ledger__hshort" aria-hidden="true">
          {short}
        </span>
      </>
    );
    return (
      <th scope="col" className={cls} aria-sort={sortable ? ariaSort : undefined}>
        {sortable ? (
          <button
            type="button"
            className="tr-ledger__sort"
            onClick={() =>
              setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'rank' ? 'asc' : 'desc' }))
            }
          >
            {content}
            <span className="tr-ledger__arrow tr-num" aria-hidden="true">
              {active ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          </button>
        ) : (
          content
        )}
      </th>
    );
  };

  let body: ReactNode;
  if (loading) {
    body = (
      <tr>
        <td colSpan={COLS} className="tr-ledger__state">
          <RuledSkeleton lines={5} label="Ranking workflows" />
        </td>
      </tr>
    );
  } else if (error) {
    body = (
      <tr>
        <td colSpan={COLS} className="tr-ledger__state">
          <ErrorState title={error.title} onRetry={error.onRetry}>
            {error.body}
          </ErrorState>
        </td>
      </tr>
    );
  } else if (rows.length === 0) {
    body = (
      <tr>
        <td colSpan={COLS} className="tr-ledger__state">
          <EmptyState title={empty.title} kicker="Empty ledger">
            {empty.body}
          </EmptyState>
        </td>
      </tr>
    );
  } else {
    body = sorted.map((r, i) => {
      const isOpen = open.has(r.id);
      const detailId = `${base}-d-${r.id}`;
      const hl = highlightId === r.id;
      return (
        <Fragment key={r.id}>
          <tr className="tr-ledger__row" data-open={isOpen || undefined} data-signal={hl || undefined}>
            <td className="tr-ledger__rank tr-num">{pad2(r.rank)}</td>
            <th scope="row" className="tr-ledger__label">
              <button
                ref={(el) => {
                  btns.current[i] = el;
                }}
                type="button"
                className="tr-ledger__toggle"
                aria-expanded={r.detail ? isOpen : undefined}
                aria-controls={r.detail ? detailId : undefined}
                tabIndex={i === focusIdx ? 0 : -1}
                onFocus={() => setFocusIdx(i)}
                onClick={() => r.detail && toggle(r.id)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="tr-ledger__sign tr-num" aria-hidden="true">
                  {r.detail ? (isOpen ? '−' : '+') : ''}
                </span>
                <span className="tr-ledger__text">
                  <span className="tr-ledger__name">{r.label}</span>
                  {r.meta ? <span className="tr-ledger__meta">{r.meta}</span> : null}
                </span>
              </button>
            </th>
            <td className="tr-ledger__hours">
              <span className="tr-ledger__cell">
                <span className="tr-num tr-ledger__fig">{fmt(r.weeklyHours, 1)}</span>
                <HoursBar value={r.weeklyHours} max={max} signal={hl} className="tr-ledger__glyph" />
              </span>
            </td>
            <td className="tr-ledger__ap">
              <span className="tr-ledger__cell">
                <span className="tr-num tr-ledger__fig">{fmt(r.automationPotential, 0)}</span>
                <PotentialTicks value={r.automationPotential} className="tr-ledger__glyph" />
              </span>
            </td>
            <td className="tr-ledger__conf">
              <ConfidenceMarks level={r.confidence} />
            </td>
          </tr>
          {r.detail ? (
            <tr className="tr-ledger__detail" data-open={isOpen || undefined}>
              <td colSpan={COLS}>
                <Collapse open={isOpen} id={detailId}>
                  <div className="tr-ledger__detail-inner">{r.detail}</div>
                </Collapse>
              </td>
            </tr>
          ) : null}
        </Fragment>
      );
    });
  }

  return (
    <div className={cx('tr-ledger', className)}>
      <table className="tr-ledger__table" aria-busy={loading || undefined}>
        <caption className="tr-ledger__caption">{caption}</caption>
        <thead>
          <tr>
            {header('rank', 'No.', 'No.', 'tr-ledger__rank')}
            <th scope="col" className="tr-ledger__label">
              Workflow
            </th>
            {header('weeklyHours', 'Hours / week', 'h/wk', 'tr-ledger__hours')}
            {header('automationPotential', 'Automatable', 'Auto', 'tr-ledger__ap')}
            {header('confidence', 'Confidence', 'Conf.', 'tr-ledger__conf')}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
      {!loading && !error && rows.length > 0 ? (
        <p className="tr-ledger__keys">
          <span className="tr-vh">Keyboard: </span>
          <kbd className="tr-kbd">↑</kbd>
          <kbd className="tr-kbd">↓</kbd> move · <kbd className="tr-kbd">Enter</kbd> open a row
        </p>
      ) : null}
    </div>
  );
}

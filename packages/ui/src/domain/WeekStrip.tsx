'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Occurrence } from '@tracer/schema';
import { cx, dayLabel, fmtMinutes, hashSeed, rng, zonedParts } from '../lib.js';
import { EmptyState, RuledSkeleton } from '../primitives/Feedback.js';

export interface WeekStripRow {
  id: string;
  label: string;
  occurrences: readonly Occurrence[];
  /** Ticks in vermilion. Reserve for the top finding. */
  highlight?: boolean;
}

export interface WeekStripProps {
  rows: readonly WeekStripRow[];
  /** Audit window start (day 0). */
  startsAt: string;
  /** 7 or 14 (any 1-14 works). */
  days: number;
  /** Visible hours of each day, e.g. [7, 20]. Default: fitted to the data, at least 8 hours. */
  hours?: [number, number];
  timeZone?: string;
  caption: ReactNode;
  defaultView?: 'strip' | 'table';
  loading?: boolean;
  className?: string;
}

const VB = 100; // viewBox units per day

/**
 * Days across, workflows down. Each occurrence is a tick placed at its time of day;
 * its width is its duration. A table view carries the same numbers for screen readers
 * and for anyone who prefers to read rather than scan.
 */
export function WeekStrip({ rows, startsAt, days, hours, timeZone = 'UTC', caption, defaultView = 'strip', loading, className }: WeekStripProps) {
  const id = useId();
  const [view, setView] = useState(defaultView);
  const [hover, setHover] = useState<{ row: number; day: number } | null>(null);

  const dayInfo = useMemo(() => Array.from({ length: days }, (_, d) => dayLabel(startsAt, d, timeZone)), [startsAt, days, timeZone]);

  const win = useMemo<[number, number]>(() => {
    if (hours) return hours;
    let lo = 24;
    let hi = 0;
    for (const r of rows)
      for (const o of r.occurrences) {
        const s = zonedParts(o.start, timeZone);
        const e = zonedParts(o.end, timeZone);
        lo = Math.min(lo, s.hour);
        hi = Math.max(hi, e.hour + (e.minute > 0 ? 1 : 0));
      }
    if (lo >= hi) return [8, 18];
    lo = Math.max(0, lo - 1);
    hi = Math.min(24, hi + 1);
    if (hi - lo < 8) hi = Math.min(24, lo + 8);
    return [lo, hi];
  }, [rows, hours, timeZone]);

  const perDay = useMemo(
    () =>
      rows.map((r) => {
        const cells = Array.from({ length: days }, () => ({ n: 0, min: 0 }));
        for (const o of r.occurrences) {
          const c = cells[o.dayIndex];
          if (c) {
            c.n += 1;
            c.min += o.minutes;
          }
        }
        return cells;
      }),
    [rows, days],
  );

  const span = win[1] - win[0];
  const xOf = (iso: string) => {
    const p = zonedParts(iso, timeZone);
    const h = p.hour + p.minute / 60 + p.second / 3600;
    return Math.max(0, Math.min(1, (h - win[0]) / span)) * VB;
  };

  if (loading) {
    return (
      <figure className={cx('tr-week', className)}>
        <figcaption className="tr-week__caption">{caption}</figcaption>
        <RuledSkeleton lines={4} label="Plotting the week" />
      </figure>
    );
  }

  if (rows.length === 0) {
    return (
      <figure className={cx('tr-week', className)}>
        <figcaption className="tr-week__caption">{caption}</figcaption>
        <EmptyState title="No occurrences to plot" kicker="Empty week">
          Nothing repeated during these days.
        </EmptyState>
      </figure>
    );
  }

  const readout = (() => {
    if (!hover) return null;
    const r = rows[hover.row];
    const c = perDay[hover.row]?.[hover.day];
    const d = dayInfo[hover.day];
    if (!r || !c || !d) return null;
    return (
      <>
        <span className="tr-num">
          {d.dow} {d.day} {d.month}
        </span>
        <span className="tr-week__readout-sep" aria-hidden="true">
          {' · '}
        </span>
        {c.n === 0 ? (
          <span>not seen</span>
        ) : (
          <>
            <strong className="tr-num">
              {c.n}× · {fmtMinutes(c.min)}
            </strong>
          </>
        )}
        <span className="tr-week__readout-sep" aria-hidden="true">
          {' · '}
        </span>
        <span className="tr-week__readout-label">{r.label}</span>
      </>
    );
  })();

  const total = (i: number) => (perDay[i] ?? []).reduce((a, c) => ({ n: a.n + c.n, min: a.min + c.min }), { n: 0, min: 0 });

  return (
    <figure className={cx('tr-week', className)} data-days={days}>
      <div className="tr-week__top">
        <figcaption className="tr-week__caption" id={`${id}-cap`}>
          {caption}
        </figcaption>
        <button type="button" className="tr-week__switch" aria-pressed={view === 'table'} onClick={() => setView(view === 'strip' ? 'table' : 'strip')}>
          {view === 'strip' ? 'Show as table' : 'Show as strip'}
        </button>
      </div>

      {view === 'strip' ? (
        <div className="tr-week__plot" style={{ ['--days' as string]: String(days) }}>
          <div className="tr-week__row tr-week__row--head" aria-hidden="true">
            <span className="tr-week__name" />
            <span className="tr-week__days">
              {dayInfo.map((d, i) => (
                <span key={i} className="tr-week__day" data-weekend={d.weekend || undefined}>
                  <span className="tr-week__dow">{d.dow.slice(0, days > 7 ? 1 : 3)}</span>
                  <span className="tr-num">{d.day}</span>
                </span>
              ))}
            </span>
            <span className="tr-week__total tr-num">Σ</span>
          </div>
          {rows.map((r, ri) => {
            const t = total(ri);
            const seed = rng(hashSeed(r.id));
            return (
              <div key={r.id} className="tr-week__row" data-highlight={r.highlight || undefined}>
                <span className="tr-week__name">{r.label}</span>
                <svg
                  className="tr-week__svg"
                  viewBox={`0 0 ${days * VB} 24`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${r.label}: ${t.n} occurrences on ${perDay[ri]?.filter((c) => c.n > 0).length ?? 0} of ${days} days, ${fmtMinutes(t.min)} in total. Use the table view for each day.`}
                  onPointerLeave={() => setHover(null)}
                >
                  {dayInfo.map((d, di) =>
                    d.weekend ? <rect key={`w${di}`} x={di * VB} y={0} width={VB} height={24} className="tr-week__weekend" /> : null,
                  )}
                  <line x1={0} x2={days * VB} y1={23.5} y2={23.5} className="tr-week__base" vectorEffect="non-scaling-stroke" />
                  {dayInfo.map((_, di) => (
                    <line key={`s${di}`} x1={di * VB} x2={di * VB} y1={0} y2={24} className="tr-week__sep" vectorEffect="non-scaling-stroke" />
                  ))}
                  {r.occurrences.map((o) => {
                    const x0 = o.dayIndex * VB + xOf(o.start);
                    const w = Math.max(1.4, (o.minutes / 60 / span) * VB);
                    const jitter = (seed() - 0.5) * 2;
                    return <rect key={o.episodeId} x={x0} y={5 + jitter} width={w} height={15 - jitter} className="tr-week__tick" />;
                  })}
                  {dayInfo.map((_, di) => (
                    <rect key={`h${di}`} x={di * VB} y={0} width={VB} height={24} className="tr-week__hit" onPointerEnter={() => setHover({ row: ri, day: di })} />
                  ))}
                </svg>
                <span className="tr-week__total tr-num">{t.n}×</span>
              </div>
            );
          })}
          <p className="tr-week__readout" aria-hidden="true">
            {readout ?? (
              <span className="tr-week__hint">
                Each day runs <span className="tr-num">{String(win[0]).padStart(2, '0')}:00–{String(win[1]).padStart(2, '0')}:00</span>. Tick width is duration. Point at a day to read it.
              </span>
            )}
          </p>
        </div>
      ) : (
        <div className="tr-week__tablewrap">
          <table className="tr-week__table" aria-labelledby={`${id}-cap`}>
            <thead>
              <tr>
                <th scope="col">Workflow</th>
                {dayInfo.map((d, i) => (
                  <th key={i} scope="col" className="tr-num">
                    {d.dow} {d.day}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => {
                const t = total(ri);
                return (
                  <tr key={r.id}>
                    <th scope="row">{r.label}</th>
                    {(perDay[ri] ?? []).map((c, di) => (
                      <td key={di} className="tr-num">
                        {c.n === 0 ? <span aria-label="none">–</span> : `${c.n}× ${Math.round(c.min)}m`}
                      </td>
                    ))}
                    <td className="tr-num">
                      {t.n}× {fmtMinutes(t.min)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

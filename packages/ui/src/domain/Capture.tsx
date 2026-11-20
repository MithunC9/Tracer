import type { ReactNode } from 'react';
import { cx, fmt } from '../lib.js';

export interface CountdownBadgeProps {
  day: number;
  total: number;
  status?: 'capturing' | 'paused' | 'scheduled' | 'analyzing' | 'complete';
  className?: string;
}

const statusWord = { capturing: 'Recording', paused: 'Paused', scheduled: 'Starts soon', analyzing: 'Analysing', complete: 'Complete' } as const;

/** "Day 3 of 7", with one ruled cell per day. */
export function CountdownBadge({ day, total, status = 'capturing', className }: CountdownBadgeProps) {
  const d = Math.max(0, Math.min(total, day));
  return (
    <p className={cx('tr-count', className)} data-status={status}>
      <span className="tr-count__status">{statusWord[status]}</span>
      <span className="tr-count__day tr-num">
        Day {d} of {total}
      </span>
      <span className="tr-count__cells" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-state={i < d - 1 || (status === 'complete' && i < d) ? 'done' : i === d - 1 ? 'now' : 'todo'} />
        ))}
      </span>
    </p>
  );
}

export interface ProgressRuleProps {
  value: number;
  max: number;
  label: ReactNode;
  /** Right-hand reading, e.g. "3 of 7 days". Defaults to percent. */
  reading?: ReactNode;
  /** Tick marks (e.g. one per day). */
  ticks?: number;
  caption?: ReactNode;
  className?: string;
}

/** Capture progress as a ruled line: hairline track, heavy ink up to now, a tick per day. */
export function ProgressRule({ value, max, label, reading, ticks = 0, caption, className }: ProgressRuleProps) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div className={cx('tr-progress', className)}>
      <div className="tr-progress__head">
        <span className="tr-progress__label" id={undefined}>
          {label}
        </span>
        <span className="tr-progress__reading tr-num">{reading ?? `${fmt(pct, 0)}%`}</span>
      </div>
      <div
        className="tr-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={typeof reading === 'string' ? reading : `${fmt(pct, 0)} percent`}
        aria-label={typeof label === 'string' ? label : 'Progress'}
      >
        {Array.from({ length: Math.max(0, ticks - 1) }, (_, i) => (
          <span key={i} className="tr-progress__tick" style={{ left: `${((i + 1) / ticks) * 100}%` }} />
        ))}
        <span className="tr-progress__fill" style={{ width: `${pct}%` }} />
        <span className="tr-progress__now" style={{ left: `${pct}%` }} />
      </div>
      {caption ? <p className="tr-progress__caption">{caption}</p> : null}
    </div>
  );
}

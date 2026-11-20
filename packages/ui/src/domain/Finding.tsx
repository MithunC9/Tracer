import type { Finding } from '@tracer/schema';
import type { ReactNode } from 'react';
import { cx, fmt, pad2 } from '../lib.js';
import { Spread } from '../layout/Layout.js';
import { ConfidenceMarks } from './glyphs.js';
import { PathTrail } from './PathTrail.js';

export interface FindingMetricsProps {
  finding: Finding;
  daysObserved: number;
  className?: string;
}

/** The finding's numbers as a dense ruled row: hours, occurrences, days, average, automatable, confidence. */
export function FindingMetrics({ finding: f, daysObserved, className }: FindingMetricsProps) {
  const m = f.metrics;
  const o = f.score.outputs;
  return (
    <dl className={cx('tr-metrics', className)}>
      <div>
        <dt>Hours / week</dt>
        <dd className="tr-num">{fmt(m.weeklyHours, 1)}</dd>
      </div>
      <div>
        <dt>Reclaimable</dt>
        <dd className="tr-num">{fmt(o.reclaimableHoursPerWeek, 1)}</dd>
      </div>
      <div>
        <dt>Seen</dt>
        <dd className="tr-num">
          {m.occurrences}× <span className="tr-metrics__sub">on {m.daysSeen}/{daysObserved} days</span>
        </dd>
      </div>
      <div>
        <dt>Average</dt>
        <dd className="tr-num">
          {fmt(m.avgMinutes, 1)} <span className="tr-metrics__sub">min</span>
        </dd>
      </div>
      <div>
        <dt>Automatable</dt>
        <dd className="tr-num">
          {fmt(o.automationPotential, 0)}
          <span className="tr-metrics__sub">/100</span>
        </dd>
      </div>
      <div>
        <dt>Confidence</dt>
        <dd>
          <ConfidenceMarks level={o.confidenceLabel} />
        </dd>
      </div>
    </dl>
  );
}

export interface FindingSectionProps {
  finding: Finding;
  /** 1-based position in the report; printed as "Finding 01". */
  index: number;
  daysObserved: number;
  /** The top finding: its number is inked in vermilion. One per report. */
  top?: boolean;
  /** Margin annotations (MarginNote elements). */
  notes?: ReactNode;
  /** Figures and sections below the narrative: week strip, score, recipe, tools. */
  children?: ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * A full finding, laid out like a numbered entry in a lab record: number, headline,
 * why, the measurements, then the evidence and the fix. Prints on its own page.
 */
export function FindingSection({ finding: f, index, daysObserved, top, notes, children, headingLevel = 2, className }: FindingSectionProps) {
  const H = `h${headingLevel}` as 'h2';
  const hid = `finding-${f.id}`;
  return (
    <article className={cx('tr-finding', className)} id={f.id} aria-labelledby={hid} data-top={top || undefined}>
      <header className="tr-finding__mast">
        <p className="tr-finding__no">
          <span className="tr-finding__word">Finding</span>
          <span className="tr-finding__num tr-num">{pad2(index)}</span>
        </p>
        <p className="tr-finding__label">{f.label}</p>
        <p className="tr-finding__hours tr-num">
          {fmt(f.metrics.weeklyHours, 1)}
          <span> h/wk</span>
        </p>
      </header>
      <Spread notes={notes}>
        <H className="tr-heading tr-finding__headline" data-size="display2" id={hid}>
          {f.narrative.headline}
        </H>
        <p className="tr-finding__why">{f.score.outputs.why}</p>
        <div className="tr-prose tr-finding__body">
          {f.narrative.body.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        <FindingMetrics finding={f} daysObserved={daysObserved} />
        <div className="tr-finding__path">
          <p className="tr-kicker">The path</p>
          <PathTrail steps={f.path} />
        </div>
      </Spread>
      {children ? <div className="tr-finding__more">{children}</div> : null}
    </article>
  );
}

export interface FindingCardProps {
  finding: Finding;
  index: number;
  top?: boolean;
  href?: string;
  className?: string;
}

/** Compact entry for a contents list: number, label, hours, why. Ruled, not boxed. */
export function FindingCard({ finding: f, index, top, href, className }: FindingCardProps) {
  const inner = (
    <>
      <span className="tr-fcard__num tr-num">{pad2(index)}</span>
      <span className="tr-fcard__text">
        <span className="tr-fcard__label">{f.label}</span>
        <span className="tr-fcard__why">{f.score.outputs.why}</span>
      </span>
      <span className="tr-fcard__fig tr-num">
        {fmt(f.metrics.weeklyHours, 1)}
        <span className="tr-fcard__unit"> h/wk</span>
      </span>
    </>
  );
  return (
    <div className={cx('tr-fcard', className)} data-top={top || undefined}>
      {href ? (
        <a className="tr-fcard__link" href={href}>
          {inner}
        </a>
      ) : (
        <div className="tr-fcard__link">{inner}</div>
      )}
    </div>
  );
}

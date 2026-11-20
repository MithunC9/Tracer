import type { PathStep } from '@tracer/schema';
import { appName, cx } from '../lib.js';

export interface PathTrailProps {
  steps: readonly PathStep[];
  /** compact: one line, verbs inline (ledger rows). full: app over verb, wraps. */
  variant?: 'full' | 'compact';
  /** Override display names for app keys. */
  names?: Readonly<Record<string, string>>;
  className?: string;
}

/**
 * The route a workflow takes through your apps, written like a typeset itinerary:
 *   Stripe Dashboard ──export──▸ Excel ──paste──▸ QuickBooks Online
 * An ordered list, so screen readers hear "step 1 of 4".
 */
export function PathTrail({ steps, variant = 'full', names, className }: PathTrailProps) {
  const label = steps.map((s) => `${s.action} in ${names?.[s.appKey] ?? appName(s.appKey)}`).join(', then ');
  if (variant === 'compact') {
    return (
      <span className={cx('tr-trail', className)} data-variant="compact">
        <span className="tr-vh">Path: {label}</span>
        <span aria-hidden="true">
          {steps.map((s, i) => (
            <span key={i} className="tr-trail__c">
              {i > 0 ? <span className="tr-trail__arrow"> → </span> : null}
              {names?.[s.appKey] ?? appName(s.appKey)}
            </span>
          ))}
        </span>
      </span>
    );
  }
  return (
    <ol className={cx('tr-trail', className)} data-variant="full" aria-label="Path through apps">
      {steps.map((s, i) => (
        <li key={i} className="tr-trail__step" title={s.label}>
          {i > 0 ? (
            <svg className="tr-trail__link" viewBox="0 0 40 8" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 4.2 Q20 3.4 37 4" fill="none" vectorEffect="non-scaling-stroke" />
              <path d="M34 1.2 L39.5 4 L34 6.8" fill="none" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : null}
          <span className="tr-trail__meta">
            <span className="tr-trail__n tr-num" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>{' '}
            <span className="tr-trail__verb tr-num">{s.action}</span>
          </span>
          <span className="tr-trail__app">{names?.[s.appKey] ?? appName(s.appKey)}</span>
        </li>
      ))}
    </ol>
  );
}

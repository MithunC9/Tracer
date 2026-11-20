import { AFFILIATE_DISCLOSURE, type Finding, type RankedTool } from '@tracer/schema';
import { cx, fmt } from '../lib.js';
import { EmptyState } from '../primitives/Feedback.js';

export interface ToolOptionsProps {
  tools: readonly RankedTool[];
  diy: Finding['diyOption'];
  /** Where the recipe lives on the page, e.g. "#recipe-wf_123". */
  recipeHref: string;
  /** Show at most this many tools (DIY always shown). */
  limit?: number;
  className?: string;
}

const tierWord = { free: 'Free', freemium: 'Free tier', paid: 'Paid', included: 'Already included' } as const;
const effortWord = { minutes: 'minutes', hour: 'an hour', afternoon: 'an afternoon', days: 'days' } as const;
const factorWord = {
  capability: 'does the job',
  integration: 'connects your apps',
  platform: 'runs on your platform',
  budget: 'fits budget',
  skill: 'fits skill',
  effort: 'setup effort',
  open_source: 'open source',
} as const;

function FitMeter({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className="tr-fit">
      <span className="tr-fit__num tr-num">{fmt(score, 0)}</span>
      <span className="tr-fit__unit">fit</span>
      <svg className="tr-fit__bar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="100" y1="5.5" y2="5.5" vectorEffect="non-scaling-stroke" className="tr-glyph__track" />
        <rect x="0" y="1" width={pct} height="4" className="tr-glyph__fill" />
      </svg>
    </span>
  );
}

/**
 * Ranked tools (by fit only) beside the build-it-yourself option, which always appears
 * and carries the same weight. Affiliate links say so in plain words, next to the link.
 */
export function ToolOptions({ tools, diy, recipeHref, limit = 3, className }: ToolOptionsProps) {
  const shown = tools.slice(0, limit);
  return (
    <section className={cx('tr-tools', className)} aria-label="Ways to fix it">
      <ol className="tr-tools__list">
        <li className="tr-tools__opt" data-diy>
          <p className="tr-tools__rank tr-num">DIY</p>
          <div className="tr-tools__main">
            <h4 className="tr-tools__name">Build it yourself with this recipe</h4>
            <p className="tr-tools__vendor">{diy.label}</p>
          </div>
          <dl className="tr-tools__facts">
            <div>
              <dt>Cost</dt>
              <dd>Free</dd>
            </div>
            <div>
              <dt>Setup</dt>
              <dd className="tr-num">~{diy.estSetupMinutes} min</dd>
            </div>
          </dl>
          <ul className="tr-tools__reasons">
            <li>
              <span className="tr-tools__delta tr-num">·</span> No new account. Uses apps you already have.
            </li>
            <li>
              <span className="tr-tools__delta tr-num">·</span> Not ranked: always an option.
            </li>
          </ul>
          <p className="tr-tools__cta">
            <a className="tr-link" href={recipeHref}>
              Read the recipe
            </a>
          </p>
        </li>
        {shown.map((t) => (
          <li key={t.entryId} className="tr-tools__opt">
            <p className="tr-tools__rank tr-num">
              <span className="tr-vh">Rank </span>
              {String(t.rank).padStart(2, '0')}
            </p>
            <div className="tr-tools__main">
              <h4 className="tr-tools__name">{t.name}</h4>
              <p className="tr-tools__vendor">{t.vendor}</p>
              <FitMeter score={t.fitScore} />
            </div>
            <dl className="tr-tools__facts">
              <div>
                <dt>Cost</dt>
                <dd>
                  {tierWord[t.pricingTier]}
                  <span className="tr-tools__price"> · {t.priceNote}</span>
                </dd>
              </div>
              <div>
                <dt>Setup</dt>
                <dd>{effortWord[t.setupEffort]}</dd>
              </div>
            </dl>
            <ul className="tr-tools__reasons" aria-label={`Why ${t.name} fits`}>
              {t.reasons.slice(0, 4).map((r, i) => (
                <li key={i}>
                  <span className="tr-tools__delta tr-num" data-neg={r.delta < 0 || undefined}>
                    {r.delta > 0 ? '+' : r.delta < 0 ? '−' : '±'}
                    {fmt(Math.abs(r.delta), 0)}
                  </span>{' '}
                  <span className="tr-tools__factor">{factorWord[r.factor]}:</span> {r.note}
                </li>
              ))}
            </ul>
            <p className="tr-tools__cta">
              {t.affiliate ? (
                <>
                  <a className="tr-link" href={t.affiliate.url} target="_blank" rel="sponsored noopener noreferrer">
                    Visit {t.name}
                    <span className="tr-vh"> (opens in a new tab)</span>
                  </a>
                  <span className="tr-tools__commission" title={t.affiliate.disclosure || AFFILIATE_DISCLOSURE}>
                    We may earn a commission
                  </span>
                </>
              ) : (
                <a className="tr-link" href={t.url} target="_blank" rel="noopener noreferrer">
                  Visit {t.name}
                  <span className="tr-vh"> (opens in a new tab)</span>
                </a>
              )}
            </p>
            {t.affiliate ? <p className="tr-tools__disclosure">{t.affiliate.disclosure || AFFILIATE_DISCLOSURE}</p> : null}
          </li>
        ))}
      </ol>
      {shown.length === 0 ? (
        <EmptyState title="No tool fits well enough" kicker="No tools">
          None of the tools we track handle this combination of apps. The recipe above still works.
        </EmptyState>
      ) : null}
      <p className="tr-tools__foot">Tools are ranked by fit to this workflow only. Commissions are joined after ranking and cannot change the order.</p>
    </section>
  );
}

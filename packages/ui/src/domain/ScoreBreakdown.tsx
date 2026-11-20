import { automationPotential, reclaimableHours, SCORING, type ScoreBreakdown as ScoreBreakdownT } from '@tracer/schema';
import type { ReactNode } from 'react';
import { cx, fmt } from '../lib.js';
import { Tag } from '../primitives/Type.js';
import { ConfidenceMarks } from './glyphs.js';

export interface ScaleProps {
  label: ReactNode;
  /** e.g. "× 0.35" or "penalty × 0.5" */
  weight?: ReactNode;
  value: number;
  min?: number;
  max?: number;
  /** Decimals printed. */
  decimals?: number;
  unit?: string;
  /** Low end / high end words under the scale. */
  ends?: [string, string];
  /** Major tick every n (in value units). */
  major?: number;
  /** Minor ticks between majors. */
  minor?: number;
  note?: ReactNode;
}

/** One instrument scale: ruled ticks, a pointer at the value, the reading in mono. */
export function Scale({ label, weight, value, min = 0, max = 1, decimals = 2, unit, ends, major = 0.25, minor = 5, note }: ScaleProps) {
  const pct = ((Math.max(min, Math.min(max, value)) - min) / (max - min)) * 100;
  const majors = Math.round((max - min) / major);
  const ticks: Array<{ x: number; big: boolean }> = [];
  for (let i = 0; i <= majors * minor; i++) ticks.push({ x: (i / (majors * minor)) * 100, big: i % minor === 0 });
  return (
    <div className="tr-scale">
      <div className="tr-scale__head">
        <span className="tr-scale__label">{label}</span>
        {weight ? <span className="tr-scale__weight tr-num">{weight}</span> : null}
      </div>
      <div className="tr-scale__instrument">
        <svg className="tr-scale__ticks" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="100" y1="13.5" y2="13.5" vectorEffect="non-scaling-stroke" className="tr-scale__base" />
          {ticks.map((t, i) => (
            <line key={i} x1={t.x} x2={t.x} y1={t.big ? 4 : 9} y2={14} vectorEffect="non-scaling-stroke" className={t.big ? 'tr-scale__major' : 'tr-scale__minor'} />
          ))}
          <rect x="0" y="12" width={pct} height="2" className="tr-scale__fill" />
        </svg>
        <span className="tr-scale__needle" style={{ left: `${pct}%` }} aria-hidden="true" />
        {ends ? (
          <span className="tr-scale__ends" aria-hidden="true">
            <span>{ends[0]}</span>
            <span>{ends[1]}</span>
          </span>
        ) : null}
      </div>
      <span className="tr-scale__value tr-num">
        {fmt(value, decimals)}
        {unit ? <span className="tr-scale__unit"> {unit}</span> : null}
      </span>
      {note ? <div className="tr-scale__note">{note}</div> : null}
    </div>
  );
}

export interface ScoreBreakdownProps {
  breakdown: ScoreBreakdownT;
  /** Show the formula lines (default true). */
  showFormula?: boolean;
  className?: string;
}

const riskWord: Record<string, string> = { money: 'money', pii: 'personal data', irreversible: 'irreversible', credentials: 'credentials', health: 'health' };

/**
 * The five scoring inputs as instrument scales, with weights, then the formula written
 * out with the real numbers. Uses the same `automationPotential` as the pipeline.
 */
export function ScoreBreakdown({ breakdown, showFormula = true, className }: ScoreBreakdownProps) {
  const { inputs: i, outputs: o } = breakdown;
  const w = SCORING.weights;
  const recomputed = automationPotential(i);
  const reclaim = reclaimableHours(i.weeklyHours, o.automationPotential);
  const hoursMax = Math.max(5, Math.ceil(i.weeklyHours / 5) * 5);
  const f2 = (n: number) => fmt(n, 2);
  return (
    <section className={cx('tr-score', className)} aria-label="Score breakdown">
      <div className="tr-score__scales">
        <Scale label="Time spent" weight="input" value={i.weeklyHours} max={hoursMax} decimals={1} unit="h/wk" major={hoursMax / 5} minor={4} ends={['0', `${hoursMax} h`]} />
        <Scale label="Repeatability" weight={`× ${f2(w.repeatability)}`} value={i.repeatability} ends={['varies', 'identical']} />
        <Scale label="Rule-based share" weight={`× ${f2(w.ruleBasedShare)}`} value={i.ruleBasedShare} ends={['judgement', 'mechanical']} />
        <Scale label="Integration feasibility" weight={`× ${f2(w.integrationFeasibility)}`} value={i.integrationFeasibility} ends={['closed', 'open APIs']} />
        <Scale
          label="Risk"
          weight={`penalty × ${fmt(SCORING.riskPenalty, 1)}`}
          value={i.risk}
          ends={['harmless', 'high stakes']}
          note={
            i.riskFlags.length ? (
              <span className="tr-score__flags">
                {i.riskFlags.map((f) => (
                  <Tag key={f} tone="signal">
                    {riskWord[f] ?? f}
                  </Tag>
                ))}
              </span>
            ) : null
          }
        />
      </div>
      {showFormula ? (
        <div className="tr-score__formula">
          <p className="tr-kicker">Formula v{breakdown.formulaVersion}</p>
          <p className="tr-score__line tr-num">
            <span className="tr-score__lhs">automatable</span> = 100 × ({f2(w.repeatability)} × {f2(i.repeatability)} + {f2(w.ruleBasedShare)} × {f2(i.ruleBasedShare)} + {f2(w.integrationFeasibility)} ×{' '}
            {f2(i.integrationFeasibility)}) × (1 − {fmt(SCORING.riskPenalty, 1)} × {f2(i.risk)}) = <strong>{fmt(o.automationPotential, 0)}</strong>
          </p>
          <p className="tr-score__line tr-num">
            <span className="tr-score__lhs">reclaimable</span> = {fmt(i.weeklyHours, 1)} h × {f2(o.automationPotential / 100)} × {f2(SCORING.captureRate)} ={' '}
            <strong>{fmt(reclaim, 1)} h/wk</strong>
          </p>
          <p className="tr-score__line tr-num">
            <span className="tr-score__lhs">confidence</span> = {f2(o.confidence)} <ConfidenceMarks level={o.confidenceLabel} />
            <span className="tr-score__basis">
              {' '}
              from {i.occurrences} occurrences on {i.daysSeen} of {i.daysObserved} days, cohesion {f2(i.cohesion)}
            </span>
          </p>
          {recomputed !== o.automationPotential ? (
            <p className="tr-score__warn" role="note">
              Stored score {fmt(o.automationPotential, 0)} differs from the current formula ({fmt(recomputed, 0)}). The stored value is shown.
            </p>
          ) : null}
          <p className="tr-score__why">{o.why}</p>
        </div>
      ) : null}
    </section>
  );
}

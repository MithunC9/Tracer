import { cx, hashSeed, rng } from '../lib.js';

/*
 * Inline data glyphs for tables. Each is decorative next to a printed number
 * (aria-hidden): the number is the data, the glyph is the shape of it.
 */

export interface HoursBarProps {
  value: number;
  max: number;
  /** Vermilion fill: reserve for the top finding. */
  signal?: boolean;
  width?: number;
  className?: string;
}

/** A thin bar on a hairline baseline. Length is exact; the end is ruled by hand. */
export function HoursBar({ value, max, signal, width = 96, className }: HoursBarProps) {
  const h = 10;
  const w = max > 0 ? Math.max(0, Math.min(1, value / max)) * width : 0;
  const r = rng(hashSeed(`${value}:${max}`));
  const lift = (r() - 0.5) * 0.8;
  return (
    <svg className={cx('tr-glyph', 'tr-hbar', className)} width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true" data-signal={signal || undefined}>
      <line x1="0" x2={width} y1={h - 0.5} y2={h - 0.5} className="tr-glyph__track" />
      {w > 0 ? <path d={`M0 ${h - 1} L0 2.5 L${w} ${2.5 + lift} L${w} ${h - 1} Z`} className="tr-glyph__fill" /> : null}
    </svg>
  );
}

export interface PotentialTicksProps {
  /** 0..100 */
  value: number;
  className?: string;
}

/**
 * Automation potential as ten ruled ticks, like a gauge on an instrument. Ticks up to
 * the value are tall and inked; the partial tick is drawn to its exact share.
 */
export function PotentialTicks({ value, className }: PotentialTicksProps) {
  const n = 10;
  const gap = 5;
  const width = n * gap;
  const h = 12;
  const v = Math.max(0, Math.min(100, value)) / 10;
  return (
    <svg className={cx('tr-glyph', 'tr-ticks', className)} width={width} height={h} viewBox={`0 0 ${width} ${h}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const x = i * gap + 1.5;
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={h - 3} y2={h} className="tr-glyph__track" />
            {fill > 0 ? <line x1={x} x2={x} y1={h - fill * h} y2={h} className="tr-glyph__ink" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface ConfidenceMarksProps {
  level: ConfidenceLevel;
  /** Print the word next to the marks (default true). */
  showLabel?: boolean;
  className?: string;
}

const levelN: Record<ConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };
const levelWord: Record<ConfidenceLevel, string> = { low: 'low', medium: 'med', high: 'high' };

/** Three strokes of rising height; filled count = confidence. Always paired with a word. */
export function ConfidenceMarks({ level, showLabel = true, className }: ConfidenceMarksProps) {
  const n = levelN[level];
  return (
    <span className={cx('tr-conf', className)}>
      <svg className="tr-glyph" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
        {[0, 1, 2].map((i) => {
          const x = 2 + i * 5;
          const top = 8 - i * 3.5;
          return <line key={i} x1={x} x2={x} y1={top} y2={12} className={i < n ? 'tr-glyph__ink' : 'tr-glyph__track'} strokeWidth={2} />;
        })}
      </svg>
      {showLabel ? <span className="tr-conf__word tr-num">{levelWord[level]}</span> : <span className="tr-vh">{level} confidence</span>}
    </span>
  );
}

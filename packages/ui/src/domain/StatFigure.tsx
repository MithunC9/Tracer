'use client';
import { animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CalcStep } from '@tracer/schema';
import { cx, fmt, underlinePath } from '../lib.js';
import { motion as m, motionEase } from '../tokens.js';
import { Disclosure } from '../primitives/Disclosure.js';

/* ---------- Calculation table ---------- */

export interface CalcStepsProps {
  steps: readonly CalcStep[];
  /** Fixed decimals for values. Default: 0 for integers, 2 below 1, else 1. */
  decimals?: number;
  className?: string;
  caption?: ReactNode;
}

/**
 * "How we got this number": label, the expression as written, and the result. The last
 * step is the total and sits under a heavy rule, like a sum in a ledger.
 */
export function CalcSteps({ steps, decimals, className, caption }: CalcStepsProps) {
  return (
    <table className={cx('tr-calc', className)}>
      {caption ? <caption className="tr-calc__caption">{caption}</caption> : null}
      <thead className="tr-vh">
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Expression</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={i} data-total={i === steps.length - 1 && steps.length > 1 ? true : undefined}>
            <th scope="row" className="tr-calc__label">
              {s.label}
            </th>
            <td className="tr-calc__expr tr-num">{s.expression}</td>
            <td className="tr-calc__val tr-num">
              {fmt(s.value, decimals ?? (s.unit ? 1 : Number.isInteger(s.value) ? 0 : Math.abs(s.value) < 1 ? 2 : 1))}
              {s.unit ? <span className="tr-calc__unit"> {s.unit}</span> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------- StatFigure ---------- */

/**
 * Monospaced digits with the separators tucked in: at display size a mono "." or ","
 * takes a full digit width and opens a hole in the number.
 */
function Digits({ text }: { text: string }) {
  const parts = text.split(/([.,])/);
  return (
    <>
      {parts.map((p, i) =>
        p === '.' || p === ',' ? (
          <span key={i} className="tr-stat__sep">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  );
}

export interface StatFigureProps {
  value: number;
  decimals?: number;
  /** Printed after the number, smaller: "h / week". */
  unit?: ReactNode;
  /** Kicker above the figure. */
  label?: ReactNode;
  /** One or two plain sentences under it. */
  caption?: ReactNode;
  /** Rendered in a "Show calculation" disclosure. */
  calculation?: readonly CalcStep[];
  /** Count up from zero once, when first scrolled into view. Ignored under reduced motion. */
  countUp?: boolean;
  /** Hand-drawn vermilion underline. One per page: the hero number. */
  underline?: boolean;
  size?: 'hero' | 'large' | 'medium';
  /** Empty / not-yet-computed: prints an em dash and the caption. */
  pending?: boolean;
  className?: string;
}

/**
 * One huge mono number with its unit and a caption. Server-renders the final value;
 * the count-up only animates the visual copy (screen readers always get the final
 * value, once).
 */
export function StatFigure({
  value,
  decimals = 1,
  unit,
  label,
  caption,
  calculation,
  countUp = true,
  underline = false,
  size = 'hero',
  pending = false,
  className,
}: StatFigureProps) {
  const reduce = useReducedMotion();
  const final = fmt(value, decimals);
  const [shown, setShown] = useState(final);
  const [phase, setPhase] = useState<'pending' | 'running' | 'done'>(countUp && !pending ? 'pending' : 'done');
  const ref = useRef<HTMLDivElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!countUp || pending) return;
    if (reduce) {
      setShown(final);
      setPhase('done');
      return;
    }
    if (ran.current) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setPhase('done');
      return;
    }
    let stop: (() => void) | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || ran.current) return;
        ran.current = true;
        io.disconnect();
        setPhase('running');
        setShown(fmt(0, decimals));
        const controls = animate(0, value, {
          duration: m.duration.count / 1000,
          ease: motionEase.out,
          onUpdate: (v) => setShown(fmt(v, decimals)),
          onComplete: () => {
            setShown(final);
            setPhase('done');
          },
        });
        stop = () => controls.stop();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [countUp, pending, reduce, value, decimals, final]);

  const drawUnderline = underline && !pending;
  return (
    <figure className={cx('tr-stat', className)} data-size={size} data-count={phase} ref={ref}>
      {label ? <figcaption className="tr-kicker tr-stat__label">{label}</figcaption> : null}
      <p className="tr-stat__line">
        <span className="tr-stat__figure">
          {pending ? (
            <span className="tr-stat__value tr-num" aria-label="Not computed yet">
              —
            </span>
          ) : (
            <>
              <span className="tr-vh">
                {final}
                {typeof unit === 'string' ? ` ${unit}` : ''}
              </span>
              <span className="tr-stat__value tr-num" aria-hidden="true">
                <Digits text={shown} />
              </span>
            </>
          )}
          {drawUnderline ? (
            <svg className="tr-stat__underline" viewBox="0 0 200 10" aria-hidden="true">
              <motion.path
                d={underlinePath(200)}
                fill="none"
                initial={false}
                animate={{ pathLength: phase === 'pending' && !reduce ? 0 : phase === 'running' ? 0.15 : 1 }}
                transition={reduce ? { duration: 0 } : { duration: m.duration.draw / 1000, ease: motionEase.inOut }}
              />
            </svg>
          ) : null}
        </span>
        {unit ? (
          <span className="tr-stat__unit" aria-hidden={typeof unit === 'string' ? true : undefined}>
            {unit}
          </span>
        ) : null}
      </p>
      {caption ? <div className="tr-stat__caption">{caption}</div> : null}
      {calculation && calculation.length > 0 && !pending ? (
        <Disclosure label="Show calculation" openLabel="Hide calculation" className="tr-stat__calc">
          <CalcSteps steps={calculation} />
        </Disclosure>
      ) : null}
    </figure>
  );
}

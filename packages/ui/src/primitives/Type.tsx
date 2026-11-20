import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib.js';

/* ---------- Kicker / eyebrow ---------- */

export interface KickerProps extends HTMLAttributes<HTMLElement> {
  /** Optional leading number, e.g. "01". Rendered mono. */
  number?: string;
  /** Vermilion number. Reserve for the top finding. */
  signal?: boolean;
  as?: ElementType;
}

/** Small mono uppercase line above a heading. "FINDING 01", "METHOD", "DAY 3 OF 7". */
export function Kicker({ number, signal, as: Comp = 'p', className, children, ...rest }: KickerProps) {
  return (
    <Comp className={cx('tr-kicker', className)} data-signal={signal || undefined} {...rest}>
      {children}
      {number ? <span className="tr-kicker__num">{number}</span> : null}
    </Comp>
  );
}

/* ---------- Headings ---------- */

export type HeadingSize = 'display1' | 'display2' | 'display3' | 'title' | 'label';

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Visual size, independent of the outline level. */
  size?: HeadingSize;
}

const defaultSize: Record<number, HeadingSize> = { 1: 'display1', 2: 'display2', 3: 'display3', 4: 'title', 5: 'label', 6: 'label' };

export function Heading({ level, size, className, children, ...rest }: HeadingProps) {
  const Tag = `h${level}` as 'h1';
  return (
    <Tag className={cx('tr-heading', className)} data-size={size ?? defaultSize[level]} {...rest}>
      {children}
    </Tag>
  );
}

export function Lede({ className, ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cx('tr-lede', className)} {...rest} />;
}

/** Body copy with the reading measure applied. */
export function Prose({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('tr-prose', className)} {...rest} />;
}

/** Mono, tabular figure. Use for every number in running text. */
export function Num({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx('tr-num', className)} {...rest} />;
}

/* ---------- Rule ---------- */

export interface RuleProps extends HTMLAttributes<HTMLElement> {
  weight?: 'hair' | 'thin' | 'heavy' | 'double';
  tone?: 'rule' | 'ink';
  /** A label set into the rule, left-aligned, like a section mark in a notebook. */
  label?: ReactNode;
  /** Slightly uneven, hand-ruled stroke. */
  hand?: boolean;
}

export function Rule({ weight = 'hair', tone = 'rule', label, hand, className, ...rest }: RuleProps) {
  if (label) {
    return (
      <div role="separator" className={cx('tr-rule-labelled', className)} data-weight={weight} data-tone={tone} {...rest}>
        <span className="tr-rule-labelled__text">{label}</span>
        <span className="tr-rule-labelled__line" aria-hidden="true" />
      </div>
    );
  }
  return <hr className={cx('tr-rule', className)} data-weight={weight} data-tone={tone} data-hand={hand || undefined} {...rest} />;
}

/* ---------- Tag ---------- */

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  /** plain: bracketed text. outline: hairline box. ink: inverse. signal: vermilion outline (risk, warnings). */
  tone?: 'plain' | 'outline' | 'ink' | 'signal';
}

/** A small label. Not a pill: square, mono, bracketed or hairline-boxed. */
export function Tag({ tone = 'outline', className, children, ...rest }: TagProps) {
  return (
    <span className={cx('tr-tag', className)} data-tone={tone} {...rest}>
      {children}
    </span>
  );
}

/* ---------- Kbd ---------- */

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cx('tr-kbd', className)} {...rest} />;
}

/* ---------- Margin note + footnotes ---------- */

export interface MarginNoteProps extends HTMLAttributes<HTMLElement> {
  /** Footnote-style marker that ties the note to a FootnoteRef in the main text. */
  marker?: number | string;
  label?: ReactNode;
}

/**
 * An annotation in the margin column (inside <Spread notes>). On narrow screens it
 * falls inline with a left rule. Use for methodology, caveats, definitions.
 */
export function MarginNote({ marker, label, className, children, ...rest }: MarginNoteProps) {
  return (
    <aside className={cx('tr-note', className)} {...rest}>
      {marker !== undefined || label ? (
        <p className="tr-note__head">
          {marker !== undefined ? <span className="tr-note__marker tr-num">{marker}</span> : null}
          {label ? <span className="tr-note__label">{label}</span> : null}
        </p>
      ) : null}
      <div className="tr-note__body">{children}</div>
    </aside>
  );
}

export interface FootnoteRefProps {
  n: number;
  /** Prefix for ids, so several footnote sets can live on one page. */
  scope?: string;
}

export function FootnoteRef({ n, scope = 'fn' }: FootnoteRefProps) {
  return (
    <sup className="tr-fnref">
      <a href={`#${scope}-${n}`} id={`${scope}ref-${n}`} aria-label={`Note ${n}`}>
        {n}
      </a>
    </sup>
  );
}

export interface FootnotesProps {
  items: ReadonlyArray<{ n: number; content: ReactNode }>;
  scope?: string;
  title?: ReactNode;
  className?: string;
}

export function Footnotes({ items, scope = 'fn', title = 'Notes', className }: FootnotesProps) {
  return (
    <section className={cx('tr-footnotes', className)} aria-label={typeof title === 'string' ? title : 'Notes'}>
      <p className="tr-kicker">{title}</p>
      <ol>
        {items.map((it) => (
          <li key={it.n} id={`${scope}-${it.n}`}>
            <span className="tr-footnotes__n tr-num">{it.n}</span>
            <span>
              {it.content}{' '}
              <a href={`#${scope}ref-${it.n}`} className="tr-footnotes__back" aria-label={`Back to note ${it.n} in text`}>
                ↑
              </a>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

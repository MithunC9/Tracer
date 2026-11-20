import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../lib.js';

export interface PageProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Draw the 12 column guides behind the content (the visible grid of a lab record). */
  guides?: boolean;
}

/** Page frame: max width, page margins, optional column guides. */
export function Page({ as: Comp = 'div', guides, className, children, ...rest }: PageProps) {
  return (
    <Comp className={cx('tr-page', className)} {...rest}>
      {guides ? <Guides /> : null}
      {children}
    </Comp>
  );
}

export function Guides() {
  return (
    <div className="tr-guides" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

export interface SpreadProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Margin column content: MarginNotes, small figures, definitions. */
  notes?: ReactNode;
  /** Main column spans 9 instead of 8. */
  wide?: boolean;
  as?: ElementType;
}

/**
 * The editorial spread: main text in columns 1-8, margin notes in 10-12, column 9 left
 * as air. Below 64rem the notes follow the main text.
 */
export function Spread({ notes, wide, as: Comp = 'div', className, children, ...rest }: SpreadProps) {
  return (
    <Comp className={cx('tr-spread', className)} data-wide={wide || undefined} {...rest}>
      <div className="tr-spread__main">{children}</div>
      {notes ? <div className="tr-spread__notes">{notes}</div> : null}
    </Comp>
  );
}

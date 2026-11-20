import { forwardRef, type AnchorHTMLAttributes, type ElementType, type ReactNode } from 'react';
import { cx } from '../lib.js';

export interface TextLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Render through a router link (e.g. next/link). Receives href, className and children. */
  as?: ElementType;
  /** Adds a ↗ and opens safely in a new tab. */
  external?: boolean;
  /** Vermilion, for destructive actions phrased as links ("Delete everything"). */
  tone?: 'default' | 'quiet' | 'destructive';
  forceState?: 'hover' | 'focus';
  children: ReactNode;
}

export const TextLink = forwardRef<HTMLAnchorElement, TextLinkProps>(function TextLink(
  { as: Comp = 'a', external, tone = 'default', forceState, className, children, ...rest },
  ref,
) {
  const extra = external ? { target: '_blank', rel: rest.rel ?? 'noopener noreferrer' } : {};
  return (
    <Comp ref={ref} className={cx('tr-link', className)} data-tone={tone} data-force={forceState} {...extra} {...rest}>
      {children}
      {external ? (
        <>
          <span aria-hidden="true" className="tr-link__ext">
            ↗
          </span>
          <span className="tr-vh"> (opens in a new tab)</span>
        </>
      ) : null}
    </Comp>
  );
});

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../lib.js';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Shows a ruled progress line and sets aria-busy; the button is inert while loading. */
  loading?: boolean;
  /** Text shown to screen readers while loading. */
  loadingLabel?: string;
  /** A typographic glyph after the label, e.g. "→". Decorative. */
  trailing?: ReactNode;
  /** Design-page only: render the hover/focus/active look statically. */
  forceState?: 'hover' | 'focus' | 'active';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, loadingLabel = 'Working', trailing, forceState, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('tr-btn', className)}
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      data-force={forceState}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <span className="tr-btn__label">{children}</span>
      {trailing ? (
        <span className="tr-btn__trail" aria-hidden="true">
          {trailing}
        </span>
      ) : null}
      {loading ? (
        <>
          <span className="tr-btn__progress" aria-hidden="true" />
          <span className="tr-vh" role="status">
            {loadingLabel}
          </span>
        </>
      ) : null}
    </button>
  );
});

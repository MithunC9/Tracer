'use client';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useId, useState, type ReactNode } from 'react';
import { motionEase, motion as m } from '../tokens.js';
import { cx } from '../lib.js';

export interface CollapseProps {
  open: boolean;
  id?: string;
  children: ReactNode;
  className?: string;
  /** Extra props for the region (role, aria-label). */
  role?: string;
  'aria-labelledby'?: string;
}

/** Height-animating region. Instant under prefers-reduced-motion. Content unmounts when closed. */
export function Collapse({ open, id, children, className, ...aria }: CollapseProps) {
  const reduce = useReducedMotion();
  const t = reduce ? { duration: 0 } : { duration: m.duration.slow / 1000, ease: motionEase.out };
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="c"
          id={id}
          className={cx('tr-collapse', className)}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={t}
          style={{ overflow: 'hidden' }}
          {...aria}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export interface DisclosureProps {
  /** Trigger text when closed / open. */
  label: ReactNode;
  openLabel?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** A quiet "+ Show calculation" toggle that smoothly reveals a region below it. */
export function Disclosure({ label, openLabel, children, defaultOpen = false, open: openProp, onOpenChange, className }: DisclosureProps) {
  const id = useId();
  const [inner, setInner] = useState(defaultOpen);
  const open = openProp ?? inner;
  return (
    <div className={cx('tr-disclosure', className)} data-open={open || undefined}>
      <button
        type="button"
        className="tr-disclosure__btn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          if (openProp === undefined) setInner(!open);
          onOpenChange?.(!open);
        }}
      >
        <span className="tr-disclosure__sign tr-num" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
        <span>{open && openLabel ? openLabel : label}</span>
      </button>
      <Collapse open={open} id={id}>
        <div className="tr-disclosure__body">{children}</div>
      </Collapse>
    </div>
  );
}

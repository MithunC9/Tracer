'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib.js';
import { Button } from './Button.js';

/* ---------- Skeleton: ruled lines being drawn ---------- */

export interface RuledSkeletonProps {
  /** Number of ruled lines. */
  lines?: number;
  /** What is loading, read out to screen readers and shown as a kicker. */
  label?: string;
  /** Show the label visibly. */
  showLabel?: boolean;
  /** Relative widths 0..1 for each line; cycles if shorter than `lines`. */
  widths?: number[];
  className?: string;
}

/**
 * Loading placeholder that looks like a page being ruled: hairlines draw left to right
 * one after another. Static lines under reduced motion.
 */
export function RuledSkeleton({ lines = 5, label = 'Loading', showLabel = true, widths = [1, 0.92, 0.97, 0.64, 0.88, 0.4], className }: RuledSkeletonProps) {
  return (
    <div className={cx('tr-skel', className)} role="status" aria-live="polite" aria-busy="true">
      {showLabel ? (
        <p className="tr-kicker tr-skel__label">
          {label}
          <span className="tr-skel__dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      ) : (
        <span className="tr-vh">{label}</span>
      )}
      <div className="tr-skel__lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="tr-skel__line" style={{ ['--w' as string]: String(widths[i % widths.length]), ['--i' as string]: String(i) }} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Empty / Error ---------- */

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Small mono line above the title. */
  kicker?: ReactNode;
  className?: string;
}

/** An empty page in the notebook: blank ruled lines, a plain sentence, maybe one action. */
export function EmptyState({ title, children, action, kicker = 'Nothing yet', className }: EmptyStateProps) {
  return (
    <section className={cx('tr-empty', className)}>
      <div className="tr-empty__ruling" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="tr-kicker">{kicker}</p>
      <h3 className="tr-heading" data-size="title">
        {title}
      </h3>
      {children ? <div className="tr-empty__body">{children}</div> : null}
      {action ? <div className="tr-empty__action">{action}</div> : null}
    </section>
  );
}

export interface ErrorStateProps {
  title: ReactNode;
  children?: ReactNode;
  /** Short machine code, shown mono. */
  code?: string;
  /** Request id for support, shown mono and selectable. */
  requestId?: string;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  className?: string;
}

export function ErrorState({ title, children, code, requestId, onRetry, retryLabel = 'Try again', retrying, className }: ErrorStateProps) {
  return (
    <section className={cx('tr-error', className)} role="alert">
      <p className="tr-kicker tr-error__kicker">
        Error{code ? <span className="tr-num"> · {code}</span> : null}
      </p>
      <h3 className="tr-heading" data-size="title">
        {title}
      </h3>
      {children ? <div className="tr-error__body">{children}</div> : null}
      {(onRetry || requestId) && (
        <div className="tr-error__foot">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
              {retryLabel}
            </Button>
          ) : null}
          {requestId ? (
            <p className="tr-error__req">
              Request <span className="tr-num">{requestId}</span>
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ---------- Notice (inline) ---------- */

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const toneWord: Record<NoticeTone, string> = { info: 'Note', success: 'Done', warning: 'Check', error: 'Error' };

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  onDismiss?: () => void;
  action?: ReactNode;
  className?: string;
}

/**
 * Inline notice. A left rule and a mono status word carry the tone; color is never the
 * only signal. Errors use the text-safe vermilion.
 */
export function Notice({ tone = 'info', title, children, onDismiss, action, className }: NoticeProps) {
  return (
    <div className={cx('tr-notice', className)} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="tr-notice__word tr-num">{toneWord[tone]}</p>
      <div className="tr-notice__text">
        {title ? <p className="tr-notice__title">{title}</p> : null}
        <div className="tr-notice__body">{children}</div>
        {action ? <div className="tr-notice__action">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="tr-notice__x" onClick={onDismiss} aria-label="Dismiss">
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

/* ---------- Toasts ---------- */

interface ToastItem {
  id: number;
  tone: NoticeTone;
  title?: ReactNode;
  body: ReactNode;
  /** ms; 0 = sticky */
  duration: number;
}

interface ToastApi {
  push: (t: { tone?: NoticeTone; title?: ReactNode; body: ReactNode; duration?: number }) => number;
  dismiss: (id: number) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

function ToastView({ t, onDone }: { t: ToastItem; onDone: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(t.duration);
  const startedAt = useRef(0);
  useEffect(() => {
    if (!t.duration || paused) return;
    startedAt.current = Date.now();
    const h = setTimeout(onDone, left.current);
    return () => {
      clearTimeout(h);
      left.current -= Date.now() - startedAt.current;
    };
  }, [paused, t.duration, onDone]);
  return (
    <li
      className="tr-toast"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Notice tone={t.tone} title={t.title} onDismiss={onDone}>
        {t.body}
      </Notice>
    </li>
  );
}

/** Polite live region, bottom-left. Toasts pause while hovered or focused. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback<ToastApi['push']>((t) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { id, tone: t.tone ?? 'info', title: t.title, body: t.body, duration: t.duration ?? 6000 }]);
    return id;
  }, []);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ol className="tr-toasts" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <ToastView key={t.id} t={t} onDone={() => dismiss(t.id)} />
        ))}
      </ol>
    </ToastCtx.Provider>
  );
}

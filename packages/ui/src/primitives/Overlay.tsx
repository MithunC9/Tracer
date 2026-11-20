'use client';
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cx } from '../lib.js';
import { Button } from './Button.js';
import { TextField } from './Field.js';

/* ---------- Tooltip ---------- */

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link). Gets aria-describedby. */
  children: ReactElement<Record<string, unknown>>;
  side?: 'top' | 'bottom';
  /** Design-page only: render open. */
  defaultOpen?: boolean;
}

/**
 * Short supplementary text on hover AND keyboard focus; Escape dismisses. Never put
 * the only copy of information in a tooltip.
 */
export function Tooltip({ content, children, side = 'top', defaultOpen = false }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  if (!isValidElement(children)) return null;
  const trigger = cloneElement(children, {
    'aria-describedby': id,
    onFocus: () => setOpen(true),
    onBlur: hide,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    },
  });
  return (
    <span className="tr-tip" onPointerEnter={show} onPointerLeave={hide}>
      {trigger}
      <span role="tooltip" id={id} className="tr-tip__bubble" data-side={side} data-open={open || undefined}>
        {content}
      </span>
    </span>
  );
}

/* ---------- Popover ---------- */

export interface PopoverProps {
  /** Text of the trigger button. */
  label: ReactNode;
  /** Accessible title of the panel. */
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  align?: 'start' | 'end';
  triggerVariant?: 'secondary' | 'quiet';
}

/**
 * A click-to-open panel (non-modal). Focus moves into the panel; Escape or clicking
 * outside closes it and returns focus to the trigger.
 */
export function Popover({ label, title, children, defaultOpen = false, align = 'start', triggerVariant = 'quiet' }: PopoverProps) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);
  return (
    <span className="tr-pop" ref={root}>
      <Button
        ref={btn}
        variant={triggerVariant}
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        trailing={open ? '−' : '+'}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) requestAnimationFrame(() => panel.current?.focus());
        }}
      >
        {label}
      </Button>
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        hidden={!open}
        className="tr-pop__panel"
        data-align={align}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close(true);
          }
        }}
      >
        <p className="tr-kicker">{title}</p>
        <div className="tr-pop__body">{children}</div>
      </div>
    </span>
  );
}

/* ---------- Dialog ---------- */

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons row. */
  actions?: ReactNode;
  tone?: 'default' | 'destructive';
  /** Render in-flow instead of as a modal (design page / screenshots). */
  inline?: boolean;
  className?: string;
}

/**
 * Modal built on <dialog>: the browser handles focus containment, Escape and the
 * inert background. Focus returns to whatever opened it.
 */
export function Dialog({ open, onClose, title, description, children, actions, tone = 'default', inline, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d || inline) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [open, inline]);
  const body = (
    <>
      <div className="tr-dialog__head">
        <h2 id={titleId} className="tr-heading" data-size="display3">
          {title}
        </h2>
      </div>
      {description ? (
        <div id={descId} className="tr-dialog__desc">
          {description}
        </div>
      ) : null}
      {children ? <div className="tr-dialog__body">{children}</div> : null}
      {actions ? <div className="tr-dialog__actions">{actions}</div> : null}
    </>
  );
  if (inline) {
    return (
      <div role="dialog" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} className={cx('tr-dialog', 'tr-dialog--inline', className)} data-tone={tone}>
        {body}
      </div>
    );
  }
  return (
    <dialog
      ref={ref}
      className={cx('tr-dialog', className)}
      data-tone={tone}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? body : null}
    </dialog>
  );
}

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** What is being deleted, e.g. "all audit data". */
  subject: string;
  /** The word the reader must type. Default "delete". */
  confirmWord?: string;
  /** Plain list of what goes. */
  consequences?: ReactNode;
  pending?: boolean;
  error?: ReactNode;
  inline?: boolean;
}

/** The one destructive confirm. Type-to-confirm; the action is vermilion. */
export function ConfirmDeleteDialog({ open, onClose, onConfirm, subject, confirmWord = 'delete', consequences, pending, error, inline }: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const ok = typed.trim().toLowerCase() === confirmWord;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      inline={inline}
      tone="destructive"
      title={`Delete ${subject}?`}
      description={<p>This cannot be undone. You will get a signed receipt listing what was removed.</p>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Keep my data
          </Button>
          <Button variant="destructive" disabled={!ok} loading={pending} loadingLabel="Deleting" onClick={onConfirm}>
            Delete permanently
          </Button>
        </>
      }
    >
      {consequences ? <div className="tr-dialog__list">{consequences}</div> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !pending) onConfirm();
        }}
      >
        <TextField
          label={
            <>
              Type <span className="tr-num">{confirmWord}</span> to confirm
            </>
          }
          mono
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          error={error}
        />
      </form>
    </Dialog>
  );
}

'use client';
import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '../lib.js';

interface FieldFrameProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
  hintId: string;
  errorId: string;
}

function FieldFrame({ id, label, hint, error, optional, className, children, hintId, errorId }: FieldFrameProps) {
  return (
    <div className={cx('tr-field', className)} data-invalid={error ? true : undefined}>
      <label className="tr-field__label" htmlFor={id}>
        {label}
        {optional ? <span className="tr-field__optional">optional</span> : null}
      </label>
      {children}
      {hint ? (
        <p className="tr-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="tr-field__error" id={errorId}>
          <span aria-hidden="true">↳ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(hint: unknown, error: unknown, hintId: string, errorId: string, extra?: string) {
  return [extra, hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  /** Mono input for codes, numbers, tokens. */
  mono?: boolean;
  forceState?: 'hover' | 'focus';
  fieldClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, optional, mono, forceState, id: idProp, className, fieldClassName, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? `f${auto}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} className={fieldClassName} hintId={hintId} errorId={errorId}>
      <input
        ref={ref}
        id={id}
        className={cx('tr-input', mono && 'tr-num', className)}
        data-force={forceState}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, error, hintId, errorId, rest['aria-describedby'])}
        {...rest}
      />
    </FieldFrame>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  fieldClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, optional, id: idProp, className, fieldClassName, rows = 4, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? `f${auto}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} className={fieldClassName} hintId={hintId} errorId={errorId}>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        className={cx('tr-input', 'tr-textarea', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint, error, hintId, errorId)}
        {...rest}
      />
    </FieldFrame>
  );
});

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  optional?: boolean;
  options: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>;
  forceState?: 'hover' | 'focus';
  fieldClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, optional, options, forceState, id: idProp, className, fieldClassName, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? `f${auto}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <FieldFrame id={id} label={label} hint={hint} error={error} optional={optional} className={fieldClassName} hintId={hintId} errorId={errorId}>
      <span className="tr-select">
        <select
          ref={ref}
          id={id}
          className={cx('tr-input', 'tr-select__control', className)}
          data-force={forceState}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint, error, hintId, errorId)}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <svg className="tr-select__chev" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true">
          <path d="M1 1.5 L6 6.5 L11 1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      </span>
    </FieldFrame>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  forceState?: 'hover' | 'focus';
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, forceState, id: idProp, className, ...rest },
  ref,
) {
  const auto = useId();
  const id = idProp ?? `c${auto}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className={cx('tr-check', className)} data-invalid={error ? true : undefined} data-disabled={rest.disabled || undefined}>
      <span className="tr-check__box">
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="tr-check__input"
          data-force={forceState}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint, error, hintId, errorId)}
          {...rest}
        />
        <svg className="tr-check__mark" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.2 8.6 L6.6 11.8 L12.9 3.9" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="square" />
        </svg>
      </span>
      <span className="tr-check__text">
        <label htmlFor={id} className="tr-check__label">
          {label}
        </label>
        {hint ? (
          <span className="tr-field__hint" id={hintId}>
            {hint}
          </span>
        ) : null}
        {error ? (
          <span className="tr-field__error" id={errorId}>
            <span aria-hidden="true">↳ </span>
            {error}
          </span>
        ) : null}
      </span>
    </div>
  );
});

export interface ToggleProps {
  label: ReactNode;
  hint?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  /** Words for the two states, shown beside the switch. */
  onLabel?: string;
  offLabel?: string;
  id?: string;
  forceState?: 'hover' | 'focus';
  className?: string;
}

/** A switch (role="switch"). Use for settings that apply immediately, like pausing capture. */
export function Toggle({ label, hint, checked, defaultChecked = false, onChange, disabled, onLabel = 'On', offLabel = 'Off', id: idProp, forceState, className }: ToggleProps) {
  const auto = useId();
  const id = idProp ?? `t${auto}`;
  const [inner, setInner] = useState(defaultChecked);
  const on = checked ?? inner;
  return (
    <div className={cx('tr-toggle', className)} data-disabled={disabled || undefined}>
      <span className="tr-toggle__text">
        <span className="tr-toggle__label" id={`${id}-label`}>
          {label}
        </span>
        {hint ? (
          <span className="tr-field__hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        data-force={forceState}
        className="tr-toggle__switch"
        onClick={() => {
          const next = !on;
          if (checked === undefined) setInner(next);
          onChange?.(next);
        }}
      >
        <span className="tr-toggle__track" aria-hidden="true">
          <span className="tr-toggle__knob" />
        </span>
        <span className="tr-toggle__state tr-num" aria-hidden="true">
          {on ? onLabel : offLabel}
        </span>
      </button>
    </div>
  );
}

'use client';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib.js';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Small mono count after the label, e.g. number of findings. */
  count?: number;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  /** Accessible name of the tab list. */
  label: string;
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
  className?: string;
}

/**
 * WAI-ARIA tabs with automatic activation. Left/Right move, Home/End jump, Tab goes
 * into the panel. The selected tab sits on a 2px ink rule; others on a hairline.
 */
export function Tabs({ items, label, value, defaultValue, onChange, className }: TabsProps) {
  const base = useId();
  const [inner, setInner] = useState(defaultValue ?? items[0]?.id);
  const current = value ?? inner;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const select = (id: string) => {
    if (value === undefined) setInner(id);
    onChange?.(id);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const pos = enabled.indexOf(i);
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = enabled[(pos + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(pos - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next === undefined) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    select(item.id);
    refs.current[next]?.focus();
  };

  return (
    <div className={cx('tr-tabs', className)}>
      <div role="tablist" aria-label={label} className="tr-tabs__list">
        {items.map((it, i) => {
          const sel = it.id === current;
          return (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${it.id}`}
              aria-selected={sel}
              aria-controls={`${base}-panel-${it.id}`}
              tabIndex={sel ? 0 : -1}
              disabled={it.disabled}
              className="tr-tabs__tab"
              onClick={() => select(it.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {it.label}
              {it.count !== undefined ? <span className="tr-tabs__count tr-num">{it.count}</span> : null}
            </button>
          );
        })}
      </div>
      {items.map((it) => (
        <div
          key={it.id}
          role="tabpanel"
          id={`${base}-panel-${it.id}`}
          aria-labelledby={`${base}-tab-${it.id}`}
          hidden={it.id !== current}
          tabIndex={0}
          className="tr-tabs__panel"
        >
          {it.id === current ? it.content : null}
        </div>
      ))}
    </div>
  );
}

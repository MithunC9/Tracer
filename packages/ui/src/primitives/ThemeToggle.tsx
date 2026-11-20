'use client';
import { useEffect, useId, useState } from 'react';
import { cx } from '../lib.js';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'tracer-theme';

/**
 * Inline this in <head> (before paint) to apply the stored theme without a flash,
 * and to mark the document as JS-enabled (used by count-up to avoid a flash of the
 * final number before it animates).
 */
export const themeInitScript = `(function(){try{var d=document.documentElement;d.classList.add('js');var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){d.setAttribute('data-theme',t);}}catch(e){}})();`;

export function applyTheme(choice: ThemeChoice) {
  const d = document.documentElement;
  if (choice === 'system') d.removeAttribute('data-theme');
  else d.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    /* storage blocked: the choice still applies for this page view */
  }
}

function readTheme(): ThemeChoice {
  if (typeof document === 'undefined') return 'system';
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

const OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'light', label: 'Paper' },
  { value: 'dark', label: 'Kraft' },
  { value: 'system', label: 'Auto' },
];

/** Three-way radio group: Paper (light) / Kraft (dark) / Auto (follow OS). */
export function ThemeToggle({ className }: { className?: string }) {
  const name = useId();
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => setChoice(readTheme()), []);
  return (
    <fieldset className={cx('tr-theme', className)}>
      <legend className="tr-vh">Colour theme</legend>
      {OPTIONS.map((o) => (
        <label key={o.value} className="tr-theme__opt" data-checked={choice === o.value || undefined}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={choice === o.value}
            onChange={() => {
              setChoice(o.value);
              applyTheme(o.value);
            }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Tracer design tokens. Single source of truth.
 *
 * `scripts/tokens.mjs` generates `src/styles/tokens.css` (CSS custom properties)
 * and the contrast table in `TOKENS.md` from this file. Do not hand-edit the CSS.
 *
 * This file must stay dependency-free and use only erasable TS syntax: it is
 * also loaded directly by Node (type stripping) from the scripts.
 */

export const color = {
  light: {
    /** Page background. Warm paper. */
    paper: '#F4F1EA',
    /** One step down from paper: table header band, hover wash, code wells. */
    paperSunk: '#EBE6DB',
    /** Raised sheet (receipt, dialog). Slightly lighter than paper. */
    paperRaised: '#FAF8F3',
    /** Primary text and marks. */
    ink: '#14130F',
    /** Secondary text, captions, axis labels. Muted neutral 1. */
    graphite: '#5C564B',
    /** Faded hairline rule. Decorative separators only, never text. Muted neutral 2. */
    rule: '#CDC4B2',
    /** The signal. Marks, underlines, the top finding. Not for body-size text. */
    signal: '#E8431E',
    /** Text-safe vermilion (links in destructive copy, error text, destructive button fill). */
    signalInk: '#B5330F',
    /** Text placed on a signalInk fill. */
    onSignal: '#F4F1EA',
  },
  dark: {
    /** Kraft: warm brown-black paper. */
    paper: '#1B1611',
    paperSunk: '#241D16',
    paperRaised: '#211B15',
    /** Cream ink. */
    ink: '#EDE5D3',
    graphite: '#A79C88',
    rule: '#4A4035',
    signal: '#F0552F',
    signalInk: '#FF6E47',
    onSignal: '#1B1611',
  },
  /** Print is always ink on white, whatever the screen theme. */
  print: {
    paper: '#FFFFFF',
    paperSunk: '#F3F3F1',
    paperRaised: '#FFFFFF',
    ink: '#000000',
    graphite: '#4A4740',
    rule: '#BDBAB2',
    signal: '#D63A15',
    signalInk: '#A82E0C',
    onSignal: '#FFFFFF',
  },
} as const;

export type ColorMode = keyof typeof color;
export type ColorToken = keyof typeof color.light;

/**
 * Text/background pairs that ship in the UI. The contrast script checks each one
 * in every mode. `min` is the WCAG AA threshold for that use.
 */
export const contrastPairs: ReadonlyArray<{ fg: ColorToken; bg: ColorToken; use: string; min: number }> = [
  { fg: 'ink', bg: 'paper', use: 'body text', min: 4.5 },
  { fg: 'ink', bg: 'paperSunk', use: 'text on table header / hover', min: 4.5 },
  { fg: 'ink', bg: 'paperRaised', use: 'text on receipt / dialog', min: 4.5 },
  { fg: 'graphite', bg: 'paper', use: 'secondary text, captions', min: 4.5 },
  { fg: 'graphite', bg: 'paperSunk', use: 'secondary text on sunk band', min: 4.5 },
  { fg: 'graphite', bg: 'paperRaised', use: 'secondary text on receipt', min: 4.5 },
  { fg: 'signalInk', bg: 'paper', use: 'error text, destructive link', min: 4.5 },
  { fg: 'signalInk', bg: 'paperSunk', use: 'error text on sunk band', min: 4.5 },
  { fg: 'onSignal', bg: 'signalInk', use: 'destructive button label', min: 4.5 },
  { fg: 'paper', bg: 'ink', use: 'primary button label (inverse)', min: 4.5 },
  { fg: 'signal', bg: 'paper', use: 'large numerals, marks, focus ring (non-text 3:1)', min: 3 },
  { fg: 'graphite', bg: 'paper', use: 'input / checkbox boundary (non-text 3:1)', min: 3 },
  { fg: 'rule', bg: 'paper', use: 'decorative hairline (exempt; listed for reference)', min: 0 },
];

export const font = {
  /** Display: headlines, finding titles. Loaded via next/font as --font-instrument-serif. */
  display: 'var(--font-instrument-serif), "Instrument Serif", "Iowan Old Style", Georgia, serif',
  /** UI text. */
  sans: 'var(--font-geist), "Geist", ui-sans-serif, system-ui, sans-serif',
  /** Every number and every piece of data. Always tabular. */
  mono: 'var(--font-geist-mono), "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace',
} as const;

/** Type scale. [size, line-height, letter-spacing]. Display sizes are fluid. */
export const type = {
  hero: ['clamp(6rem, 3.5rem + 9vw, 11rem)', '0.86', '-0.045em'],
  display1: ['clamp(3rem, 2rem + 5vw, 6.5rem)', '0.92', '-0.02em'],
  display2: ['clamp(2.25rem, 1.6rem + 2.8vw, 4rem)', '0.98', '-0.015em'],
  display3: ['clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem)', '1.04', '-0.01em'],
  title: ['1.375rem', '1.2', '-0.01em'],
  lede: ['1.1875rem', '1.45', '-0.005em'],
  body: ['1rem', '1.55', '0'],
  small: ['0.875rem', '1.45', '0'],
  micro: ['0.75rem', '1.35', '0.01em'],
  /** Kicker / eyebrow: mono, uppercase, tracked. */
  kicker: ['0.6875rem', '1.2', '0.12em'],
} as const;

/** 4px base. Keys are steps, not pixels. */
export const space = {
  0: '0',
  px: '1px',
  0.5: '0.125rem',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
} as const;

/** Rules replace boxes. Hairline is 0.5px on 2x screens, 1px otherwise. */
export const rule = {
  hair: '0.5px',
  thin: '1px',
  heavy: '2px',
  /** Newspaper double rule: two 1px lines, 2px apart. */
  double: '3px',
} as const;

/** 12-column editorial grid with a margin-notes track. */
export const grid = {
  columns: 12,
  maxWidth: '88rem',
  gutter: 'clamp(1rem, 0.5rem + 1.5vw, 2rem)',
  pageMargin: 'clamp(1rem, 0.25rem + 3vw, 4rem)',
  /** Main text column spans cols 1-8, notes cols 10-12 (col 9 is air). */
  main: '1 / span 8',
  notes: '10 / span 3',
  measure: '38rem',
} as const;

export const motion = {
  duration: {
    instant: 0,
    quick: 120,
    base: 220,
    slow: 420,
    draw: 900,
    count: 1400,
  },
  easing: {
    /** Settles like a pen lifting off paper. */
    out: 'cubic-bezier(0.2, 0.7, 0.1, 1)',
    inOut: 'cubic-bezier(0.6, 0, 0.2, 1)',
    linear: 'linear',
  },
  /** Page-load stagger between sibling blocks, ms. */
  stagger: 60,
} as const;

/** Same easing as arrays, for the Motion library. */
export const motionEase = {
  out: [0.2, 0.7, 0.1, 1] as [number, number, number, number],
  inOut: [0.6, 0, 0.2, 1] as [number, number, number, number],
};

export const z = {
  base: 0,
  raised: 1,
  sticky: 10,
  popover: 30,
  dialog: 40,
  toast: 50,
} as const;

export const radius = {
  /** Almost everything is square. 2px only for the focus ring corners and kbd caps. */
  none: '0',
  hint: '2px',
} as const;

export const tokens = { color, font, type, space, rule, grid, motion, z, radius } as const;
export type Tokens = typeof tokens;

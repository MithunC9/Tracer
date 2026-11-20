# @tracer/ui

Design tokens, primitives and report components for Tracer. React 19, TypeScript, ESM.
The look is a lab record crossed with a newspaper data desk: warm paper, ink, hairline
rules, mono numbers, one vermilion mark. See it all at `/design` and a full sample
report at `/design/report` in `apps/web`.

## Principles

1. **Rules, not boxes.** Structure comes from hairlines and a few heavy rules. No drop
   shadows, no rounded cards, no icon-on-top tiles.
2. **One signal.** Vermilion marks the one thing that matters on a view: the top
   finding, the hero number's underline, a destructive action, an error. If two things
   are vermilion, one of them is wrong.
3. **Numbers are data.** Every number is Geist Mono, tabular, computed by code. Prose
   never invents a number.
4. **Margins carry method.** Caveats, definitions and "how we counted" go in margin
   notes, so the main column stays plain.
5. **Plain words.** Short sentences, specific, a little dry. Empty, loading and error
   states get the same care as the happy path.
6. **Quiet motion.** A page-load stagger, one count-up, smooth expands. Nothing else
   moves. All of it is off under `prefers-reduced-motion`.
7. **Every chart has a table.** Glyphs and strips are drawn by hand in SVG; the numbers
   are always printed beside them or available as a table.

## Install and use

```css
/* app/globals.css (Tailwind v4) */
@import 'tailwindcss';
@import '@tracer/ui/theme.css';  /* Tailwind preset: bg-paper, text-ink, font-display ... */
@import '@tracer/ui/styles.css'; /* tokens + component styles + print */
```

Without Tailwind, import only `@tracer/ui/styles.css`.

```tsx
// app/layout.tsx
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { themeInitScript } from '@tracer/ui';

const display = Instrument_Serif({ subsets: ['latin'], weight: '400', style: ['normal', 'italic'], variable: '--font-instrument-serif' });
const sans = Geist({ subsets: ['latin'], variable: '--font-geist' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

<html className={`${display.variable} ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
  <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
```

The font variable names are a contract: the tokens read `--font-instrument-serif`,
`--font-geist` and `--font-geist-mono`. `themeInitScript` applies a stored theme before
paint and adds `html.js` (the count-up uses it to avoid flashing the final number).

```tsx
import { LedgerTable, StatFigure, FindingSection, ledgerRowsFromReport } from '@tracer/ui';
import { sampleReport } from '@tracer/ui/fixtures'; // design and tests only

<StatFigure value={report.summary.reclaimableHoursPerWeek} unit="h / week" label="Reclaimable time" underline calculation={report.summary.calculation} />
<LedgerTable rows={ledgerRowsFromReport(report)} caption="Repeated workflows, ranked" highlightId={report.summary.topFindingId} sortable />
```

The package is built with `tsc` to `dist/` (turbo builds it before the web app).
Interactive components carry `'use client'`; the rest render on the server.
Theme: `data-theme="light" | "dark"` on `<html>` or on any subtree (used for the
side-by-side panels on `/design`); no attribute follows the OS.

## Tokens

`src/tokens.ts` is the source; `src/styles/tokens.css` is generated from it
(`node scripts/tokens.mjs`). Colour, type scale, spacing, rules, grid, motion and z-layers
are documented with the computed WCAG contrast table in [TOKENS.md](./TOKENS.md).
`node scripts/contrast.mjs` re-checks every text/background pair in light, dark and print.

## Components

Layout: `Page` (max width, optional column `Guides`), `Spread` (main columns 1-8, margin notes 10-12).

Primitives:

| Component | Notes |
|---|---|
| `Button` | `primary` (ink), `secondary` (hairline), `quiet` (underlined text), `destructive` (vermilion, vermilion focus ring). `loading` draws a ruled progress line and sets `aria-busy`. `trailing` for a typographic glyph. |
| `TextLink` | `as` for router links, `external` adds ↗ and safe `rel`, `tone="destructive"`. |
| `TextField`, `TextArea`, `Select`, `Checkbox`, `Toggle` | Label above, hint and error below, wired with `aria-describedby` / `aria-invalid`. `Toggle` is `role="switch"`. |
| `Tag` | Square mono label: `outline`, `plain` (bracketed), `ink`, `signal`. Never a pill, never an icon. |
| `Rule` | `hair` / `thin` / `heavy` / `double`, `hand` (hand-ruled), or with a `label`. |
| `Kicker`, `Heading`, `Lede`, `Prose`, `Num` | Heading `level` and visual `size` are independent. |
| `MarginNote`, `FootnoteRef`, `Footnotes` | Notes sit in the margin on wide screens and fall inline with a left rule on narrow ones. |
| `Tooltip`, `Popover` | Tooltip on hover and focus, Escape closes. Popover moves focus in and returns it. |
| `Dialog`, `ConfirmDeleteDialog` | Native `<dialog>` (focus containment, Escape, inert page). Delete requires typing the confirm word. `inline` renders in flow for docs. |
| `Tabs` | WAI-ARIA tabs; ← → Home End. |
| `Disclosure`, `Collapse` | Smooth height reveal, instant under reduced motion. |
| `RuledSkeleton`, `EmptyState`, `ErrorState`, `Notice`, `ToastProvider` / `useToast`, `Kbd` | Loading is a page being ruled. Notices carry a status word, not just colour. |
| `ThemeToggle`, `themeInitScript`, `applyTheme` | Paper / Kraft / Auto. |
| `Stagger`, `StaggerItem` | Page-load stagger (60ms), off under reduced motion. |

Report components (data shapes come from `@tracer/schema`):

| Component | Renders |
|---|---|
| `StatFigure` | One huge mono number, unit, caption, hand-drawn vermilion underline, count-up once on first view; "Show calculation" renders `CalcStep[]` via `CalcSteps`. Server-renders the final value; screen readers always get it. |
| `LedgerTable` | Ranked workflows: rank, label (+ path), hours/week with `HoursBar`, automatable with `PotentialTicks`, `ConfidenceMarks`. One tab stop; ↑ ↓ Home End move, Enter/Space or → ← expand. Optional sortable headers (`aria-sort`). Loading, empty, error states. |
| `WeekStrip` | Days × time-of-day strip, one tick per `Occurrence`, width = duration; weekends shaded; per-row totals; hover readout; "Show as table" fallback. 1-14 days. |
| `PathTrail` | App → app itinerary with action verbs. `compact` for ledger rows. |
| `ScoreBreakdown` | The five inputs as instrument scales with weights; the formula written out with real numbers using the schema's `automationPotential`. |
| `RecipeSteps` | Prerequisites, numbered steps, "Keep a human for". |
| `ToolOptions` | DIY "Build it yourself with this recipe" first and at equal weight; ranked tools with fit score and signed reasons; affiliate links labelled "We may earn a commission" with `rel="sponsored"`. |
| `FindingSection`, `FindingCard`, `FindingMetrics` | "Finding 01" entries; section prints on its own page. |
| `CountdownBadge`, `ProgressRule` | "Day 3 of 7"; capture progress with day ticks. |
| `PrivacyLedger`, `AccessLogTable`, `DeletionReceipt` | Recorded vs never recorded; access log with empty/loading/error; a printable deletion certificate. |
| `ledgerRowsFromReport`, `weekRowsFromReport` | Adapters from `AuditReport`. |

Components respond to the width of their column (container queries), not the viewport,
so the same ledger works in a full page, a half column or a dialog.

## Do / don't

| Do | Don't |
|---|---|
| One vermilion thing per view, with a reason | Vermilion for decoration, categories or "brand" |
| Hairline rules and whitespace for structure | Cards with shadows, rounded corners, an icon on top |
| Geist Mono for every number | Numbers in the serif or in proportional sans |
| Instrument Serif for headlines only | Serif body text or serif buttons |
| A margin note for method and caveats | Tooltips holding information that exists nowhere else |
| Print the number beside every glyph | Colour or shape as the only carrier of a value |
| Plain, specific copy: "Upload failed. Retrying in 5 minutes." | "Oops!", "supercharge", "unlock", "seamless", emoji |
| `ErrorState` that says what is safe and what to do | A red box with a stack trace |
| Gradients: none. Glass: none. Blobs: none. | Sparkles, magic wands, robots, brains, chat bubbles |
| Respect `prefers-reduced-motion` | Motion that loops or plays on every scroll |

## Development

```sh
pnpm --filter @tracer/ui build        # tsc -> dist
pnpm --filter @tracer/ui test         # vitest + testing-library (fixtures, tokens, a11y behaviour)
node packages/ui/scripts/tokens.mjs   # regenerate tokens.css after editing tokens.ts
node packages/ui/scripts/contrast.mjs # contrast table; --write updates TOKENS.md
# screenshots (needs `pnpm --filter @tracer/web build && pnpm --filter @tracer/web start` and a global playwright)
node packages/ui/scripts/screenshots.mjs http://localhost:3000
```

Screenshots of `/design` and `/design/report` at 390, 768 and 1440px in light and dark
live in `screenshots/`.

# Tracer tokens

Source of truth: `src/tokens.ts`. Generated from it:

- `src/styles/tokens.css`: CSS custom properties (`--tr-*`), light on `:root`, dark under
  `prefers-color-scheme: dark` (unless `data-theme="light"`) and on any `[data-theme="dark"]`
  subtree, print (ink on white) under `@media print`. Regenerate with `node scripts/tokens.mjs`.
  A test fails if the CSS is stale.
- `src/styles/theme.css`: Tailwind v4 `@theme inline` preset mapping utilities to the variables.

## Colour

| Token | CSS var | Tailwind | Paper (light) | Kraft (dark) | Print | Use |
|---|---|---|---|---|---|---|
| paper | `--tr-paper` | `bg-paper` | #F4F1EA | #1B1611 | #FFFFFF | Page |
| paperSunk | `--tr-paper-sunk` | `bg-paper-sunk` | #EBE6DB | #241D16 | #F3F3F1 | Table header band, hover wash, formula well |
| paperRaised | `--tr-paper-raised` | `bg-paper-raised` | #FAF8F3 | #211B15 | #FFFFFF | Inputs, dialog, receipt |
| ink | `--tr-ink` | `text-ink` | #14130F | #EDE5D3 | #000000 | Text, marks, primary button |
| graphite | `--tr-graphite` | `text-graphite` | #5C564B | #A79C88 | #4A4740 | Secondary text, captions, axis labels, field borders |
| rule | `--tr-rule` | `border-rule` | #CDC4B2 | #4A4035 | #BDBAB2 | Hairline separators only. Never text, never a control boundary |
| signal | `--tr-signal` | `bg-signal` | #E8431E | #F0552F | #D63A15 | The one mark that matters: top finding, hero underline, destructive focus ring |
| signalInk | `--tr-signal-ink` | `text-signal-ink` | #B5330F | #FF6E47 | #A82E0C | Text-safe vermilion: error text, destructive button fill |
| onSignal | `--tr-on-signal` | `text-on-signal` | #F4F1EA | #1B1611 | #FFFFFF | Label on a signalInk fill |

Vermilion appears at most once per meaning per view. `signal` (#E8431E) is 3.54:1 on paper,
which passes for large numerals and non-text marks only; any vermilion text uses `signalInk`.

## Contrast (WCAG 2.x, computed)

Computed by `node scripts/contrast.mjs` from `src/tokens.ts` (`--write` refreshes this table).
The test suite runs the same check and fails on any pair below its threshold.

<!-- contrast:start -->
| Mode | Foreground | Background | Ratio | Needs | Result | Use |
|---|---|---|---:|---:|---|---|
| light | `ink` #14130F | `paper` #F4F1EA | 16.48:1 | 4.5:1 | pass | body text |
| light | `ink` #14130F | `paperSunk` #EBE6DB | 14.94:1 | 4.5:1 | pass | text on table header / hover |
| light | `ink` #14130F | `paperRaised` #FAF8F3 | 17.51:1 | 4.5:1 | pass | text on receipt / dialog |
| light | `graphite` #5C564B | `paper` #F4F1EA | 6.45:1 | 4.5:1 | pass | secondary text, captions |
| light | `graphite` #5C564B | `paperSunk` #EBE6DB | 5.84:1 | 4.5:1 | pass | secondary text on sunk band |
| light | `graphite` #5C564B | `paperRaised` #FAF8F3 | 6.85:1 | 4.5:1 | pass | secondary text on receipt |
| light | `signalInk` #B5330F | `paper` #F4F1EA | 5.40:1 | 4.5:1 | pass | error text, destructive link |
| light | `signalInk` #B5330F | `paperSunk` #EBE6DB | 4.90:1 | 4.5:1 | pass | error text on sunk band |
| light | `onSignal` #F4F1EA | `signalInk` #B5330F | 5.40:1 | 4.5:1 | pass | destructive button label |
| light | `paper` #F4F1EA | `ink` #14130F | 16.48:1 | 4.5:1 | pass | primary button label (inverse) |
| light | `signal` #E8431E | `paper` #F4F1EA | 3.54:1 | 3:1 | pass | large numerals, marks, focus ring (non-text 3:1) |
| light | `graphite` #5C564B | `paper` #F4F1EA | 6.45:1 | 3:1 | pass | input / checkbox boundary (non-text 3:1) |
| light | `rule` #CDC4B2 | `paper` #F4F1EA | 1.53:1 | exempt | n/a | decorative hairline (exempt; listed for reference) |
| dark | `ink` #EDE5D3 | `paper` #1B1611 | 14.32:1 | 4.5:1 | pass | body text |
| dark | `ink` #EDE5D3 | `paperSunk` #241D16 | 13.27:1 | 4.5:1 | pass | text on table header / hover |
| dark | `ink` #EDE5D3 | `paperRaised` #211B15 | 13.59:1 | 4.5:1 | pass | text on receipt / dialog |
| dark | `graphite` #A79C88 | `paper` #1B1611 | 6.63:1 | 4.5:1 | pass | secondary text, captions |
| dark | `graphite` #A79C88 | `paperSunk` #241D16 | 6.14:1 | 4.5:1 | pass | secondary text on sunk band |
| dark | `graphite` #A79C88 | `paperRaised` #211B15 | 6.29:1 | 4.5:1 | pass | secondary text on receipt |
| dark | `signalInk` #FF6E47 | `paper` #1B1611 | 6.48:1 | 4.5:1 | pass | error text, destructive link |
| dark | `signalInk` #FF6E47 | `paperSunk` #241D16 | 6.00:1 | 4.5:1 | pass | error text on sunk band |
| dark | `onSignal` #1B1611 | `signalInk` #FF6E47 | 6.48:1 | 4.5:1 | pass | destructive button label |
| dark | `paper` #1B1611 | `ink` #EDE5D3 | 14.32:1 | 4.5:1 | pass | primary button label (inverse) |
| dark | `signal` #F0552F | `paper` #1B1611 | 5.17:1 | 3:1 | pass | large numerals, marks, focus ring (non-text 3:1) |
| dark | `graphite` #A79C88 | `paper` #1B1611 | 6.63:1 | 3:1 | pass | input / checkbox boundary (non-text 3:1) |
| dark | `rule` #4A4035 | `paper` #1B1611 | 1.78:1 | exempt | n/a | decorative hairline (exempt; listed for reference) |
| print | `ink` #000000 | `paper` #FFFFFF | 21.00:1 | 4.5:1 | pass | body text |
| print | `ink` #000000 | `paperSunk` #F3F3F1 | 18.90:1 | 4.5:1 | pass | text on table header / hover |
| print | `ink` #000000 | `paperRaised` #FFFFFF | 21.00:1 | 4.5:1 | pass | text on receipt / dialog |
| print | `graphite` #4A4740 | `paper` #FFFFFF | 9.27:1 | 4.5:1 | pass | secondary text, captions |
| print | `graphite` #4A4740 | `paperSunk` #F3F3F1 | 8.34:1 | 4.5:1 | pass | secondary text on sunk band |
| print | `graphite` #4A4740 | `paperRaised` #FFFFFF | 9.27:1 | 4.5:1 | pass | secondary text on receipt |
| print | `signalInk` #A82E0C | `paper` #FFFFFF | 6.86:1 | 4.5:1 | pass | error text, destructive link |
| print | `signalInk` #A82E0C | `paperSunk` #F3F3F1 | 6.17:1 | 4.5:1 | pass | error text on sunk band |
| print | `onSignal` #FFFFFF | `signalInk` #A82E0C | 6.86:1 | 4.5:1 | pass | destructive button label |
| print | `paper` #FFFFFF | `ink` #000000 | 21.00:1 | 4.5:1 | pass | primary button label (inverse) |
| print | `signal` #D63A15 | `paper` #FFFFFF | 4.69:1 | 3:1 | pass | large numerals, marks, focus ring (non-text 3:1) |
| print | `graphite` #4A4740 | `paper` #FFFFFF | 9.27:1 | 3:1 | pass | input / checkbox boundary (non-text 3:1) |
| print | `rule` #BDBAB2 | `paper` #FFFFFF | 1.94:1 | exempt | n/a | decorative hairline (exempt; listed for reference) |
<!-- contrast:end -->

## Type

| Token | Size | Leading | Tracking | Face |
|---|---|---|---|---|
| hero | clamp(6rem, 3.5rem + 9vw, 11rem) | 0.86 | -0.045em | Geist Mono (the hero number) |
| display1 | clamp(3rem, 2rem + 5vw, 6.5rem) | 0.92 | -0.02em | Instrument Serif |
| display2 | clamp(2.25rem, 1.6rem + 2.8vw, 4rem) | 0.98 | -0.015em | Instrument Serif |
| display3 | clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem) | 1.04 | -0.01em | Instrument Serif |
| title | 1.375rem | 1.2 | -0.01em | Instrument Serif |
| lede | 1.1875rem | 1.45 | -0.005em | Geist |
| body | 1rem | 1.55 | 0 | Geist |
| small | 0.875rem | 1.45 | 0 | Geist |
| micro | 0.75rem | 1.35 | 0.01em | Geist |
| kicker | 0.6875rem | 1.2 | 0.12em, uppercase | Geist Mono |

Every number is Geist Mono with `tabular-nums slashed-zero` (class `tr-num` or `<Num>`).

## Space, rules, grid, motion, layers

- Space: 4px base (`--tr-space-1` = 0.25rem … `--tr-space-32` = 8rem). Tailwind's default spacing is also 4px based.
- Rules: hair 0.5px, thin 1px, heavy 2px, double 3px. Tables open with a 2px ink rule, rows are hairlines in `rule`.
- Grid: 12 columns, max 88rem, gutter clamp(1rem, 0.5rem + 1.5vw, 2rem). Main text in columns 1-8, margin notes in 10-12, column 9 is air (`<Spread>`).
- Motion: quick 120ms, base 220ms, slow 420ms, draw 900ms, count 1400ms; ease-out `cubic-bezier(0.2, 0.7, 0.1, 1)`; stagger 60ms. All of it is off under `prefers-reduced-motion`.
- Z: base 0, raised 1, sticky 10, popover 30, dialog 40, toast 50.

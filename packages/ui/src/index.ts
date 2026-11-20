// @tracer/ui — tokens, primitives and report components.
// Styles: import '@tracer/ui/styles.css' once (and '@tracer/ui/theme.css' in a Tailwind v4 entry).

export * from './tokens.js';
export { cx, fmt, fmtInt, fmtMinutes, fmtDate, fmtDateTime, fmtDay, fmtTime, appName, pad2, ruledPath, underlinePath } from './lib.js';

// layout
export * from './layout/Layout.js';

// primitives
export * from './primitives/Button.js';
export * from './primitives/TextLink.js';
export * from './primitives/Field.js';
export * from './primitives/Type.js';
export * from './primitives/Overlay.js';
export * from './primitives/Tabs.js';
export * from './primitives/Feedback.js';
export * from './primitives/Disclosure.js';
export * from './primitives/ThemeToggle.js';
export * from './primitives/Stagger.js';

// domain
export * from './domain/glyphs.js';
export * from './domain/StatFigure.js';
export * from './domain/LedgerTable.js';
export * from './domain/WeekStrip.js';
export * from './domain/PathTrail.js';
export * from './domain/ScoreBreakdown.js';
export * from './domain/RecipeSteps.js';
export * from './domain/ToolOptions.js';
export * from './domain/Finding.js';
export * from './domain/Capture.js';
export * from './domain/Privacy.js';
export * from './domain/adapters.js';

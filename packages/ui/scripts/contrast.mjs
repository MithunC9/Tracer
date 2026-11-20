#!/usr/bin/env node
// Checks every shipped text/background pair in light, dark and print modes against WCAG AA.
// Usage: node scripts/contrast.mjs [--write]   (--write refreshes the table in TOKENS.md)
// Exit code 1 if any pair fails.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { color, contrastPairs } from '../src/tokens.ts';
import { contrastMarkdown, contrastRows } from './contrast-lib.mjs';

const rows = contrastRows(color, contrastPairs);
const md = contrastMarkdown(rows);
console.log(md);

if (process.argv.includes('--write')) {
  const file = fileURLToPath(new URL('../TOKENS.md', import.meta.url));
  const src = readFileSync(file, 'utf8');
  const start = '<!-- contrast:start -->';
  const end = '<!-- contrast:end -->';
  const next = src.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${md}\n${end}`);
  writeFileSync(file, next);
  console.log('\nwrote TOKENS.md');
}

const failed = rows.filter((r) => r.min > 0 && !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} pair(s) below WCAG AA`);
  process.exit(1);
}
console.log(`\nall ${rows.filter((r) => r.min > 0).length} checked pairs pass WCAG AA`);

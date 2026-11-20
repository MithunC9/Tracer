#!/usr/bin/env node
/**
 * Validate one or more AuditReport JSON files. Exits 1 if any fails, 2 on usage/IO errors.
 *   tracer-validate-report report.json [more.json ...] [--json]
 */
import { readFileSync } from 'node:fs';
import { validateReport } from '../src/validate.js';

function main(argv: string[]): number {
  const asJson = argv.includes('--json');
  const files = argv.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    process.stderr.write('usage: validate-report <report.json> [...] [--json]\n');
    return 2;
  }
  let failed = false;
  const results: Record<string, unknown> = {};
  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      process.stderr.write(`${file}: cannot read JSON: ${e instanceof Error ? e.message : String(e)}\n`);
      return 2;
    }
    const r = validateReport(data);
    results[file] = r;
    if (!r.passed) failed = true;
    if (!asJson) {
      const head = r.passed ? 'PASS' : 'FAIL';
      process.stdout.write(`${head} ${file} (${r.checkedNumbers} numbers checked, ${r.errors.length} errors, ${r.warnings.length} warnings)\n`);
      for (const e of r.errors) process.stdout.write(`  error   ${e.location}: ${e.reason} [${e.value}]\n`);
      for (const w of r.warnings) process.stdout.write(`  warning ${w.location}: ${w.reason} [${w.value}]\n`);
    }
  }
  if (asJson) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  return failed ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));

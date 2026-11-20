/**
 * Build gate for numbers: `pnpm verify:reports` (root).
 *
 * Runs the full analysis pipeline with the production deps (catalog ranking + recipes, LLM
 * narration with LLM_PROVIDER, default mock; number validator) on every fixture persona and
 * validates each report with `@tracer/llm`'s validator: the same function the API's publish
 * stage asserts and the `tracer-validate-report` CLI wraps. Exits 1 on any failure.
 *
 *   pnpm verify:reports [--personas a,b] [--write <dir>]   (--write saves each report as JSON)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InMemoryStageStore, runPipeline } from '@tracer/analysis';
import { createLlmClient, validateReport } from '@tracer/llm';
import { ActivityEvent, AuditReport, DEFAULT_CONSTRAINTS, DEFAULT_EXCLUSIONS, GroundTruth } from '@tracer/schema';
import { createRealDeps } from '../pipeline/analysis-engine.js';
import { fixturesDir } from './fixtures.js';

const args = process.argv.slice(2);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const only = opt('--personas')?.split(',');
const writeDir = opt('--write');
const dir = fixturesDir();

const personas = readdirSync(dir)
  .filter((p) => existsSync(join(dir, p, 'events.json')) && existsSync(join(dir, p, 'ground-truth.json')))
  .filter((p) => !only || only.includes(p))
  .sort();
if (!personas.length) {
  console.error(`no fixture personas under ${dir} (run \`pnpm --filter @tracer/fixtures build\`)`);
  process.exit(1);
}

let failed = 0;
for (const persona of personas) {
  const events = (JSON.parse(readFileSync(join(dir, persona, 'events.json'), 'utf8')) as unknown[]).map((e) => ActivityEvent.parse(e));
  const gt = GroundTruth.parse(JSON.parse(readFileSync(join(dir, persona, 'ground-truth.json'), 'utf8')));
  const llm = createLlmClient();
  const store = new InMemoryStageStore();
  const t0 = performance.now();
  let line: string;
  try {
    const { report } = await runPipeline(
      events,
      {
        auditId: '00000000-0000-4000-8000-000000000001',
        startsAt: gt.startsAt,
        daysPlanned: gt.days,
        excludedApps: DEFAULT_EXCLUSIONS.apps.length,
        excludedDomains: DEFAULT_EXCLUSIONS.domains.length,
        generatedAt: new Date().toISOString(),
        constraints: DEFAULT_CONSTRAINTS,
      },
      createRealDeps(llm),
      store,
    );
    AuditReport.parse(report);
    const v = validateReport(report);
    // The pipeline swaps LLM prose for template prose when the first validation fails; the gate
    // treats that as a failure too (it means generated prose carried an untraceable number).
    const validateOut = [...store.outputs.entries()].find(([k]) => k.startsWith('validate:'))?.[1] as
      | { usedTemplate: boolean; result: { errors: unknown[] } }
      | undefined;
    const usedTemplate = validateOut?.usedTemplate ?? false;
    if (writeDir) {
      mkdirSync(writeDir, { recursive: true });
      writeFileSync(join(writeDir, `${persona}.report.json`), JSON.stringify(report, null, 2));
    }
    if (!v.passed || !report.generation.validator.passed || usedTemplate) failed++;
    line = `${v.passed && !usedTemplate ? 'PASS' : 'FAIL'}  ${persona.padEnd(12)} findings=${report.findings.length} reclaimable=${report.summary.reclaimableHoursPerWeek}h/wk numbersChecked=${v.checkedNumbers} provider=${report.generation.provider}${usedTemplate ? ' (first validation failed; LLM prose replaced by template)' : ''} ${Math.round(performance.now() - t0)}ms`;
    for (const e of v.errors.slice(0, 20)) line += `\n      ${e.location}: ${e.reason} (${e.value})`;
  } catch (err) {
    failed++;
    line = `FAIL  ${persona.padEnd(12)} ${err instanceof Error ? err.message : String(err)}`;
  }
  console.log(line);
}
console.log(failed ? `\n${failed} report(s) failed validation` : `\nall ${personas.length} reports validate`);
process.exit(failed ? 1 : 0);

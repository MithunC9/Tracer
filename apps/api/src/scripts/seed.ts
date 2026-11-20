/**
 * Dev seed (`pnpm seed`, also run by `pnpm dev`): the demo user and one COMPLETED audit whose
 * report comes from the real pipeline, ingested the real way.
 *
 *   email:    demo@tracer.local
 *   password: tracer-demo-password   (dev only; README.md, apps/api/SECURITY.md)
 *
 * 1. Signs up (or logs in) over HTTP.
 * 2. Creates an audit backdated to the fixture persona's week (shifted so it ends today; audits
 *    may start up to 14 days back).
 * 3. Pairs a simulated device and uploads the persona with `tracer-sim --time-shift-to-now`
 *    (the real agent core: exclusions, redaction, encrypted buffer, uploader). Without the
 *    binary, posts the fixture's redacted events.json to the same ingest endpoint instead.
 * 4. Finishes the audit and waits for the pipeline (sessionize ... publish, with the
 *    validator gate) to publish the report.
 *
 * Env: SEED_PERSONA (default bookkeeper), SEED_VIA (sim | http; default sim when the binary
 * exists), SEED_API_URL (use a running API; default: an in-process API on a random port with
 * job workers), TRACER_SIM_BIN. Idempotent: does nothing when a completed audit with a report exists.
 */
import { loadConfig } from '../config/config.js';
import { createContainer } from '../container.js';
import { buildApp } from '../http/app.js';
import { createLogger } from '../observability/logger.js';
import { apiSession, createCompletedAudit, DEMO_EMAIL, DEMO_PASSWORD, OPEN_STATUSES, simBinary, waitForAudit, type UploadVia } from './demo.js';
import { loadFixture } from './fixtures.js';

export { DEMO_EMAIL, DEMO_PASSWORD };

const say = (m: string) => process.stdout.write(`[seed] ${m}\n`);

async function startInProcess() {
  const config = loadConfig({ ...process.env, JOBS_ENABLED: 'true', LOG_LEVEL: process.env.SEED_LOG_LEVEL ?? 'warn' });
  const c = createContainer(config, createLogger(config.LOG_LEVEL));
  await c.startJobs();
  const app = await buildApp(c);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await app.close();
      await c.close();
    },
  };
}

const persona = process.env.SEED_PERSONA ?? 'bookkeeper';
const server = process.env.SEED_API_URL ? { baseUrl: process.env.SEED_API_URL.replace(/\/$/, ''), close: async () => {} } : await startInProcess();
let exitCode = 0;
try {
  const session = await apiSession(server.baseUrl, DEMO_EMAIL, DEMO_PASSWORD, { signup: true, displayName: 'Demo' });
  const { client } = session;
  let { items } = await client.call('listAudits');

  const busy = items.find((a) => a.status === 'analyzing');
  if (busy) {
    say(`audit ${busy.id} is analyzing; waiting`);
    await waitForAudit(client, busy.id, ['complete', 'failed']);
    ({ items } = await client.call('listAudits'));
  }
  for (const a of items.filter((x) => x.status === 'failed')) {
    say(`audit ${a.id} failed earlier; re-running its pipeline`);
    await client.call('rerunPipeline', { params: { id: a.id } });
    await waitForAudit(client, a.id, ['complete']);
  }
  ({ items } = await client.call('listAudits'));

  // A report from the old placeholder engine (provider "none") does not count as seeded.
  let done = null;
  for (const a of items.filter((x) => x.status === 'complete' && x.reportAvailable)) {
    const rep = await client.call('getReport', { params: { id: a.id } });
    if (rep.generation.provider !== 'none') {
      done = a;
      break;
    }
  }
  if (done) {
    say(`${DEMO_EMAIL} already has a completed audit (${done.id}); nothing to do`);
  } else {
    // Only one audit can be open at a time: close a leftover live audit so the backdated one fits.
    const open = items.find((a) => OPEN_STATUSES.includes(a.status));
    if (open) {
      say(`finishing open audit ${open.id} first (one open audit per user)`);
      await client.call('finishAudit', { params: { id: open.id } });
      await waitForAudit(client, open.id, ['complete', 'cancelled']);
    }
    const fixture = loadFixture(persona);
    const want = process.env.SEED_VIA as UploadVia | undefined;
    const bin = simBinary();
    let via: UploadVia = want ?? (bin ? 'sim' : 'http');
    if (via === 'sim' && !bin) throw new Error('SEED_VIA=sim but tracer-sim is not built (cargo build --release --manifest-path apps/agent/core/Cargo.toml)');
    if (via === 'sim' && !(await import('node:fs')).existsSync(fixture.rawPath)) {
      say(`${fixture.rawPath} missing (run \`pnpm --filter @tracer/fixtures build\`); falling back to HTTP upload of events.json`);
      via = 'http';
    }
    if (via === 'http' && !want) say('tracer-sim not built; uploading the fixture events over HTTP instead (same ingest endpoint)');
    const t0 = Date.now();
    const r = await createCompletedAudit({ baseUrl: server.baseUrl, session, fixture, via, log: say });
    say(
      `seeded ${DEMO_EMAIL}: audit ${r.audit.id} (${persona}, via ${via}) complete in ${Math.round((Date.now() - t0) / 1000)}s: ` +
        `${r.report.findings.length} findings, ${r.report.summary.reclaimableHoursPerWeek} h/week reclaimable, ${r.report.window.eventsAnalyzed} events, validator ${r.report.generation.validator.passed ? 'passed' : 'FAILED'}`,
    );
  }
} catch (err) {
  process.stderr.write(`[seed] failed: ${err instanceof Error ? err.message : String(err)}\n`);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);

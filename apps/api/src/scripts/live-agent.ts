/**
 * The live half of the demo (`pnpm dev` starts it after the API is ready): a second simulated
 * device for the demo user, replaying a fixture persona in (accelerated) real time into the
 * currently capturing audit, so the Live Status screen shows events arriving.
 *
 *   - logs in as the demo user; resumes a paused audit, or creates a 7-day audit starting now
 *   - pairs a device once (token kept in .tracer/live-device-token, re-paired if revoked)
 *   - runs `tracer-sim --time-shift-to-now --speed $LIVE_SPEED --upload-interval $LIVE_UPLOAD_INTERVAL`
 *
 * Env: API_URL (default http://localhost:$API_PORT), LIVE_PERSONA (default founder),
 * LIVE_SPEED (default 60), LIVE_UPLOAD_INTERVAL seconds (default 10), TRACER_SIM_BIN.
 * Re-running starts the replay again (new event ids), so a restarted dev session adds a fresh
 * replay to the same live audit.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiSession, DEMO_EMAIL, DEMO_PASSWORD, OPEN_STATUSES, simBinary, sleep } from './demo.js';
import { loadFixture, repoRoot } from './fixtures.js';

const say = (m: string) => process.stdout.write(`${m}\n`);
const baseUrl = (process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`).replace(/\/$/, '');
const persona = process.env.LIVE_PERSONA ?? 'founder';
const speed = process.env.LIVE_SPEED ?? '60';
const uploadInterval = process.env.LIVE_UPLOAD_INTERVAL ?? '10';

const bin = simBinary();
if (!bin) {
  say('tracer-sim is not built; the live simulated agent is skipped (install Rust, then re-run pnpm dev)');
  process.exit(0);
}
const fixture = loadFixture(persona);
if (!existsSync(fixture.rawPath)) {
  say(`${fixture.rawPath} is missing; run \`pnpm --filter @tracer/fixtures build\``);
  process.exit(1);
}

for (let i = 0; ; i++) {
  try {
    const r = await fetch(`${baseUrl}/readyz`);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 120) {
    say(`API at ${baseUrl} did not become ready`);
    process.exit(1);
  }
  await sleep(1000);
}

const session = await apiSession(baseUrl, DEMO_EMAIL, DEMO_PASSWORD);
const { client } = session;
const { items } = await client.call('listAudits');
let audit = items.find((a) => OPEN_STATUSES.includes(a.status));
if (audit?.status === 'paused') audit = await client.call('resumeAudit', { params: { id: audit.id } });
if (!audit) audit = await client.call('createAudit', { body: { lengthDays: 7, recurrence: 'none' } });
say(`live audit ${audit.id} (${audit.status}, until ${audit.endsAt})`);

const dir = join(repoRoot(), '.tracer');
mkdirSync(dir, { recursive: true });
const tokenFile = join(dir, 'live-device-token');
let pairArgs: string[] = [];
let valid = false;
if (existsSync(tokenFile)) {
  const res = await fetch(`${baseUrl}/v1/agent/config`, { headers: { authorization: `Bearer ${readFileSync(tokenFile, 'utf8').trim()}` } });
  valid = res.ok;
}
if (!valid) {
  const code = await client.call('createPairingCode');
  pairArgs = ['--pair-code', code.code];
  say('pairing a new simulated device');
}

const args = [
  '--api', baseUrl,
  '--device-token-file', tokenFile,
  ...pairArgs,
  '--device-name', `Demo laptop (live ${persona} replay)`,
  '--raw', fixture.rawPath,
  '--time-shift-to-now',
  '--speed', speed,
  '--upload-interval', uploadInterval,
];
say(`replaying ${persona} at ${speed}x, uploading every ${uploadInterval}s`);
const child = spawn(bin, args, { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'info' } });
const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('close', (code) => {
  say(`tracer-sim exited (${code ?? 'signal'})`);
  process.exit(code ?? 0);
});

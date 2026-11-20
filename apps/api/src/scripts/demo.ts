/**
 * Shared by the seed, the live demo agent (`pnpm dev`) and the end-to-end test: everything goes
 * through the public HTTP API (typed client from @tracer/schema), the way a user and an agent would.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ApiClientError,
  createClient,
  LIMITS,
  type ActivityEvent,
  type ApiClient,
  type Audit,
  type AuditReport,
  type AuditStatus,
} from '@tracer/schema';
import { repoRoot, type Fixture } from './fixtures.js';

export const DEMO_EMAIL = 'demo@tracer.local';
/** Dev-only password, documented in README.md and apps/api/SECURITY.md. */
export const DEMO_PASSWORD = 'tracer-demo-password';
export const DAY_MS = 86_400_000;
export const OPEN_STATUSES: AuditStatus[] = ['scheduled', 'capturing', 'paused'];

export type Log = (msg: string) => void;

/** `tracer-sim` binary: TRACER_SIM_BIN, else the cargo release build in the repo, else null. */
export function simBinary(): string | null {
  const fromEnv = process.env.TRACER_SIM_BIN;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  const p = join(repoRoot(), 'apps', 'agent', 'core', 'target', 'release', process.platform === 'win32' ? 'tracer-sim.exe' : 'tracer-sim');
  return existsSync(p) ? p : null;
}

export interface ApiSession {
  client: ApiClient;
  accessToken: string;
  userId: string;
}

/** Log in; when the account does not exist and `signup` is set, create it. */
export async function apiSession(baseUrl: string, email: string, password: string, opts: { signup?: boolean; displayName?: string } = {}): Promise<ApiSession> {
  let token: string | null = null;
  const client = createClient({ baseUrl, getAccessToken: () => token });
  let session;
  try {
    session = await client.call('login', { body: { email, password } });
  } catch (err) {
    if (!(opts.signup && err instanceof ApiClientError && err.status === 401)) throw err;
    session = await client.call('signup', {
      body: { email, password, acceptSelfObservation: true, ...(opts.displayName ? { displayName: opts.displayName } : {}) },
    });
  }
  token = session.accessToken;
  return { client, accessToken: session.accessToken, userId: session.user.id };
}

/** Whole-day shift `tracer-sim --time-shift-to-now --speed 0` applies: the replay ends on/before now. */
export function backfillShiftDays(lastMs: number, nowMs: number): number {
  return Math.floor((nowMs - lastMs) / DAY_MS);
}

export function lastRawSampleMs(rawPath: string): number {
  let last = -Infinity;
  for (const line of readFileSync(rawPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const t = Date.parse((JSON.parse(line) as { t: string }).t);
    if (t > last) last = t;
  }
  return last;
}

export type UploadVia = 'sim' | 'http';

/**
 * A backdated window for replaying `fixture` so it ends today: the fixture's day boundaries
 * shifted by the same whole days the replay uses, long enough that the window is still open now.
 */
export function backdatedWindow(fixture: Fixture, via: UploadVia, now = Date.now()): { startsAt: string; lengthDays: number; shiftDays: number } {
  const last = via === 'sim' ? lastRawSampleMs(fixture.rawPath) : Math.max(...fixture.events.map((e) => Date.parse(e.ts)));
  const shiftDays = backfillShiftDays(last, now);
  const start = Date.parse(fixture.groundTruth.startsAt) + shiftDays * DAY_MS;
  const lengthDays = Math.min(LIMITS.maxAuditDays, Math.floor((now - start) / DAY_MS) + 1);
  return { startsAt: new Date(start).toISOString(), lengthDays, shiftDays };
}

export interface UploadResult {
  via: UploadVia;
  accepted: number;
  /** Raw tracer-sim JSON summary when via = sim. */
  simSummary?: unknown;
}

/** Runs tracer-sim to completion; resolves with its stdout JSON summary. */
export function runSim(bin: string, args: string[], log: Log, prefix = 'tracer-sim'): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? 'info' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
      for (const l of d.toString().split('\n')) if (l.trim()) log(`${prefix}: ${l.trim()}`);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tracer-sim exited with ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() ?? '{}'));
      } catch {
        resolve({ raw: out });
      }
    });
  });
}

/**
 * Pairs a new device for the session's user and uploads the whole fixture into the user's
 * open audit, either with the real agent core (`tracer-sim`: exclusions, redaction, encrypted
 * buffer, uploader) or, without cargo, by posting the fixture's already-redacted events.json
 * to the same ingest endpoint with a device token, shifted by `shiftDays`.
 */
export async function uploadFixture(o: {
  baseUrl: string;
  session: ApiSession;
  fixture: Fixture;
  via: UploadVia;
  shiftDays: number;
  deviceName: string;
  log: Log;
  simBin?: string | null;
}): Promise<UploadResult> {
  const code = await o.session.client.call('createPairingCode');
  if (o.via === 'sim') {
    const bin = o.simBin ?? simBinary();
    if (!bin) throw new Error('tracer-sim binary not found (cargo build --release --manifest-path apps/agent/core/Cargo.toml)');
    const summary = (await runSim(
      bin,
      ['--api', o.baseUrl, '--pair-code', code.code, '--device-name', o.deviceName, '--raw', o.fixture.rawPath, '--time-shift-to-now'],
      o.log,
    )) as { upload?: { accepted?: number } };
    return { via: 'sim', accepted: summary.upload?.accepted ?? 0, simSummary: summary };
  }
  const paired = await o.session.client.call('pairDevice', {
    body: { code: code.code, deviceName: o.deviceName, platform: 'simulated', agentVersion: 'fixture-http' },
  });
  const shift = o.shiftDays * DAY_MS;
  const events: ActivityEvent[] = o.fixture.events.map((e) => ({ ...e, ts: new Date(Date.parse(e.ts) + shift).toISOString() }));
  let accepted = 0;
  for (const batch of batches(events)) {
    const body = { batchId: randomUUID(), sentAt: new Date().toISOString(), agentVersion: 'fixture-http', platform: 'simulated' as const, events: batch };
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${o.baseUrl}/v1/agent/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${paired.deviceToken}` },
        body: JSON.stringify(body),
      });
      if (res.status === 429 && attempt < 20) {
        await sleep(1000 * Number(res.headers.get('retry-after') ?? 1));
        continue;
      }
      if (!res.ok) throw new Error(`ingest failed: ${res.status} ${await res.text()}`);
      const r = (await res.json()) as { accepted: number; rejected: unknown[] };
      accepted += r.accepted;
      if (r.rejected.length) o.log(`ingest rejected ${r.rejected.length} event(s): ${JSON.stringify(r.rejected.slice(0, 3))}`);
      break;
    }
  }
  o.log(`uploaded ${accepted} events over HTTP (fixture events.json, shifted ${o.shiftDays} days)`);
  return { via: 'http', accepted };
}

function* batches(events: ActivityEvent[]): Generator<ActivityEvent[]> {
  const maxBytes = LIMITS.maxBatchBytes - 64 * 1024;
  let cur: ActivityEvent[] = [];
  let bytes = 0;
  for (const e of events) {
    const n = JSON.stringify(e).length + 1;
    if (cur.length && (cur.length >= 500 || bytes + n > maxBytes)) {
      yield cur;
      cur = [];
      bytes = 0;
    }
    cur.push(e);
    bytes += n;
  }
  if (cur.length) yield cur;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls an audit until its status is one of `want`; throws on `failed` (unless wanted) or timeout. */
export async function waitForAudit(client: ApiClient, auditId: string, want: AuditStatus[], timeoutMs = 180_000): Promise<Audit> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const a = await client.call('getAudit', { params: { id: auditId } });
    if (want.includes(a.status)) return a;
    if (a.status === 'failed') {
      const run = await client.call('auditPipeline', { params: { id: auditId } });
      const bad = run?.stages.find((s) => s.error);
      throw new Error(`pipeline failed for audit ${auditId}${bad ? ` at ${bad.stage}: ${bad.error}` : ''}`);
    }
    if (Date.now() > until) throw new Error(`audit ${auditId} still ${a.status} after ${timeoutMs / 1000}s`);
    await sleep(500);
  }
}

/**
 * The demo's completed audit: a window backdated to the fixture's week (shifted to end today),
 * the persona uploaded by a newly paired simulated device, audit finished, pipeline awaited.
 */
export async function createCompletedAudit(o: {
  baseUrl: string;
  session: ApiSession;
  fixture: Fixture;
  via: UploadVia;
  log: Log;
  deviceName?: string;
  timeoutMs?: number;
}): Promise<{ audit: Audit; report: AuditReport; shiftDays: number; upload: UploadResult }> {
  const { client } = o.session;
  const win = backdatedWindow(o.fixture, o.via);
  const audit = await client.call('createAudit', { body: { lengthDays: win.lengthDays, startsAt: win.startsAt, recurrence: 'none' } });
  o.log(`audit ${audit.id}: ${win.lengthDays}-day window from ${win.startsAt} (fixture shifted ${win.shiftDays} days)`);
  const upload = await uploadFixture({
    baseUrl: o.baseUrl,
    session: o.session,
    fixture: o.fixture,
    via: o.via,
    shiftDays: win.shiftDays,
    deviceName: o.deviceName ?? `Demo ${o.fixture.persona} (simulated)`,
    log: o.log,
  });
  await client.call('finishAudit', { params: { id: audit.id } });
  o.log(`audit finished; waiting for the analysis pipeline`);
  const done = await waitForAudit(client, audit.id, ['complete'], o.timeoutMs);
  const report = await client.call('getReport', { params: { id: audit.id } });
  return { audit: done, report, shiftDays: win.shiftDays, upload };
}

/**
 * Share of planted workflows (ground truth, shifted by `shiftDays`) that some finding matches:
 * a finding matches the workflow holding >= 50% of its evidence time (the analysis eval rule,
 * computed from the report's evidence instead of pipeline internals).
 */
export function plantedRecall(report: AuditReport, fixture: Fixture, shiftDays: number): { recall: number; matched: string[]; missed: string[] } {
  const shift = shiftDays * DAY_MS;
  const wfs = fixture.groundTruth.workflows.map((w) => ({
    id: w.id,
    label: w.label,
    ivs: w.occurrences.map((x) => [Date.parse(x.start) + shift, Date.parse(x.end) + shift] as const),
  }));
  const matched = new Set<string>();
  for (const f of report.findings) {
    let total = 0;
    const per = new Map<string, number>();
    for (const ev of f.evidence) {
      const a = Date.parse(ev.start);
      const b = Date.parse(ev.end);
      total += b - a;
      for (const w of wfs) for (const [s, e] of w.ivs) per.set(w.id, (per.get(w.id) ?? 0) + Math.max(0, Math.min(b, e) - Math.max(a, s)));
    }
    const best = [...per.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best && total > 0 && best[1] / total >= 0.5) matched.add(best[0]);
  }
  return {
    recall: wfs.length ? matched.size / wfs.length : 1,
    matched: wfs.filter((w) => matched.has(w.id)).map((w) => w.label),
    missed: wfs.filter((w) => !matched.has(w.id)).map((w) => w.label),
  };
}

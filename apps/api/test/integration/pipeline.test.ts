import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditReport, PIPELINE_STAGES, PipelineRun } from '@tracer/schema';
import type { PipelineEngine } from '../../src/pipeline/engine.js';
import { stubEngine } from '../../src/pipeline/stub-engine.js';
import {
  batchOf,
  bearer,
  createAudit,
  createHarness,
  eventsFrom,
  ingest,
  pair,
  signup,
  type Harness,
} from '../helpers/harness.js';

/** Stub engine whose `cluster` stage fails until `healthy` is set; counts executions per stage. */
function controllableEngine() {
  const calls: Record<string, number> = {};
  const state = { failCluster: false };
  const engine: PipelineEngine = {
    version: 'test-1',
    async runStage(stage, input, ctx) {
      calls[stage] = (calls[stage] ?? 0) + 1;
      if (stage === 'cluster' && state.failCluster) throw new Error('cluster exploded');
      return stubEngine.runStage(stage, input, ctx);
    },
  };
  return { engine, calls, state };
}

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 40_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out; last value: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

let h: Harness;
const ctl = controllableEngine();

beforeAll(async () => {
  h = await createHarness({ jobs: 'boss', overrides: { engine: ctl.engine }, env: { AUTH_RATE_PER_MIN: '1000', JOB_RETRY_LIMIT: '2' } });
});
afterAll(() => h.close());

async function finishedAudit() {
  const u = await signup(h.app);
  const d = await pair(h.app, u.accessToken);
  const audit = await createAudit(h.app, u.accessToken, 1);
  await ingest(h.app, d.deviceToken, batchOf(eventsFrom(new Date(Date.parse(audit.startsAt) + 1000), 20, 5000)));
  const fin = await h.app.inject({ method: 'POST', url: `/v1/audits/${audit.id}/finish`, headers: bearer(u.accessToken) });
  expect(fin.statusCode).toBe(202);
  expect(fin.json().status).toBe('analyzing');
  return { u, auditId: audit.id };
}

const getRun = async (token: string, auditId: string) =>
  PipelineRun.nullable().parse((await h.app.inject({ method: 'GET', url: `/v1/audits/${auditId}/pipeline`, headers: bearer(token) })).json());

describe('pipeline on pg-boss', () => {
  it('runs every stage as a job, stores an encrypted, valid report and completes the audit', async () => {
    const { u, auditId } = await finishedAudit();
    const run = await until(() => getRun(u.accessToken, auditId), (r) => r?.state === 'succeeded');
    expect(run!.stages.map((s) => [s.stage, s.state])).toEqual(PIPELINE_STAGES.map((s) => [s, 'succeeded']));
    for (const s of run!.stages) expect(s.inputHash).toMatch(/^[a-f0-9]{64}$/);

    const rep = await h.app.inject({ method: 'GET', url: `/v1/audits/${auditId}/report`, headers: bearer(u.accessToken) });
    expect(rep.statusCode).toBe(200);
    const report = AuditReport.parse(rep.json());
    expect(report.window.eventsAnalyzed).toBe(20);
    const audit = (await h.app.inject({ method: 'GET', url: `/v1/audits/${auditId}`, headers: bearer(u.accessToken) })).json();
    expect(audit).toMatchObject({ status: 'complete', reportAvailable: true });
    expect(audit.completedAt).not.toBeNull();

    const raw = await h.admin.query('select report_enc from reports where audit_id = $1', [auditId]);
    expect(raw.rows[0].report_enc.toString('latin1')).not.toContain(auditId);
    const outs = await h.admin.query('select count(*)::int as n from stage_outputs where user_id = $1 and output_enc is not null', [u.userId]);
    expect(outs.rows[0].n).toBe(PIPELINE_STAGES.length);
  });

  it('reruns reuse cached stage outputs (same input hash => skipped, engine not called)', async () => {
    const { u, auditId } = await finishedAudit();
    const first = await until(() => getRun(u.accessToken, auditId), (r) => r?.state === 'succeeded');
    const before = { ...ctl.calls };
    const rerun = await h.app.inject({ method: 'POST', url: `/v1/audits/${auditId}/pipeline`, headers: bearer(u.accessToken) });
    expect(rerun.statusCode).toBe(202);
    const second = PipelineRun.parse(rerun.json());
    expect(second.id).not.toBe(first!.id);
    const done = await until(() => getRun(u.accessToken, auditId), (r) => r?.id === second.id && r.state === 'succeeded');
    expect(done!.stages.every((s) => s.state === 'skipped')).toBe(true);
    expect(done!.stages.map((s) => s.inputHash)).toEqual(first!.stages.map((s) => s.inputHash));
    expect(ctl.calls).toEqual(before);
    // A run already in flight blocks another rerun.
    const again = await h.app.inject({ method: 'POST', url: `/v1/audits/${auditId}/pipeline`, headers: bearer(u.accessToken) });
    expect(again.statusCode).toBe(202);
    const dup = await h.app.inject({ method: 'POST', url: `/v1/audits/${auditId}/pipeline`, headers: bearer(u.accessToken) });
    expect(dup.statusCode).toBe(409);
    await until(() => getRun(u.accessToken, auditId), (r) => r?.state === 'succeeded');
  });

  it('retries a failing stage with backoff, then dead-letters it and fails the audit', async () => {
    ctl.state.failCluster = true;
    try {
      const { u, auditId } = await finishedAudit();
      const run = await until(() => getRun(u.accessToken, auditId), (r) => r?.state === 'failed', 60_000);
      const cluster = run!.stages.find((s) => s.stage === 'cluster')!;
      expect(cluster.state).toBe('dead');
      expect(cluster.attempts).toBe(3); // 1 + JOB_RETRY_LIMIT
      expect(cluster.error).toBe('cluster exploded');
      expect(run!.stages.filter((s) => s.state === 'succeeded').map((s) => s.stage)).toEqual(['sessionize', 'segment']);
      expect(run!.stages.slice(3).every((s) => s.state === 'pending')).toBe(true);
      const audit = (await h.app.inject({ method: 'GET', url: `/v1/audits/${auditId}`, headers: bearer(u.accessToken) })).json();
      expect(audit.status).toBe('failed');
      const report = await h.app.inject({ method: 'GET', url: `/v1/audits/${auditId}/report`, headers: bearer(u.accessToken) });
      expect(report.statusCode).toBe(404);
      const m = (await h.app.inject({ method: 'GET', url: '/metrics' })).body;
      expect(m).toMatch(/pipeline_stage_failures_total\{stage="cluster",kind="dead"\} 1/);

      // Fix the engine and rerun: earlier stages come from cache, the failed one runs again.
      ctl.state.failCluster = false;
      const rerun = await h.app.inject({ method: 'POST', url: `/v1/audits/${auditId}/pipeline`, headers: bearer(u.accessToken) });
      expect(rerun.statusCode).toBe(202);
      const ok = await until(() => getRun(u.accessToken, auditId), (r) => r?.state === 'succeeded');
      expect(ok!.stages.find((s) => s.stage === 'sessionize')!.state).toBe('skipped');
      expect(ok!.stages.find((s) => s.stage === 'cluster')!.state).toBe('succeeded');
    } finally {
      ctl.state.failCluster = false;
    }
  });

  it('the sweep moves windows whose end has passed into analysis', async () => {
    const u = await signup(h.app);
    const audit = await createAudit(h.app, u.accessToken, 1);
    await h.admin.query(`update audits set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`, [audit.id]);
    const changed = await h.c.core.audits.sweep();
    expect(changed).toBeGreaterThanOrEqual(1);
    const row = await h.admin.query('select status from audits where id = $1', [audit.id]);
    expect(['analyzing', 'complete']).toContain(row.rows[0].status);
    await until(() => getRun(u.accessToken, audit.id), (r) => r?.state === 'succeeded');
  });

  it('account deletion purges the user’s queued jobs', async () => {
    const u = await signup(h.app);
    const audit = await createAudit(h.app, u.accessToken, 1);
    // Enqueue without workers getting there first: stop is not needed, the purge counts what is there.
    await h.app.inject({ method: 'POST', url: `/v1/audits/${audit.id}/finish`, headers: bearer(u.accessToken) });
    const del = await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(u.accessToken) });
    expect(del.statusCode).toBe(200);
    const jobs = del.json().tables.find((t: { table: string }) => t.table === 'pgboss.job');
    expect(jobs.rowsDeleted).toBeGreaterThanOrEqual(1);
  });
});

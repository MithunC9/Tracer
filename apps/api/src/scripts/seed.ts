/**
 * Dev seed: a demo user with a paired simulated device, one completed 1-day audit with a
 * working day of synthetic events, and a report produced through the PipelineEngine port.
 *
 *   email:    demo@tracer.local
 *   password: tracer-demo-password   (dev only; documented in apps/api/SECURITY.md)
 *
 * Runs through the real services (no SQL shortcuts) with a manual clock set two days back, so
 * every rule (window, exclusions, encryption, access log) applies to seeded data too.
 * Re-running is a no-op once the user exists.
 */
import { randomUUID } from 'node:crypto';
import type { ActivityEvent } from '@tracer/schema';
import { loadConfig } from '../config/config.js';
import { createContainer } from '../container.js';
import { RecordingJobQueue } from '../jobs/queue.js';
import { DAY_MS, ManualClock } from '../lib/clock.js';
import { AppError } from '../lib/errors.js';
import { createLogger } from '../observability/logger.js';
import { deviceActor, userActor } from '../services/context.js';

export const DEMO_EMAIL = 'demo@tracer.local';
export const DEMO_PASSWORD = 'tracer-demo-password';

const config = loadConfig();
const log = createLogger(config.LOG_LEVEL);
const start = new Date(Math.floor((Date.now() - 2 * DAY_MS) / 3600_000) * 3600_000);
const clock = new ManualClock(start);
const queue = new RecordingJobQueue();
const c = createContainer(config, log, { clock, queue });

try {
  let session;
  try {
    session = await c.services.auth.signup({ email: DEMO_EMAIL, password: DEMO_PASSWORD, displayName: 'Demo', acceptSelfObservation: true });
  } catch (err) {
    if (err instanceof AppError && err.code === 'conflict') {
      log.info(`${DEMO_EMAIL} already exists; nothing to do`);
      process.exit(0);
    }
    throw err;
  }
  const userId = session.session.user.id;
  const me = userActor(userId, 'seed');

  const code = await c.services.devices.createPairingCode(me);
  const device = await c.services.devices.pair({ code: code.code, deviceName: 'Demo Mac (simulated)', platform: 'simulated', agentVersion: '0.1.0' }, 'seed');
  const audit = await c.services.audits.create(me, { lengthDays: 1, recurrence: 'none' });

  // An 8-hour day: a recurring "export CSV from Stripe -> paste into Sheets -> email" loop plus noise.
  const loop: [string, string, string | null][] = [
    ['stripe', 'Payments - Export CSV', 'dashboard.stripe.com'],
    ['google-sheets', 'Monthly revenue - Google Sheets', 'docs.google.com'],
    ['gmail', 'Compose - Revenue update', 'mail.google.com'],
  ];
  const noise: [string, string, string | null][] = [
    ['slack', 'general - Slack', null],
    ['vscode', 'report.ts - tracer', null],
    ['notion', 'Weekly notes', 'www.notion.so'],
  ];
  const events: ActivityEvent[] = [];
  let t = start.getTime() + 60_000;
  let seq = 0;
  const push = ([key, title, host]: [string, string, string | null], dwellMs: number) => {
    events.push({
      id: randomUUID(),
      ts: new Date(t).toISOString(),
      seq: seq++,
      schemaVersion: 1,
      redactions: seq % 7 === 0 ? { email: 1 } : {},
      kind: 'app_focus',
      app: { key, name: key },
      windowTitle: title,
      urlHost: host,
    });
    t += dwellMs;
  };
  for (let hour = 0; hour < 8; hour++) {
    for (const step of loop) push(step, 90_000);
    for (let i = 0; i < 6; i++) push(noise[(hour + i) % noise.length]!, 60_000 + ((hour * 7 + i * 13) % 5) * 30_000);
  }
  clock.set(new Date(t + 60_000));
  const dev = deviceActor(device.deviceId, userId, 'seed');
  for (let i = 0; i < events.length; i += 500) {
    await c.services.ingest.ingest(dev, { batchId: randomUUID(), sentAt: clock.now().toISOString(), agentVersion: '0.1.0', platform: 'simulated', events: events.slice(i, i + 500) });
  }
  await c.services.audits.finish(me, audit.id);

  // Run the pipeline in-process through the same orchestrator the workers use.
  while (queue.sent.length) await c.core.pipeline.runStageJob(queue.sent.shift()!);
  const report = await c.services.pipeline.report(me, audit.id);
  log.info({ userId, auditId: audit.id, events: events.length, findings: report.findings.length }, `seeded ${DEMO_EMAIL}`);
} finally {
  await c.close();
}

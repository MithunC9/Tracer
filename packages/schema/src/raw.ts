import { z } from 'zod';
import { IsoDateTime } from './common.js';

/**
 * RawSample: device-local capture BEFORE exclusion and redaction. Never sent to the API
 * (the API rejects anything that is not an ActivityEvent). Defined here because it is the
 * contract between the fixture generator (TS, writes raw.jsonl) and the agent's simulated
 * capture (Rust, replays raw.jsonl through the real exclude -> redact -> buffer path).
 */
export const RawSample = z.discriminatedUnion('type', [
  z.object({
    t: IsoDateTime,
    type: z.literal('focus'),
    bundleId: z.string(),
    appName: z.string(),
    title: z.string().nullable(),
    /** Full URL for browsers (device-local only), else null */
    url: z.string().nullable(),
    private: z.boolean().default(false),
  }),
  z.object({
    t: IsoDateTime,
    type: z.literal('ax'),
    bundleId: z.string(),
    appName: z.string(),
    headings: z.array(z.string()),
    labels: z.array(z.string()),
    text: z.string(),
    /** Accessibility role says this is a secure/password field */
    secureField: z.boolean().default(false),
  }),
  z.object({ t: IsoDateTime, type: z.literal('clipboard'), bundleId: z.string(), appName: z.string(), contentKind: z.enum(['text', 'image', 'file', 'other']) }),
  z.object({ t: IsoDateTime, type: z.literal('idle_start'), thresholdSeconds: z.number().int().positive() }),
  z.object({ t: IsoDateTime, type: z.literal('idle_end') }),
]);
export type RawSample = z.infer<typeof RawSample>;

/**
 * Ground truth for fixture evaluation (packages/fixtures/data/<persona>/ground-truth.json).
 */
export const GroundTruth = z.object({
  persona: z.string(),
  description: z.string(),
  startsAt: IsoDateTime,
  days: z.number().int().positive(),
  workflows: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      path: z.array(z.object({ appKey: z.string(), action: z.string() })),
      occurrences: z.array(z.object({ start: IsoDateTime, end: IsoDateTime })),
      minutesPerWeek: z.number(),
    }),
  ),
  /** Activities that are deliberately NOT workflows (noise, one-offs) */
  distractors: z.array(z.string()),
});
export type GroundTruth = z.infer<typeof GroundTruth>;

import { z } from 'zod';
import { AppKey } from './apps.js';
import { IsoDateTime, Platform, Uuid } from './common.js';
import { LIMITS, SCHEMA_VERSION } from './config.js';

/**
 * ActivityEvent: the ONLY shape of data that ever leaves the device.
 *
 * Invariants (enforced by the agent before persisting locally, re-checked by the API):
 * - No screenshots, no audio, no keystrokes, no clipboard contents.
 * - Every free-text field has already passed on-device redaction.
 * - Full URLs never leave the device; only the host (and the on-device resolved AppKey).
 */

export const RedactionKind = z.enum([
  'card_number',
  'ssn',
  'email',
  'phone',
  'api_key',
  'high_entropy_token',
  'password_field',
  'iban',
  'url_path',
]);
export type RedactionKind = z.infer<typeof RedactionKind>;

/** Placeholder written in place of a redacted span: `[REDACTED:card_number]` */
export const redactionPlaceholder = (k: RedactionKind) => `[REDACTED:${k}]`;

/** Counts of spans redacted on-device for this event. Contents never transmitted. */
export const RedactionCounts = z.partialRecord(RedactionKind, z.number().int().nonnegative());
export type RedactionCounts = z.infer<typeof RedactionCounts>;

export const AppRef = z.object({
  /** Canonical app key resolved on-device. */
  key: AppKey,
  /** Display name as reported by the OS (redacted). */
  name: z.string().max(80),
});
export type AppRef = z.infer<typeof AppRef>;

const RedactedText = (max: number) => z.string().max(max);

const EventBase = z.object({
  /** Client-generated UUID (v4/v7). Idempotency key for ingest. */
  id: Uuid,
  /** Event time on device, UTC. */
  ts: IsoDateTime,
  /** Monotonic per-device sequence number; gaps are tolerated. */
  seq: z.number().int().nonnegative(),
  schemaVersion: z.literal(SCHEMA_VERSION),
  redactions: RedactionCounts.default({}),
});

/** Frontmost app or window changed. Durations are derived server-side from successive events. */
export const AppFocusEvent = EventBase.extend({
  kind: z.literal('app_focus'),
  app: AppRef,
  windowTitle: RedactedText(LIMITS.maxWindowTitleChars).nullable(),
  /** Host only, e.g. `docs.google.com`. Null for native apps. */
  urlHost: z.string().max(253).nullable(),
});

export const IdleStartEvent = EventBase.extend({
  kind: z.literal('idle_start'),
  /** Seconds of no input before this was emitted. */
  idleThresholdSeconds: z.number().int().positive(),
});

export const IdleEndEvent = EventBase.extend({
  kind: z.literal('idle_end'),
});

/** The clipboard changed. Contents are never read into the event. */
export const ClipboardChangeEvent = EventBase.extend({
  kind: z.literal('clipboard_change'),
  app: AppRef,
  /** Coarse type of what was copied; never the content. */
  contentKind: z.enum(['text', 'image', 'file', 'other']),
});

/** Redacted digest of the focused window's accessibility tree. */
export const TextDigest = z.object({
  headings: z.array(RedactedText(LIMITS.maxDigestItemChars)).max(LIMITS.maxDigestItems),
  labels: z.array(RedactedText(LIMITS.maxDigestItemChars)).max(LIMITS.maxDigestItems),
  text: RedactedText(LIMITS.maxDigestTextChars),
});
export type TextDigest = z.infer<typeof TextDigest>;

export const TextDigestEvent = EventBase.extend({
  kind: z.literal('text_digest'),
  app: AppRef,
  digest: TextDigest,
  /** sha256 of normalized digest; lets the server de-dupe unchanged screens. */
  digestHash: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Agent lifecycle, so the timeline can show pauses and gaps honestly. */
export const CaptureStateEvent = EventBase.extend({
  kind: z.literal('capture_state'),
  state: z.enum(['started', 'paused', 'resumed', 'stopped', 'auto_stopped', 'excluded_app_active']),
  reason: z.string().max(120).nullable(),
});

export const ActivityEvent = z
  .discriminatedUnion('kind', [
    AppFocusEvent,
    IdleStartEvent,
    IdleEndEvent,
    ClipboardChangeEvent,
    TextDigestEvent,
    CaptureStateEvent,
  ])
  .meta({ id: 'ActivityEvent' });
export type ActivityEvent = z.infer<typeof ActivityEvent>;
export type ActivityEventKind = ActivityEvent['kind'];
export type AppFocusEvent = z.infer<typeof AppFocusEvent>;
export type TextDigestEvent = z.infer<typeof TextDigestEvent>;
export type ClipboardChangeEvent = z.infer<typeof ClipboardChangeEvent>;
export type CaptureStateEvent = z.infer<typeof CaptureStateEvent>;

export const IngestBatch = z
  .object({
    /** Client-generated; replaying the same batch is a no-op. */
    batchId: Uuid,
    sentAt: IsoDateTime,
    agentVersion: z.string().max(40),
    platform: Platform,
    events: z.array(ActivityEvent).min(1).max(LIMITS.maxEventsPerBatch),
  })
  .meta({ id: 'IngestBatch' });
export type IngestBatch = z.infer<typeof IngestBatch>;

export const IngestResult = z
  .object({
    batchId: Uuid,
    accepted: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    rejected: z.array(z.object({ id: z.string(), reason: z.string() })),
    /** Agent must stop capturing when this is false (window ended / paused / deleted). */
    captureAllowed: z.boolean(),
    captureUntil: IsoDateTime.nullable(),
  })
  .meta({ id: 'IngestResult' });
export type IngestResult = z.infer<typeof IngestResult>;

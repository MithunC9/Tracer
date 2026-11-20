import { z } from 'zod';
import { IsoDateTime, Platform, Uuid } from './common.js';
import { LIMITS } from './config.js';
import { Exclusions } from './exclusions.js';
import { UserConstraints } from './catalog.js';

// ---------- Auth ----------
export const Email = z.email().max(254).transform((s) => s.toLowerCase());

export const SignupRequest = z
  .object({
    email: Email,
    /** ASVS 2.1: min 12 chars, max 128, no composition rules */
    password: z.string().min(12).max(128),
    displayName: z.string().min(1).max(80).optional(),
    /** Must be true: explicit consent to the self-observation rule. */
    acceptSelfObservation: z.literal(true),
  })
  .meta({ id: 'SignupRequest' });
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z
  .object({ email: Email, password: z.string().min(1).max(128) })
  .meta({ id: 'LoginRequest' });
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * Web: refresh token is set as an httpOnly, SameSite=Strict cookie; the body carries only
 * the access token and a CSRF token (double-submit) for cookie-authenticated endpoints.
 */
export const Session = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresAt: IsoDateTime,
    csrfToken: z.string(),
    user: z.object({ id: Uuid, email: z.string(), displayName: z.string().nullable() }),
  })
  .meta({ id: 'Session' });
export type Session = z.infer<typeof Session>;

export const Me = z
  .object({
    id: Uuid,
    email: z.string(),
    displayName: z.string().nullable(),
    createdAt: IsoDateTime,
    plan: z.enum(['free', 'monthly']),
    constraints: UserConstraints,
  })
  .meta({ id: 'Me' });
export type Me = z.infer<typeof Me>;

export const UpdateMeRequest = z
  .object({ displayName: z.string().min(1).max(80).optional(), constraints: UserConstraints.optional() })
  .meta({ id: 'UpdateMeRequest' });

// ---------- Devices & pairing ----------
export const PairingCode = z
  .object({
    /** 8 chars, Crockford base32, shown as XXXX-XXXX */
    code: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/),
    expiresAt: IsoDateTime,
  })
  .meta({ id: 'PairingCode' });
export type PairingCode = z.infer<typeof PairingCode>;

export const PairDeviceRequest = z
  .object({
    code: PairingCode.shape.code,
    deviceName: z.string().min(1).max(80),
    platform: Platform,
    agentVersion: z.string().max(40),
  })
  .meta({ id: 'PairDeviceRequest' });
export type PairDeviceRequest = z.infer<typeof PairDeviceRequest>;

export const PairDeviceResponse = z
  .object({
    deviceId: Uuid,
    /** Opaque bearer token, shown once. Stored hashed server-side. */
    deviceToken: z.string(),
  })
  .meta({ id: 'PairDeviceResponse' });
export type PairDeviceResponse = z.infer<typeof PairDeviceResponse>;

export const Device = z
  .object({
    id: Uuid,
    name: z.string(),
    platform: Platform,
    agentVersion: z.string(),
    createdAt: IsoDateTime,
    lastSeenAt: IsoDateTime.nullable(),
    revokedAt: IsoDateTime.nullable(),
  })
  .meta({ id: 'Device' });
export type Device = z.infer<typeof Device>;

// ---------- Audits (capture windows) ----------
export const AuditStatus = z.enum([
  'scheduled',
  'capturing',
  'paused',
  'analyzing',
  'complete',
  'failed',
  'cancelled',
]);
export type AuditStatus = z.infer<typeof AuditStatus>;

export const Audit = z
  .object({
    id: Uuid,
    status: AuditStatus,
    lengthDays: z.number().int().min(LIMITS.minAuditDays).max(LIMITS.maxAuditDays),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    recurrence: z.enum(['none', 'monthly']),
    createdAt: IsoDateTime,
    completedAt: IsoDateTime.nullable(),
    reportAvailable: z.boolean(),
  })
  .meta({ id: 'Audit' });
export type Audit = z.infer<typeof Audit>;

export const CreateAuditRequest = z
  .object({
    lengthDays: z.number().int().min(LIMITS.minAuditDays).max(LIMITS.maxAuditDays),
    startsAt: IsoDateTime.optional(),
    recurrence: z.enum(['none', 'monthly']).default('none'),
  })
  .meta({ id: 'CreateAuditRequest' });
export type CreateAuditRequest = z.infer<typeof CreateAuditRequest>;

/** Live status: counts only, never contents. */
export const CaptureStatus = z
  .object({
    auditId: Uuid,
    status: AuditStatus,
    dayNumber: z.number().int().nonnegative(),
    totalDays: z.number().int().positive(),
    eventsReceived: z.number().int().nonnegative(),
    activeMinutes: z.number().nonnegative(),
    distinctApps: z.number().int().nonnegative(),
    devicesReporting: z.number().int().nonnegative(),
    lastEventAt: IsoDateTime.nullable(),
    perDay: z.array(z.object({ dayIndex: z.number().int(), events: z.number().int(), activeMinutes: z.number() })),
  })
  .meta({ id: 'CaptureStatus' });
export type CaptureStatus = z.infer<typeof CaptureStatus>;

/** Pulled by the agent on start and after each upload. */
export const AgentConfig = z
  .object({
    deviceId: Uuid,
    auditId: Uuid.nullable(),
    captureAllowed: z.boolean(),
    captureFrom: IsoDateTime.nullable(),
    captureUntil: IsoDateTime.nullable(),
    paused: z.boolean(),
    exclusions: Exclusions,
    uploadIntervalSeconds: z.number().int().min(30).max(3600),
    idleThresholdSeconds: z.number().int().min(30).max(1800),
  })
  .meta({ id: 'AgentConfig' });
export type AgentConfig = z.infer<typeof AgentConfig>;

// ---------- Privacy ----------
export const DeletionReceipt = z
  .object({
    receiptId: Uuid,
    /** sha256(userId) — the receipt survives deletion but not the identity. */
    subjectHash: z.string(),
    requestedAt: IsoDateTime,
    completedAt: IsoDateTime,
    tables: z.array(z.object({ table: z.string(), rowsDeleted: z.number().int().nonnegative() })),
    derivedDataPurge: z.enum(['complete', 'scheduled']),
    /** HMAC-SHA256 over the canonical JSON of the fields above, keyed by server secret. */
    signature: z.string(),
  })
  .meta({ id: 'DeletionReceipt' });
export type DeletionReceipt = z.infer<typeof DeletionReceipt>;

export const AccessLogEntry = z
  .object({
    id: Uuid,
    at: IsoDateTime,
    actor: z.enum(['user', 'device', 'system']),
    actorId: z.string().nullable(),
    action: z.string(),
    resource: z.string(),
    requestId: z.string().nullable(),
  })
  .meta({ id: 'AccessLogEntry' });
export type AccessLogEntry = z.infer<typeof AccessLogEntry>;

export const CapturedSummary = z
  .object({
    /** What categories of data we hold, with counts. Shown in the Privacy Center. */
    eventsByKind: z.record(z.string(), z.number().int()),
    redactionsByKind: z.record(z.string(), z.number().int()),
    oldestEventAt: IsoDateTime.nullable(),
    newestEventAt: IsoDateTime.nullable(),
    storageBytes: z.number().int().nonnegative(),
  })
  .meta({ id: 'CapturedSummary' });
export type CapturedSummary = z.infer<typeof CapturedSummary>;

// ---------- Health ----------
export const Health = z.object({ status: z.enum(['ok', 'degraded', 'down']), checks: z.record(z.string(), z.string()) });

/**
 * Drizzle table definitions. Source of truth for `drizzle-kit generate`.
 * Mirrors apps/api/db/schema-draft.sql (the cross-agent DB contract); deviations are listed
 * in DECISIONS.local.md. Row-level security, roles and SECURITY DEFINER functions live in the
 * hand-written migration `0002_rls_roles_functions.sql` because drizzle-kit cannot express
 * FORCE ROW LEVEL SECURITY or SECURITY DEFINER.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    plan: text('plan').notNull().default('free'),
    constraints: jsonb('constraints').notNull().default({}),
    consentSelfObservationAt: tstz('consent_self_observation_at').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

export const userKeys = pgTable('user_keys', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  wrappedDek: bytea('wrapped_dek').notNull(),
  keyVersion: integer('key_version').notNull().default(1),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: tstz('expires_at').notNull(),
    rotatedAt: tstz('rotated_at'),
    revokedAt: tstz('revoked_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [index('refresh_tokens_user_family').on(t.userId, t.familyId)],
);

export const pairingCodes = pgTable(
  'pairing_codes',
  {
    codeHash: bytea('code_hash').primaryKey(),
    /** Deviation: sha256 of the first half of the code, so wrong guesses can be counted per code. */
    selector: bytea('selector').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [uniqueIndex('pairing_codes_selector_key').on(t.selector), index('pairing_codes_user').on(t.userId)],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    platform: text('platform').notNull(),
    agentVersion: text('agent_version').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at'),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [index('devices_user').on(t.userId)],
);

export const audits = pgTable(
  'audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    lengthDays: integer('length_days').notNull(),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at').notNull(),
    recurrence: text('recurrence').notNull().default('none'),
    pausedAt: tstz('paused_at'),
    pausedSeconds: integer('paused_seconds').notNull().default(0),
    createdAt: tstz('created_at').notNull().defaultNow(),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    index('audits_user_created').on(t.userId, t.createdAt),
    // At most one open capture window per user.
    uniqueIndex('audits_one_open_per_user')
      .on(t.userId)
      .where(sql`status in ('scheduled', 'capturing', 'paused')`),
    index('audits_due').on(t.endsAt).where(sql`status in ('scheduled', 'capturing', 'paused')`),
    check('audits_length_days_range', sql`${t.lengthDays} between 1 and 14`),
    check(
      'audits_status_valid',
      sql`${t.status} in ('scheduled', 'capturing', 'paused', 'analyzing', 'complete', 'failed', 'cancelled')`,
    ),
    check('audits_window_valid', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export const exclusions = pgTable('exclusions', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  value: jsonb('value').notNull(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

export const ingestBatches = pgTable(
  'ingest_batches',
  {
    batchId: uuid('batch_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    receivedAt: tstz('received_at').notNull().defaultNow(),
    result: jsonb('result').notNull(),
  },
  (t) => [index('ingest_batches_user').on(t.userId)],
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    ts: tstz('ts').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    kind: text('kind').notNull(),
    appKey: text('app_key'),
    /** Deviation: on-device redaction counts (numbers only), for the Privacy Center summary. */
    redactions: jsonb('redactions').notNull().default({}),
    payloadEnc: bytea('payload_enc').notNull(),
    receivedAt: tstz('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('events_audit_ts').on(t.auditId, t.ts),
    index('events_user_received').on(t.userId, t.receivedAt),
    index('events_device').on(t.deviceId),
  ],
);

export const pipelineRuns = pgTable(
  'pipeline_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    auditId: uuid('audit_id')
      .notNull()
      .references(() => audits.id, { onDelete: 'cascade' }),
    state: text('state').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('pipeline_runs_audit_created').on(t.auditId, t.createdAt),
    check('pipeline_runs_state_valid', sql`${t.state} in ('queued', 'running', 'succeeded', 'failed')`),
  ],
);

export const stageOutputs = pgTable(
  'stage_outputs',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull().default(0),
    inputHash: text('input_hash'),
    outputEnc: bytea('output_enc'),
    error: text('error'),
    startedAt: tstz('started_at'),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.stage] }),
    index('stage_outputs_cache').on(t.userId, t.stage, t.inputHash),
    check('stage_outputs_state_valid', sql`${t.state} in ('pending', 'running', 'succeeded', 'failed', 'dead', 'skipped')`),
  ],
);

export const episodeEmbeddings = pgTable(
  'episode_embeddings',
  {
    episodeId: text('episode_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    embedding: vector('embedding', { dimensions: 256 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.episodeId] })],
);

export const reports = pgTable('reports', {
  auditId: uuid('audit_id')
    .primaryKey()
    .references(() => audits.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  runId: uuid('run_id')
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
  reportEnc: bytea('report_enc').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const llmCache = pgTable(
  'llm_cache',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cacheKey: text('cache_key').notNull(),
    responseEnc: bytea('response_enc').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cacheKey] })],
);

export const accessLog = pgTable(
  'access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: tstz('at').notNull().defaultNow(),
    actor: text('actor').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    requestId: text('request_id'),
  },
  (t) => [
    index('access_log_user_at').on(t.userId, t.at, t.id),
    check('access_log_actor_valid', sql`${t.actor} in ('user', 'device', 'system')`),
  ],
);

export const deletionReceipts = pgTable('deletion_receipts', {
  receiptId: uuid('receipt_id').primaryKey(),
  subjectHash: text('subject_hash').notNull(),
  body: jsonb('body').notNull(),
  signature: text('signature').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

/** Tenant tables in the order a hard delete must visit them (children first). */
export const TENANT_TABLES_DELETE_ORDER = [
  'access_log',
  'llm_cache',
  'episode_embeddings',
  'reports',
  'stage_outputs',
  'pipeline_runs',
  'events',
  'ingest_batches',
  'exclusions',
  'audits',
  'devices',
  'pairing_codes',
  'refresh_tokens',
  'user_keys',
  'users',
] as const;
export type TenantTable = (typeof TENANT_TABLES_DELETE_ORDER)[number];

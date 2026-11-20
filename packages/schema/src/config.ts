/**
 * Product-wide constants. Rename the product here and nowhere else.
 */
export const PRODUCT = {
  name: 'Tracer',
  tagline: 'A time-boxed audit of how you actually work.',
  /** Hard product rule, surfaced verbatim in UI and README. */
  selfObservationRule:
    'Tracer is only for observing your own work, on your own computer, with your consent. It must never be used to monitor another person.',
} as const;

/** Contract limits shared by agent, API and tests. Changing these is a contract change. */
export const LIMITS = {
  /** Max events accepted in one ingest batch. */
  maxEventsPerBatch: 1000,
  /** Max serialized ingest body, bytes. */
  maxBatchBytes: 2 * 1024 * 1024,
  /** Window titles are truncated on-device to this many chars. */
  maxWindowTitleChars: 256,
  /** Accessibility text digest cap, chars, after redaction. */
  maxDigestTextChars: 2000,
  maxDigestItems: 40,
  maxDigestItemChars: 120,
  /** Audit window bounds, days. */
  minAuditDays: 1,
  maxAuditDays: 14,
  /** Pairing codes */
  pairingCodeTtlSeconds: 10 * 60,
  /** Access tokens */
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  /** Agent upload cadence default, seconds */
  defaultUploadIntervalSeconds: 5 * 60,
  /** Idle threshold used by agent and sessionizer */
  idleThresholdSeconds: 120,
  /** Embedding dimension (pgvector column size) */
  embeddingDims: 256,
} as const;

export const SCHEMA_VERSION = 1 as const;
export const REPORT_VERSION = 1 as const;

-- Tracer DB schema DRAFT (Phase 0 contract). The backend agent turns this into Drizzle
-- schema + migrations; table/column names here are the contract other agents rely on.
--
-- Tenancy: every user-owned row carries user_id. Row-level security is ENABLED and FORCED
-- on all of them; the API connects as role `tracer_app` (no BYPASSRLS) and sets
-- `SET LOCAL app.user_id = '<uuid>'` per transaction. Workers set it per audit job.
-- Encryption: sensitive payloads are AES-256-GCM encrypted with a per-user data key (DEK);
-- the DEK is stored wrapped by MASTER_KEY in user_keys. Deleting user_keys crypto-shreds
-- anything that escaped hard delete (e.g. backups).

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE NOT NULL,          -- (or text + lower() unique index)
  password_hash text NOT NULL,                   -- argon2id
  display_name  text,
  plan          text NOT NULL DEFAULT 'free',
  constraints   jsonb NOT NULL DEFAULT '{}',     -- UserConstraints
  consent_self_observation_at timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_keys (                          -- envelope encryption
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  wrapped_dek bytea NOT NULL,                     -- AES-GCM(master, dek)
  key_version int NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,                      -- reuse of a rotated token revokes the family
  token_hash  bytea NOT NULL UNIQUE,              -- sha256
  expires_at  timestamptz NOT NULL,
  rotated_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pairing_codes (
  code_hash   bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  attempts    int NOT NULL DEFAULT 0
);

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  platform      text NOT NULL,
  agent_version text NOT NULL,
  token_hash    bytea NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);

CREATE TABLE audits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL,                     -- AuditStatus
  length_days  int  NOT NULL CHECK (length_days BETWEEN 1 AND 14),
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  recurrence   text NOT NULL DEFAULT 'none',
  paused_at    timestamptz,
  paused_seconds int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE exclusions (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  value      jsonb NOT NULL,                      -- Exclusions
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ingest_batches (                     -- idempotency for whole batches
  batch_id    uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  result      jsonb NOT NULL                      -- IngestResult replayed on duplicate
);

CREATE TABLE events (
  id          uuid PRIMARY KEY,                   -- client event id => idempotent insert
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audit_id    uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  seq         bigint NOT NULL,
  kind        text NOT NULL,
  app_key     text,                               -- plaintext for counting/status only
  payload_enc bytea NOT NULL,                     -- AES-GCM(dek, ActivityEvent JSON)
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_audit_ts ON events (audit_id, ts);

CREATE TABLE pipeline_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audit_id   uuid NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  state      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stage_outputs (                      -- persisted per stage => resumable, cheap reruns
  run_id      uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage       text NOT NULL,                      -- PipelineStage
  state       text NOT NULL,                      -- StageState
  attempts    int  NOT NULL DEFAULT 0,
  input_hash  text,
  output_enc  bytea,                              -- AES-GCM(dek, stage output JSON)
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (run_id, stage)
);

CREATE TABLE episode_embeddings (                 -- pgvector for segment/cluster similarity
  episode_id text NOT NULL,
  run_id     uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  embedding  vector(256) NOT NULL,
  PRIMARY KEY (run_id, episode_id)
);

CREATE TABLE reports (
  audit_id     uuid PRIMARY KEY REFERENCES audits(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id       uuid NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  report_enc   bytea NOT NULL,                    -- AES-GCM(dek, AuditReport JSON)
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE llm_cache (                          -- keyed by hash of (model, prompt, schema)
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cache_key   text NOT NULL,
  response_enc bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cache_key)
);

CREATE TABLE access_log (                         -- every access to user data
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL,                       -- user | device | system
  actor_id   text,
  action     text NOT NULL,
  resource   text NOT NULL,
  request_id text
);

CREATE TABLE deletion_receipts (                  -- NOT tenant-scoped; survives the user
  receipt_id   uuid PRIMARY KEY,
  subject_hash text NOT NULL,
  body         jsonb NOT NULL,
  signature    text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS: same policy shape on every tenant table.
-- ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON <t>
--   USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
--   WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
-- Tables: users (on id), user_keys, refresh_tokens, pairing_codes, devices, audits, exclusions,
--   ingest_batches, events, pipeline_runs, stage_outputs, episode_embeddings, reports,
--   llm_cache, access_log.
-- Auth lookups that happen before a tenant is known (login by email, device token, pairing
-- code, refresh token) go through narrowly-scoped SECURITY DEFINER functions, never BYPASSRLS.

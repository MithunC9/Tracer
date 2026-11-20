-- Roles, grants, row-level security and pre-tenant lookup functions.
-- Hand-written: drizzle-kit cannot express FORCE RLS or SECURITY DEFINER.
--
-- tracer_app   the API/worker login role. NOT superuser, NO BYPASSRLS. Its password is set by
--              src/scripts/migrate.ts from DATABASE_URL (never committed here).
-- tracer_auth  NOLOGIN owner of the SECURITY DEFINER lookup functions. BYPASSRLS, but holds only
--              column-level SELECT on the few columns those lookups need. Nobody can log in as it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracer_app') THEN
    CREATE ROLE tracer_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tracer_auth') THEN
    CREATE ROLE tracer_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
-- Belt and braces if the role pre-existed with broader attributes.
ALTER ROLE tracer_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO tracer_app, tracer_auth;
--> statement-breakpoint

-- pg-boss lives in its own schema owned by the app role so it can install/upgrade itself.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION tracer_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, user_keys, refresh_tokens, pairing_codes, devices, audits, exclusions,
  ingest_batches, events, pipeline_runs, stage_outputs, episode_embeddings, reports,
  llm_cache, access_log
TO tracer_app;
--> statement-breakpoint
-- Receipts survive the user and are write-only for the app.
GRANT INSERT ON deletion_receipts TO tracer_app;
--> statement-breakpoint

-- ---------------------------------------------------------------- row-level security
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_keys', 'refresh_tokens', 'pairing_codes', 'devices', 'audits', 'exclusions',
    'ingest_batches', 'events', 'pipeline_runs', 'stage_outputs', 'episode_embeddings',
    'reports', 'llm_cache', 'access_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)
         WITH CHECK (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)',
      t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON users
  USING (id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- deletion_receipts is deliberately not tenant-scoped; RLS on with no SELECT policy means
-- the app role can insert receipts but never read them back.
ALTER TABLE deletion_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deletion_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY receipts_insert_only ON deletion_receipts FOR INSERT WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------- pre-tenant lookups
GRANT SELECT (id, email, password_hash) ON users TO tracer_auth;
--> statement-breakpoint
GRANT SELECT (id, user_id, token_hash, revoked_at) ON devices TO tracer_auth;
--> statement-breakpoint
GRANT SELECT (id, user_id, family_id, token_hash, expires_at, rotated_at, revoked_at) ON refresh_tokens TO tracer_auth;
--> statement-breakpoint
GRANT SELECT (code_hash, selector, user_id, expires_at, used_at, attempts), DELETE ON pairing_codes TO tracer_auth;
--> statement-breakpoint
GRANT SELECT (id, user_id, status, starts_at, ends_at) ON audits TO tracer_auth;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth_user_by_email(p_email text)
RETURNS TABLE (id uuid, password_hash text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.password_hash FROM public.users u WHERE lower(u.email) = lower(p_email) LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth_device_by_token(p_token_hash bytea)
RETURNS TABLE (device_id uuid, user_id uuid, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT d.id, d.user_id, d.revoked_at FROM public.devices d WHERE d.token_hash = p_token_hash LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth_refresh_token(p_token_hash bytea)
RETURNS TABLE (id uuid, user_id uuid, family_id uuid, expires_at timestamptz, rotated_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT r.id, r.user_id, r.family_id, r.expires_at, r.rotated_at, r.revoked_at
  FROM public.refresh_tokens r WHERE r.token_hash = p_token_hash LIMIT 1
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION auth_pairing_code(p_selector bytea)
RETURNS TABLE (code_hash bytea, user_id uuid, expires_at timestamptz, used_at timestamptz, attempts int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.code_hash, p.user_id, p.expires_at, p.used_at, p.attempts
  FROM public.pairing_codes p WHERE p.selector = p_selector LIMIT 1
$$;
--> statement-breakpoint
-- Worker sweep: which windows must start or end. Returns ids only; the worker then opens a
-- tenant-scoped transaction per audit to change it.
CREATE OR REPLACE FUNCTION system_audits_due(p_now timestamptz, p_limit int)
RETURNS TABLE (audit_id uuid, user_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT a.id, a.user_id, a.status FROM public.audits a
  WHERE (a.status = 'scheduled' AND a.starts_at <= p_now)
     OR (a.status IN ('scheduled', 'capturing', 'paused') AND a.ends_at <= p_now)
  ORDER BY a.ends_at
  LIMIT p_limit
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION system_purge_pairing_codes(p_now timestamptz)
RETURNS int
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH d AS (
    DELETE FROM public.pairing_codes p
    WHERE p.expires_at < p_now - interval '1 hour' OR p.used_at IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::int FROM d
$$;
--> statement-breakpoint
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'auth_user_by_email(text)', 'auth_device_by_token(bytea)', 'auth_refresh_token(bytea)',
    'auth_pairing_code(bytea)', 'system_audits_due(timestamptz, int)', 'system_purge_pairing_codes(timestamptz)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO tracer_auth', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO tracer_app', f);
  END LOOP;
END
$$;

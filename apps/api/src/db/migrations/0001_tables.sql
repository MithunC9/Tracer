CREATE TABLE "access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"request_id" text,
	CONSTRAINT "access_log_actor_valid" CHECK ("access_log"."actor" in ('user', 'device', 'system'))
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"length_days" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "audits_length_days_range" CHECK ("audits"."length_days" between 1 and 14),
	CONSTRAINT "audits_status_valid" CHECK ("audits"."status" in ('scheduled', 'capturing', 'paused', 'analyzing', 'complete', 'failed', 'cancelled')),
	CONSTRAINT "audits_window_valid" CHECK ("audits"."ends_at" > "audits"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "deletion_receipts" (
	"receipt_id" uuid PRIMARY KEY NOT NULL,
	"subject_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"agent_version" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "devices_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "episode_embeddings" (
	"episode_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"embedding" vector(256) NOT NULL,
	CONSTRAINT "episode_embeddings_run_id_episode_id_pk" PRIMARY KEY("run_id","episode_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"app_key" text,
	"redactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payload_enc" "bytea" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exclusions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_batches" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"user_id" uuid NOT NULL,
	"cache_key" text NOT NULL,
	"response_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "llm_cache_user_id_cache_key_pk" PRIMARY KEY("user_id","cache_key")
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"code_hash" "bytea" PRIMARY KEY NOT NULL,
	"selector" "bytea" NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"audit_id" uuid NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_runs_state_valid" CHECK ("pipeline_runs"."state" in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"audit_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"report_enc" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_outputs" (
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_hash" text,
	"output_enc" "bytea",
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "stage_outputs_run_id_stage_pk" PRIMARY KEY("run_id","stage"),
	CONSTRAINT "stage_outputs_state_valid" CHECK ("stage_outputs"."state" in ('pending', 'running', 'succeeded', 'failed', 'dead', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "user_keys" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"plan" text DEFAULT 'free' NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consent_self_observation_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_embeddings" ADD CONSTRAINT "episode_embeddings_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_embeddings" ADD CONSTRAINT "episode_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exclusions" ADD CONSTRAINT "exclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_batches" ADD CONSTRAINT "ingest_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_cache" ADD CONSTRAINT "llm_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_run_id_pipeline_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."pipeline_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_outputs" ADD CONSTRAINT "stage_outputs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_keys" ADD CONSTRAINT "user_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_user_at" ON "access_log" USING btree ("user_id","at","id");--> statement-breakpoint
CREATE INDEX "audits_user_created" ON "audits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audits_one_open_per_user" ON "audits" USING btree ("user_id") WHERE status in ('scheduled', 'capturing', 'paused');--> statement-breakpoint
CREATE INDEX "audits_due" ON "audits" USING btree ("ends_at") WHERE status in ('scheduled', 'capturing', 'paused');--> statement-breakpoint
CREATE INDEX "devices_user" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_audit_ts" ON "events" USING btree ("audit_id","ts");--> statement-breakpoint
CREATE INDEX "events_user_received" ON "events" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE INDEX "events_device" ON "events" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "ingest_batches_user" ON "ingest_batches" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pairing_codes_selector_key" ON "pairing_codes" USING btree ("selector");--> statement-breakpoint
CREATE INDEX "pairing_codes_user" ON "pairing_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pipeline_runs_audit_created" ON "pipeline_runs" USING btree ("audit_id","created_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_family" ON "refresh_tokens" USING btree ("user_id","family_id");--> statement-breakpoint
CREATE INDEX "stage_outputs_cache" ON "stage_outputs" USING btree ("user_id","stage","input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));
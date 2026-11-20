CREATE TABLE "ingest_usage" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ingest_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "ingest_usage" ADD CONSTRAINT "ingest_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Hand-added: same grants and tenant policy as every other tenant table (see 0002).
GRANT SELECT, INSERT, UPDATE, DELETE ON ingest_usage TO tracer_app;
--> statement-breakpoint
ALTER TABLE ingest_usage ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ingest_usage FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ingest_usage
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

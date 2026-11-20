-- Extensions need superuser; migrations run with DATABASE_ADMIN_URL.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;

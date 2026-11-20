import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate` (offline). Migrations are applied by src/scripts/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});

import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** src/db/migrations, resolved from both src/ (tsx) and dist/ (node): both sit two levels below the package root. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));

/**
 * Applies migrations as the admin role, then gives the `tracer_app` role LOGIN with the password
 * from DATABASE_URL (so no credential is ever committed in a migration).
 */
export async function runMigrations(adminUrl: string, appUrl?: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder: MIGRATIONS_DIR, migrationsSchema: 'drizzle' });
    if (appUrl) {
      const u = new URL(appUrl);
      const role = decodeURIComponent(u.username);
      if (role !== 'tracer_app') throw new Error(`DATABASE_URL must connect as tracer_app (got ${role})`);
      const stmt = await client.query<{ s: string }>(`select format('alter role %I with login password %L', $1::text, $2::text) as s`, [
        role,
        decodeURIComponent(u.password),
      ]);
      await client.query(stmt.rows[0]!.s);
    }
  } finally {
    await client.end();
  }
}

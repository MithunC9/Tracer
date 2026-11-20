import { z } from 'zod';
import { runMigrations } from '../db/migrate.js';

const env = z.object({ DATABASE_ADMIN_URL: z.url(), DATABASE_URL: z.url() }).parse(process.env);
await runMigrations(env.DATABASE_ADMIN_URL, env.DATABASE_URL);
process.stdout.write('migrations applied\n');

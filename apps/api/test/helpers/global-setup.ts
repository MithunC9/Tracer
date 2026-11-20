import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
    appUrl: string;
  }
}

const APP_PASSWORD = 'tracer_app';

/**
 * Starts Postgres 16 + pgvector in a container (or, when TEST_DATABASE_URL is set, as in CI
 * with a service container, creates a throwaway database there), migrates it, and hands the
 * admin and app connection strings to every integration test file.
 */
export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | null = null;
  let adminUrl: string;
  let dropDb: (() => Promise<void>) | null = null;

  if (process.env.TEST_DATABASE_URL) {
    const base = new URL(process.env.TEST_DATABASE_URL);
    const name = `tracer_test_${randomBytes(4).toString('hex')}`;
    const c = new pg.Client({ connectionString: base.toString() });
    await c.connect();
    await c.query(`create database ${name}`);
    await c.end();
    base.pathname = `/${name}`;
    adminUrl = base.toString();
    dropDb = async () => {
      const root = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
      await root.connect();
      await root.query(`drop database if exists ${name} with (force)`);
      await root.end();
    };
  } else {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16').withDatabase('tracer').withUsername('tracer').withPassword('tracer').start();
    adminUrl = container.getConnectionUri();
  }

  const app = new URL(adminUrl);
  app.username = 'tracer_app';
  app.password = APP_PASSWORD;
  const appUrl = app.toString();
  await runMigrations(adminUrl, appUrl);

  project.provide('adminUrl', adminUrl);
  project.provide('appUrl', appUrl);

  return async () => {
    await dropDb?.();
    await container?.stop();
  };
}

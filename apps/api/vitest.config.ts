import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration files run one after another: they share one database and some measure timing.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          // One Postgres (Testcontainers, or TEST_DATABASE_URL in CI) shared by all files.
          globalSetup: ['test/helpers/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.test.ts'],
          environment: 'node',
          // Same database setup; uses tracer-sim when built (TRACER_SIM_BIN or the cargo release build).
          globalSetup: ['test/helpers/global-setup.ts'],
          testTimeout: 180_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});

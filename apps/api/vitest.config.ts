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
    ],
  },
});

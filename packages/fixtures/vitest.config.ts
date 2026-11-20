import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests run against the schema *source* so they do not depend on a prior schema build.
export default defineConfig({
  resolve: {
    alias: { '@tracer/schema': fileURLToPath(new URL('../schema/src/index.ts', import.meta.url)) },
  },
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000 },
});

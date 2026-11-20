import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo root (pnpm workspace), so Turbopack resolves workspace packages from there.
  turbopack: { root: fileURLToPath(new URL('../..', import.meta.url)) },
};

export default config;

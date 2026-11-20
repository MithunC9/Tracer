import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The workspace package lives at apps/agent (pnpm-workspace matches apps/*); the UI
// source is in ./ui and builds to ./dist, which src-tauri/tauri.conf.json loads.
// Fonts are bundled from @fontsource: the agent never fetches anything from a CDN.
export default defineConfig({
  root: fileURLToPath(new URL('./ui', import.meta.url)),
  plugins: [react()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: {
    target: 'safari15',
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});

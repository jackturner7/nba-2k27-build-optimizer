import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://localhost:4000';

// GitHub Pages serves a project site from /<repo>/, so assets need that prefix.
// Any other static host (or the API deployment) serves from the root, so the
// default stays '/' and BASE_PATH is set only for Pages.
const BASE_PATH = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: BASE_PATH,
  plugins: [react()],
  resolve: {
    alias: {
      // Point at the engine's source so editing core hot-reloads the UI with no
      // build step. The engine's public entry is pure TS — no node builtins.
      '@2k27/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // The dataset is inlined into the bundle in static mode, which pushes the
    // main chunk past Vite's default warning. That is the intended trade: one
    // slightly larger download buys an app with no backend to run.
    chunkSizeWarningLimit: 900,
  },
});

import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Builds the extension's HTML pages (popup + options).
 *
 * These run as normal extension pages, so ES modules and code splitting are
 * fine here. Content scripts and the service worker have different constraints
 * and are built separately by `scripts/build-scripts.mjs`.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, 'src'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome111',
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'src/popup/index.html'),
        options: resolve(import.meta.dirname, 'src/options/index.html'),
      },
    },
  },
});

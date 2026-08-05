import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Content scripts cannot be ES modules, so each one is built on its own as a
 * self-contained IIFE. Rollup refuses `iife` for multi-entry builds (it would
 * need shared chunks), which is why this runs one build per entry instead of
 * a single config with three inputs.
 */
const entries = [
  { name: 'background', file: 'src/background/index.ts' },
  { name: 'content', file: 'src/content/index.ts' },
  { name: 'observer', file: 'src/content/observer.ts' },
  { name: 'parikshaa', file: 'src/content/parikshaa.ts' },
  { name: 'parikshaa-injected', file: 'src/content/parikshaa-injected.ts' },
];

for (const entry of entries) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: resolve(root, 'dist'),
      emptyOutDir: false,
      target: 'chrome111',
      minify: false,
      lib: {
        entry: resolve(root, entry.file),
        formats: ['iife'],
        name: `redo_${entry.name}`,
        fileName: () => `${entry.name}.js`,
      },
      rollupOptions: {
        output: { extend: true },
      },
    },
  });
  console.log(`built ${entry.name}.js`);
}

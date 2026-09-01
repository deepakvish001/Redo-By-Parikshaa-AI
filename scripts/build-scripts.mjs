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
  // Not in the manifest: injected on request by `chrome.scripting`, so the
  // editor inside it is only parsed by people who open the workspace.
  //
  // The only minified bundle. Everything else here stays readable — a reviewer
  // should be able to read what the extension does on a judge's page — but this
  // one is nine parts CodeMirror, and a megabyte of somebody else's library in
  // the packaged extension is a cost the user pays for nothing.
  { name: 'workspace', file: 'src/workspace/index.ts', minify: true },
];

for (const entry of entries) {
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    /**
     * Every non-ASCII character escaped, which is not cosmetic.
     *
     * Chrome reads a file given to `chrome.scripting.executeScript` through
     * `base::IsStringUTF8`, and that rejects Unicode *non-characters* — U+FFFF
     * among them — as well as the invalid encodings the name suggests. Lezer
     * packs its parse tables into string literals by code point, and one of the
     * grammars bundled here contains exactly one U+FFFF. The file is perfectly
     * valid UTF-8; Chrome still refuses it, with the memorable and misleading
     * "It isn't UTF-8 encoded". Escaping to ASCII writes that code point as
     * `\\uFFFF` and the problem disappears.
     */
    esbuild: { charset: 'ascii' },
    build: {
      outDir: resolve(root, 'dist'),
      emptyOutDir: false,
      target: 'chrome111',
      minify: entry.minify === true ? 'esbuild' : false,
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

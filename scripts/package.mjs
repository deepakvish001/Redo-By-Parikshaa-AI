import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Produces the zip the Chrome Web Store expects, and refuses to build one that
 * would be rejected — a failed upload costs a review cycle.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const output = resolve(root, 'dist.zip');

if (!existsSync(dist)) {
  console.error('dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const problems = [];

if (manifest.version !== pkg.version) {
  problems.push(`manifest version ${manifest.version} does not match package.json ${pkg.version}`);
}
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) {
  problems.push(`version "${manifest.version}" is not a valid Chrome version string`);
}
if ((manifest.description ?? '').length > 132) {
  problems.push(`description is ${manifest.description.length} characters; the store allows 132`);
}
if (!manifest.description) {
  problems.push('manifest has no description');
}
for (const size of [16, 32, 48, 128]) {
  if (!existsSync(resolve(dist, `icons/icon-${size}.png`))) {
    problems.push(`icons/icon-${size}.png is missing`);
  }
}
// Every content script and the worker must actually be in the package.
const declared = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
].filter(Boolean);
for (const file of declared) {
  if (!existsSync(resolve(dist, file))) problems.push(`manifest references ${file}, which is not in dist/`);
}

if (problems.length > 0) {
  console.error('Not packaging — the store would reject this build:');
  for (const problem of problems) console.error(`  • ${problem}`);
  process.exit(1);
}

rmSync(output, { force: true });
execFileSync('zip', ['-r', '-q', output, '.'], { cwd: dist });

const size = statSync(output).size;
console.log(`packaged ${manifest.name} v${manifest.version}`);
console.log(`  ${output} (${(size / 1024).toFixed(0)} KB)`);
console.log('  upload at https://chrome.google.com/webstore/devconsole');

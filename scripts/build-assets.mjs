import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

mkdirSync(dist, { recursive: true });
cpSync(resolve(root, 'src/manifest.json'), resolve(dist, 'manifest.json'));

const icons = resolve(root, 'public/icons');
if (!existsSync(icons)) {
  console.error('public/icons is missing — run `npm run icons` first.');
  process.exit(1);
}
cpSync(icons, resolve(dist, 'icons'), { recursive: true });

console.log('copied manifest.json and icons/');

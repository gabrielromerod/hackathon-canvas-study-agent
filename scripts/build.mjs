import { build } from 'esbuild';
import { cp, mkdir, rm, copyFile, readFile } from 'node:fs/promises';
import './model-assets.mjs';
const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Manifest and package versions must match.');
await rm('extension', { recursive: true, force: true });
await mkdir('extension/icons', { recursive: true });
await cp('public', 'extension', { recursive: true });
await build({
  entryPoints: {
    panel: 'src/panel/index.js',
    background: 'src/background/index.js',
    offscreen: 'src/ai/offscreen.js',
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome141',
  minify: true,
  legalComments: 'linked',
  outdir: 'extension',
});
await build({
  entryPoints: ['src/ai/worker.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome141',
  minify: true,
  legalComments: 'linked',
  outfile: 'extension/model-worker.js',
});
await cp('node_modules/@litert-lm/core/wasm', 'extension/wasm', { recursive: true });
await cp('vendor/gemma-e2b', 'extension/tokenizer', { recursive: true });
const icons = [
  'plus-square',
  'clock-counter-clockwise',
  'x',
  'book-open',
  'caret-down',
  'files',
  'file-pdf',
  'caret-right',
  'download-simple',
  'arrow-left',
  'arrows-clockwise',
  'arrow-up',
  'microphone',
  'gear-six',
];
for (const icon of icons)
  await copyFile(
    `node_modules/@phosphor-icons/core/assets/regular/${icon}.svg`,
    `extension/icons/${icon}.svg`,
  );
for (const [from, to] of [
  ['node_modules/idb/LICENSE', 'idb.txt'],
  ['node_modules/@phosphor-icons/core/LICENSE', 'phosphor-icons.txt'],
])
  await copyFile(from, `extension/licenses/${to}`);
console.log(
  `Built Canvas Study Agent ${manifest.version} in extension/ (${icons.length} local icons).`,
);

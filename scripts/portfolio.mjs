// Opt-in recording workspace. Never part of a normal production build.
import { build } from 'esbuild';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
await build({
  entryPoints: { demo: 'demo/app.js', 'demo-panel': 'demo/panel.js' },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome141',
  outdir: 'extension',
  minify: true,
  legalComments: 'linked',
});
await copyFile('demo/index.html', 'extension/demo.html');
await copyFile('demo/demo.css', 'extension/demo.css');
const panel = (await readFile('public/sidepanel.html', 'utf8')).replace(
  'src="panel.js"',
  'src="demo-panel.js"',
);
await writeFile('extension/demo-panel.html', panel);
console.log(
  'Private-data-free recording workspace: chrome-extension://<installed-id>/demo.html. Uses cached weights only.',
);

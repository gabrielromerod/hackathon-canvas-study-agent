import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await check(path);
    else if (/\.(?:js|mjs)$/.test(path))
      execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  }
}
await check('src');
await check('scripts');
await check('demo');
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
for (const path of [
  manifest.side_panel.default_path,
  manifest.background.service_worker,
  'panel.js',
  'panel.css',
])
  await readFile(`extension/${path}`);
if (manifest.action.default_popup || manifest.permissions.includes('activeTab'))
  throw new Error('Legacy popup permissions remain.');
console.log('All source scripts and generated extension entrypoints checked.');

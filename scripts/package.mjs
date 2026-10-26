import { readFile, readdir, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
const files = {};
async function add(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await add(path);
    else files[path] = new Uint8Array(await readFile(path));
  }
}
await add('extension');
for (const path of [
  'LICENSE',
  'AGENTS.md',
  'AGENT.md',
  'docs/local-ai.md',
  'docs/submission.md',
  'docs/architecture.md',
  'docs/usage.md',
  'docs/demo.md',
  'docs/demo-script.md',
  'demo/README.md',
])
  files[path] = new Uint8Array(await readFile(path));
await add('public/licenses');
await add('docs/media');
files['README.md'] = new Uint8Array(await readFile('README.md'));
const zip = zipSync(files, { level: 9 });
await writeFile('canvas-study-agent-extension.zip', zip);
console.log(`Packaged ${Object.keys(files).length} files (${zip.length.toLocaleString()} bytes).`);

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Tokenizer/template are packaged data assets, not the 2 GB model weights.
const assets = [
  [
    'tokenizer.json',
    'https://huggingface.co/google/gemma-4-E2B-it/resolve/3e22461f65e89153144f8adb70e3b8c2cc9845a7/tokenizer.json',
    'cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f',
  ],
  [
    'tokenizer_config.json',
    'https://huggingface.co/google/gemma-4-E2B-it/raw/3e22461f65e89153144f8adb70e3b8c2cc9845a7/tokenizer_config.json',
    '9f4fec4b1dc6ecddf8f4a92e9caea5971c0e67d81309f3f9066a2bee8c362633',
  ],
  [
    'chat_template.jinja',
    'https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/raw/a790a852d433991c0c0a41c1154cf9b3850300fa/chat_template.jinja',
    '02b3091acf53c0b722e3db0c7a1b4980363edcc2d85549dafa339ff5dbfff629',
  ],
];
await mkdir('vendor/gemma-e2b', { recursive: true });
for (const [name, url, expected] of assets) {
  const path = `vendor/gemma-e2b/${name}`;
  let bytes = await readFile(path).catch(() => null);
  const hash = (data) => createHash('sha256').update(data).digest('hex');
  if (!bytes || hash(bytes) !== expected) {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`Cannot download tokenizer asset ${name}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== expected) throw new Error(`Tokenizer checksum mismatch: ${name}`);
    await writeFile(path, bytes);
  }
}
console.log('Verified pinned E2B tokenizer and prompt-template assets.');

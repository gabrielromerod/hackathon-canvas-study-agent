import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { E2B } from './models.js';

export const cacheIdentity = (model) => `${model.id}-${model.revision}-${model.sha256}`;
export async function streamVerifiedModel(
  response,
  writer,
  model,
  { signal, onProgress = () => {} } = {},
) {
  if (!response.ok || !response.body)
    throw new Error(`Model download failed (${response.status}).`);
  const reader = response.body.getReader(),
    hash = sha256.create();
  let bytes = 0,
    pending = [],
    pendingBytes = 0;
  const flush = async () => {
    if (!pendingBytes) return;
    const block = new Uint8Array(pendingBytes);
    let offset = 0;
    for (const chunk of pending) {
      block.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await writer.write(block);
    pending = [];
    pendingBytes = 0;
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      signal?.throwIfAborted();
      bytes += value.byteLength;
      if (bytes > model.bytes) throw new Error('Model size exceeds the pinned artifact.');
      hash.update(value);
      pending.push(value);
      pendingBytes += value.byteLength;
      if (pendingBytes >= 4 * 1024 * 1024) await flush();
      onProgress(bytes, model.bytes);
    }
    if (bytes !== model.bytes) throw new Error('Model size mismatch: download was incomplete.');
    const digest = bytesToHex(hash.digest());
    if (digest !== model.sha256) throw new Error('Model checksum mismatch. Please download again.');
    await flush();
    return { bytes, sha256: digest };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// A stable OPFS directory survives extension builds/reloads and is shared by all panels.
export async function openModelCache(storage = navigator.storage, model = E2B) {
  const root = await storage.getDirectory();
  const directory = await root.getDirectoryHandle('canvas-study-agent-models', { create: true });
  const key = cacheIdentity(model),
    binary = `${key}.bin`,
    marker = `${key}.json`;
  const remove = async (name) => {
    try {
      await directory.removeEntry(name);
    } catch (e) {
      if (e.name !== 'NotFoundError') throw e;
    }
  };
  return {
    async get() {
      try {
        const metadata = JSON.parse(
          await (await (await directory.getFileHandle(marker)).getFile()).text(),
        );
        const file = await (await directory.getFileHandle(binary)).getFile();
        return metadata.sha256 === model.sha256 &&
          metadata.bytes === model.bytes &&
          file.size === model.bytes
          ? file
          : null;
      } catch (e) {
        if (e.name === 'NotFoundError' || e instanceof SyntaxError) return null;
        throw e;
      }
    },
    async download({ signal, onProgress, fetcher = fetch } = {}) {
      const cached = await this.get();
      if (cached) return cached;
      await remove(marker);
      const handle = await directory.getFileHandle(binary, { create: true });
      const writer = await handle.createWritable();
      try {
        const response = await fetcher(model.url, {
          signal,
          credentials: 'omit',
          cache: 'no-store',
        });
        const metadata = await streamVerifiedModel(response, writer, model, { signal, onProgress });
        await writer.close();
        const registry = await (
          await directory.getFileHandle(marker, { create: true })
        ).createWritable();
        await registry.write(
          JSON.stringify({ ...metadata, revision: model.revision, downloadedAt: Date.now() }),
        );
        await registry.close();
        return handle.getFile();
      } catch (e) {
        await writer.abort().catch(() => {});
        await remove(binary);
        throw e;
      }
    },
    async remove() {
      await remove(marker);
      await remove(binary);
    },
  };
}

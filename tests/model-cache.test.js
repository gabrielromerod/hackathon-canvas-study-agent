import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { streamVerifiedModel, cacheIdentity, openModelCache } from '../src/ai/model-cache.js';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('streams model bytes and verifies the full digest before accepting the download', async () => {
  const data = new TextEncoder().encode('model bytes');
  const writes = [];
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(data.slice(0, 4));
        c.enqueue(data.slice(4));
        c.close();
      },
    }),
  );
  const result = await streamVerifiedModel(
    response,
    { write: async (chunk) => writes.push(...chunk) },
    { bytes: data.length, sha256: bytesToHex(sha256(data)) },
  );
  assert.equal(result.bytes, 11);
  assert.deepEqual(writes, [...data]);
});
test('rejects truncated, oversized, corrupted and cancelled downloads', async () => {
  const spec = { bytes: 3, sha256: bytesToHex(sha256(new Uint8Array([1, 2, 3]))) };
  for (const bytes of [
    [1, 2],
    [1, 2, 3, 4],
    [3, 2, 1],
  ])
    await assert.rejects(
      streamVerifiedModel(new Response(new Uint8Array(bytes)), { write: async () => {} }, spec),
      /size|checksum/i,
    );
  const control = new AbortController();
  control.abort();
  await assert.rejects(
    streamVerifiedModel(new Response(new Uint8Array([1, 2, 3])), { write: async () => {} }, spec, {
      signal: control.signal,
    }),
    /abort/i,
  );
});

test('batches small network packets before writing persistent storage', async () => {
  const bytes = new Uint8Array(100 * 1024).fill(7),
    sizes = [];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < 100; i++) controller.enqueue(bytes.slice(i * 1024, (i + 1) * 1024));
        controller.close();
      },
    }),
  );
  await streamVerifiedModel(
    response,
    { write: async (chunk) => sizes.push(chunk.length) },
    { bytes: bytes.length, sha256: bytesToHex(sha256(bytes)) },
  );
  assert.equal(sizes.length, 1);
  assert.equal(sizes[0], bytes.length);
});
test('cache identity follows the model revision and hash, independently of extension version', () => {
  const model = { id: 'gemma-e2b', revision: 'abc', sha256: '123', extensionVersion: '0.6.0' };
  assert.equal(cacheIdentity(model), cacheIdentity({ ...model, extensionVersion: '0.7.0' }));
  assert.notEqual(cacheIdentity(model), cacheIdentity({ ...model, revision: 'changed' }));
});

test('a model is reused across cache reopen and extension version changes without a network request', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'canvas-model-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const directory = (folder) => ({
    async getDirectoryHandle(name) {
      const sub = join(folder, name);
      await mkdir(sub, { recursive: true });
      return directory(sub);
    },
    async removeEntry(name) {
      try {
        await rm(join(folder, name));
      } catch (e) {
        if (e.code === 'ENOENT') e.name = 'NotFoundError';
        throw e;
      }
    },
    async getFileHandle(name, { create = false } = {}) {
      const file = join(folder, name);
      try {
        await stat(file);
      } catch (e) {
        if (create) await writeFile(file, '');
        else {
          e.name = 'NotFoundError';
          throw e;
        }
      }
      return {
        getFile: async () => new File([await readFile(file)], name),
        createWritable: async () => {
          let chunks = [];
          return {
            write: async (bytes) =>
              chunks.push(typeof bytes === 'string' ? Buffer.from(bytes) : Buffer.from(bytes)),
            close: async () => writeFile(file, Buffer.concat(chunks)),
            abort: async () => {
              chunks = [];
            },
          };
        },
      };
    },
  });
  const storage = { getDirectory: async () => directory(path) };
  const bytes = new TextEncoder().encode('verified model');
  const model = {
    id: 'e2b',
    revision: 'r1',
    bytes: bytes.length,
    sha256: bytesToHex(sha256(bytes)),
    url: 'https://example.test/model',
  };
  let requests = 0;
  const cache = await openModelCache(storage, model);
  await cache.download({
    fetcher: async () => {
      requests++;
      return new Response(bytes);
    },
  });
  const updated = await openModelCache(storage, { ...model, extensionVersion: '0.7.0' });
  const file = await updated.download({
    fetcher: async () => {
      throw new Error('Network must remain unused after update');
    },
  });
  assert.equal(await file.text(), 'verified model');
  assert.equal(requests, 1);
  await updated.remove();
  assert.equal(await updated.get(), null);
});

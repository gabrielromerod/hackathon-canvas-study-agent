import test from 'node:test';
import assert from 'node:assert/strict';
import { checkResources } from '../src/ai/resources.js';

test('reports unsupported WebGPU or missing fp16 without inventing GPU memory', async () => {
  const base = {
    deviceMemory: 16,
    storage: { estimate: async () => ({ quota: 1000, usage: 200 }) },
  };
  assert.equal((await checkResources(base)).compatible, false);
  const missing = await checkResources({
    ...base,
    gpu: { requestAdapter: async () => ({ features: new Set(), limits: {} }) },
  });
  assert.equal(missing.compatible, false);
  assert.match(missing.reason, /shader-f16/);
  const supported = await checkResources({
    ...base,
    gpu: {
      requestAdapter: async () => ({
        features: new Set(['shader-f16']),
        limits: { maxBufferSize: 256, maxStorageBufferBindingSize: 128 },
        info: { vendor: 'test' },
      }),
    },
  });
  assert.equal(supported.compatible, true);
  assert.equal(supported.memoryGiB, 16);
  assert.equal(supported.storageAvailable, 800);
  assert.equal(supported.vram, undefined);
  assert.match(supported.reason, /test readiness/);
});

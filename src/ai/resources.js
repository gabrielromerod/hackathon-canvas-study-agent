export async function checkResources(env = navigator) {
  const estimate = (await env.storage?.estimate?.()) || {};
  const result = {
    compatible: false,
    memoryGiB: env.deviceMemory || null,
    storageAvailable:
      estimate.quota == null ? null : Math.max(0, estimate.quota - (estimate.usage || 0)),
  };
  if (!env.gpu)
    return {
      ...result,
      reason:
        'WebGPU is unavailable. Enable Chrome graphics acceleration or use a compatible device.',
    };
  const adapter = await env.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { ...result, reason: 'Chrome could not access a GPU adapter.' };
  if (!adapter.features.has('shader-f16'))
    return { ...result, reason: 'This model requires shader-f16 support.' };
  return {
    ...result,
    compatible: true,
    reason: 'WebGPU available. A model load and short response will test readiness.',
    gpu: adapter.info?.description || adapter.info?.vendor || 'WebGPU adapter',
    limits: {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
    },
  };
}

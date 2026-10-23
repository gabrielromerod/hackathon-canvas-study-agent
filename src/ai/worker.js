import { Engine, loadLiteRtLm, Backend } from '@litert-lm/core';
import { openModelCache } from './model-cache.js';
import { checkResources } from './resources.js';
import { E2B } from './models.js';
let engine,
  conversation,
  aborter,
  operation = false,
  stopped = false,
  validated = false;
let status = { phase: 'idle', cached: false, modelId: E2B.id, weightDownloadRequests: 0 };
const emit = (patch) => {
  status = { ...status, ...patch };
  self.postMessage({ event: 'status', data: status });
};
const errorText = (error) => error?.message || String(error);
async function load() {
  if (engine) return;
  const resources = await checkResources();
  emit({ resources });
  if (!resources.compatible) throw new Error(resources.reason);
  const file = await (await openModelCache()).get();
  if (!file) throw new Error('Download Gemma 4 E2B first.');
  const loadStart = performance.now();
  emit({ phase: 'loading', cached: true, error: '', resident: true });
  self.Module = {
    locateFile: (name) => new URL(`wasm/${name}`, self.location.href).href,
    printErr: (line) => {
      if (/^INFO:/.test(line) || /NPU accelerator could not/.test(line)) console.info(line);
      else console.warn(line);
    },
  };
  if (!self.__studyRuntimeLoaded) {
    await loadLiteRtLm(new URL('wasm/', self.location.href).href);
    self.__studyRuntimeLoaded = true;
  }
  engine = await Engine.create({
    model: file,
    backend: Backend.GPU_ARTISAN,
    mainExecutorSettings: { maxNumTokens: 8192 },
  });
  emit({ loadMs: Math.round(performance.now() - loadStart) });
}
async function generate(payload, id) {
  if (!engine) await load();
  stopped = false;
  conversation = await engine.createConversation({
    preface: {
      messages: payload.messages || [{ role: 'system', content: 'Answer concisely.' }],
      extra_context: { enable_thinking: false },
    },
    sessionConfig: { maxOutputTokens: payload.maxOutputTokens || 1024 },
  });
  let text = '',
    count = 0;
  const start = performance.now();
  let first;
  try {
    emit({ phase: 'generating', error: '' });
    for await (const chunk of conversation.sendMessageStreaming(payload.text)) {
      if (stopped) break;
      const part = Array.isArray(chunk.content)
        ? chunk.content
            .filter((p) => p.type === 'text' || (!p.type && p.text))
            .map((p) => p.text || '')
            .join('')
        : typeof chunk.content === 'string'
          ? chunk.content
          : '';
      if (part) {
        first ??= performance.now();
        text += part;
        count++;
        self.postMessage({ event: 'chunk', id, data: { text, requestId: id } });
        if (payload.test) emit({ readinessReply: text });
      }
    }
    if (!text.trim() && !stopped)
      throw new Error('The model returned no text. Try loading it again.');
    if (payload.test && !stopped) validated = true;
    emit({
      phase: validated ? 'ready' : 'idle',
      ...(payload.test ? { readinessReply: text } : {}),
      benchmark: {
        firstTokenMs: first ? Math.round(first - start) : null,
        durationMs: Math.round(performance.now() - start),
        chunks: count,
      },
    });
    return { text, status: stopped ? 'stopped' : 'complete' };
  } finally {
    await conversation?.delete();
    conversation = null;
  }
}
self.onmessage = async ({ data: request }) => {
  const { id, method, payload = {} } = request;
  if (method === 'cancel') {
    stopped = true;
    conversation?.cancel();
    aborter?.abort();
    self.postMessage({ id, data: true });
    return;
  }
  if (method === 'status') {
    try {
      emit({
        cached: Boolean(await (await openModelCache()).get()),
        resources: await checkResources(),
      });
      self.postMessage({ id, data: status });
    } catch (error) {
      self.postMessage({ id, error: errorText(error) });
    }
    return;
  }
  if (operation) {
    self.postMessage({
      id,
      error: 'The local model is busy. Please wait or stop the current operation.',
    });
    return;
  }
  operation = true;
  try {
    let result;
    if (method === 'setup') {
      const cache = await openModelCache();
      if (!(await cache.get())) {
        if (payload.cachedOnly)
          throw new Error(
            'The downloaded model is unavailable. No automatic download was started.',
          );
        const resources = await checkResources();
        if (!resources.compatible) throw new Error(resources.reason);
        if (resources.storageAvailable !== null && resources.storageAvailable < E2B.bytes * 1.1)
          throw new Error('Not enough browser storage for this model.');
        await navigator.storage.persist?.();
        aborter = new AbortController();
        emit({ phase: 'downloading', bytes: 0, total: E2B.bytes, error: '', resources });
        let last = 0;
        await cache.download({
          fetcher: (...args) => {
            emit({ weightDownloadRequests: status.weightDownloadRequests + 1 });
            return fetch(...args);
          },
          signal: aborter.signal,
          onProgress(bytes, total) {
            if (performance.now() - last > 200 || bytes === total) {
              last = performance.now();
              emit({ bytes, total });
            }
          },
        });
        aborter = null;
        emit({ cached: true });
      }
      await load();
      result = await generate(
        {
          text: 'Reply with a single short sentence confirming you are ready to help a student.',
          maxOutputTokens: 128,
          test: true,
        },
        id,
      );
    } else if (method === 'generate') {
      if (!validated) throw new Error('Load and test E2B before chatting.');
      result = await generate(payload, id);
    } else if (method === 'unload' || method === 'remove') {
      await engine?.delete();
      engine = null;
      validated = false;
      if (method === 'remove') await (await openModelCache()).remove();
      emit({
        phase: 'idle',
        cached: method === 'remove' ? false : status.cached,
        resident: false,
        readinessReply: '',
        error: '',
      });
      result = true;
    } else throw new Error('Unknown model operation.');
    self.postMessage({ id, data: result });
  } catch (error) {
    aborter = null;
    emit({ phase: validated ? 'ready' : 'error', error: errorText(error) });
    self.postMessage({ id, error: errorText(error) });
  } finally {
    operation = false;
  }
};

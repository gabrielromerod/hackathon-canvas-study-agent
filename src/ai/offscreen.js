import { createModelLifetime } from './lifetime.js';
let worker = null,
  phase = 'idle';
const pending = new Map();
const notify = (message) =>
  chrome.runtime.sendMessage({ target: 'ai-event', ...message }).catch(() => {});
function terminate() {
  worker?.terminate();
  worker = null;
  phase = 'idle';
  lifetime.update({ phase, resident: false });
}
function getWorker() {
  if (worker) return worker;
  worker = new Worker(chrome.runtime.getURL('model-worker.js'));
  worker.onmessage = ({ data }) => {
    if (data.event) {
      if (data.event === 'status') {
        phase = data.data.phase;
        lifetime.update({ phase, resident: data.data.resident });
      }
      void notify(data);
    } else {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      request.reply(data);
      if (!data.error && ['unload', 'remove'].includes(request.method)) terminate();
    }
  };
  worker.onerror = (error) => {
    for (const [id, request] of pending)
      request.reply({ id, error: error.message || 'Local model worker stopped.' });
    pending.clear();
    terminate();
    void notify({
      event: 'status',
      data: { phase: 'error', error: error.message || 'Local model worker stopped.' },
    });
  };
  return worker;
}
const lifetime = createModelLifetime({
  unload: async () => {
    terminate();
    void notify({ event: 'status', data: { phase: 'idle', cached: true, readinessReply: '' } });
  },
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'ai-worker') return;
  if (message.method === 'panels') {
    lifetime.update({ panels: message.payload.count });
    sendResponse({ id: message.id, data: true });
    return;
  }
  if (message.method === 'cancel' && phase === 'loading') {
    for (const [id, request] of pending)
      request.reply({ id, error: 'Model loading cancelled. Downloaded weights are retained.' });
    pending.clear();
    terminate();
    void notify({ event: 'status', data: { phase: 'idle', cached: true, error: '' } });
    sendResponse({ id: message.id, data: true });
    return;
  }
  pending.set(message.id, { reply: sendResponse, method: message.method });
  getWorker().postMessage(message);
  return true;
});

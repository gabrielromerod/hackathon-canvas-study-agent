import { initializePanel } from '../src/panel/app.js';
import { openRepository } from '../src/storage/repository.js';
import { createBackgroundHub } from '../src/background/hub.js';
import { createModelBridge } from '../src/ai/bridge.js';
import { cachedDemoModel, demoSnapshot } from './fixture.js';
const snapshot = demoSnapshot();
const listeners = new Set();
const event = () => ({
  addListener(listener) {
    listeners.add(listener);
  },
});
let url = snapshot.modules[0].items[0].url;
const api = {
  windows: { getCurrent: async () => ({ id: 900001 }) },
  sidePanel: { close: async () => {} },
  runtime: { onConnect: event(), getURL: (path) => chrome.runtime.getURL(path) },
  tabs: {
    query: async () => [{ id: 900001, windowId: 900001, active: true, url }],
    onActivated: event(),
    onUpdated: event(),
    onRemoved: event(),
  },
};
const repository = await openRepository('canvas-study-agent-public-demo-v1');
const generation = await repository.beginImport(snapshot.courseId);
await repository.saveSnapshot(snapshot.courseId, generation, snapshot);
let hub;
const bridge = createModelBridge(chrome, (event, data, id) => hub?.modelEvent(event, data, id));
hub = createBackgroundHub(api, repository, { model: cachedDemoModel(bridge) });
let app;
const session = hub.createSession((message) => app?.receive(message.event, message.data));
app = await initializePanel(api, document, {
  source: {
    discover: async () => structuredClone(snapshot),
    readPage: async () => {
      throw new Error('The synthetic source is already loaded.');
    },
    readFile: async () => {
      throw new Error('No private file is used in this demo.');
    },
  },
  transport: {
    rpc: (method, payload) => hub.request(session, method, payload),
    close: () => hub.disconnect(session),
  },
});
window.addEventListener('message', async ({ origin, data }) => {
  if (origin !== location.origin || data?.type !== 'demo-lesson') return;
  const item = snapshot.modules
    .flatMap((module) => module.items)
    .find((item) => item.id === data.itemId);
  if (!item) return;
  url = item.url;
  await hub.updateWindow(900001);
});
document.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  const item = snapshot.modules
    .flatMap((module) => module.items)
    .find((item) => item.url === link.href);
  if (item) {
    event.preventDefault();
    parent.postMessage({ type: 'demo-source', itemId: item.id }, location.origin);
  }
});
window.addEventListener('pagehide', () => app.dispose(), { once: true });

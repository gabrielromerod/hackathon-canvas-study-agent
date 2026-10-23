import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { openRepository } from '../src/storage/repository.js';
import { createBackgroundHub } from '../src/background/hub.js';
const listener = () => ({ addListener() {} });
async function setup(t) {
  const name = `aihub-${crypto.randomUUID()}`,
    repo = await openRepository(name);
  t.after(async () => {
    repo.close();
    await deleteDB(name);
  });
  const calls = [],
    events = [];
  let resolve;
  const model = {
    rpc: async (method, payload, id) => {
      calls.push({ method, payload, id });
      if (method === 'generate') return new Promise((r) => (resolve = r));
      return { phase: 'ready' };
    },
  };
  const api = {
    runtime: { onConnect: listener() },
    tabs: {
      onActivated: listener(),
      onUpdated: listener(),
      onRemoved: listener(),
      query: async () => [{ id: 1, url: 'https://msjc.instructure.com/courses/101/pages/a' }],
    },
  };
  const prepare = async ({ text }) => ({
    messages: [
      { role: 'system', content: 'Evidence' },
      { role: 'user', content: text },
    ],
    sourceRefs: [],
    memoryRefs: [],
  });
  const hub = createBackgroundHub(api, repo, { model, prepare });
  const owner = hub.createSession((event) => events.push(event));
  await hub.request(owner, 'subscribe', { windowId: 1 });
  const chat = await hub.request(owner, 'getChatState', { courseId: '101' });
  return {
    hub,
    owner,
    repo,
    calls,
    events,
    payload: {
      courseId: '101',
      threadId: chat.activeThreadId,
      turnId: 't',
      userMessageId: 'u',
      assistantMessageId: 'a',
      text: 'Explain',
    },
    finish: () => resolve({ text: 'Private course answer', status: 'complete' }),
  };
}
const tick = () => new Promise((r) => setImmediate(r));
test('AI hub starts asynchronous inference and keeps raw output out of global model status', async (t) => {
  const s = await setup(t);
  await s.hub.request(s.owner, 'sendTurn', s.payload);
  await tick();
  const call = s.calls.find((c) => c.method === 'generate');
  assert.ok(call);
  const otherEvents = [],
    other = s.hub.createSession((event) => otherEvents.push(event));
  other.context = { courseId: '999' };
  s.hub.modelEvent('chunk', { text: 'Private course answer' }, call.id);
  await tick();
  s.finish();
  await tick();
  await tick();
  assert.equal(
    otherEvents.some((event) => JSON.stringify(event).includes('Private course answer')),
    false,
  );
  assert.equal(
    (await s.repo.getChatState('101')).threads[0].messages.at(-1).text,
    'Private course answer',
  );
});
test('scope changes and panel closure cancel owned turns before stale output can arrive', async (t) => {
  const s = await setup(t);
  await s.hub.request(s.owner, 'sendTurn', s.payload);
  await tick();
  await s.hub.request(s.owner, 'setScope', {
    courseId: '101',
    threadId: s.payload.threadId,
    scope: { kind: 'module', moduleId: '5', label: 'Chapter5' },
  });
  assert.ok(s.calls.some((call) => call.method === 'cancel'));
  s.finish();
  await tick();
  await tick();
  assert.equal((await s.repo.getChatState('101')).threads[0].messages.at(-1).status, 'cancelled');
});

test('global model events cannot contain conversation output', async (t) => {
  const s = await setup(t),
    otherEvents = [],
    other = s.hub.createSession((event) => otherEvents.push(event));
  other.context = { courseId: '999' };
  s.hub.modelEvent('status', {
    phase: 'ready',
    sample: 'Private course answer',
    resources: { compatible: true },
  });
  assert.equal(JSON.stringify(otherEvents).includes('Private course answer'), false);
});

test('departure during a slow readiness check cannot start an old-course turn', async (t) => {
  const s = await setup(t);
  let release;
  s.calls.length = 0;
  // The bridge returns a deferred status once, while all other operations remain live.
  const model = {
    rpc: async (method) =>
      method === 'status'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : assert.fail('No generation after departure'),
  };
  const listener = () => ({ addListener() {} });
  let url = 'https://msjc.instructure.com/courses/101/pages/a';
  const api = {
    runtime: { onConnect: listener() },
    tabs: {
      onActivated: listener(),
      onUpdated: listener(),
      onRemoved: listener(),
      query: async () => [{ id: 1, url }],
    },
  };
  const hub = createBackgroundHub(api, s.repo, {
      model,
      prepare: async () => assert.fail('No prompt after departure'),
    }),
    owner = hub.createSession(() => {});
  await hub.request(owner, 'subscribe', { windowId: 1 });
  const pending = hub.request(owner, 'sendTurn', s.payload);
  await tick();
  url = 'https://msjc.instructure.com/courses/202/pages/b';
  await hub.updateWindow(1);
  release({ phase: 'ready' });
  await assert.rejects(pending, /changed|closed|course/i);
  assert.equal((await s.repo.getChatState('101')).threads[0].messages.length, 0);
});
test('generation busy notifications reach panels in other courses during preparation', async (t) => {
  const s = await setup(t),
    events = [],
    other = s.hub.createSession((value) => events.push(value));
  other.context = { courseId: '999' };
  await s.hub.request(s.owner, 'sendTurn', s.payload);
  await tick();
  assert.ok(events.some((event) => event.event === 'generation' && event.data.busy));
  s.finish();
  await tick();
});

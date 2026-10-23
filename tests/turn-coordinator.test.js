import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { openRepository } from '../src/storage/repository.js';
import { createTurnCoordinator } from '../src/ai/turns.js';
async function setup(t) {
  const name = `coordinator-${crypto.randomUUID()}`,
    repo = await openRepository(name);
  t.after(async () => {
    repo.close();
    await deleteDB(name);
  });
  const chat = await repo.getChatState('101');
  const calls = [],
    events = [];
  let resolve, reject;
  const model = {
    rpc: async (method, payload, id) => {
      calls.push({ method, payload, id });
      if (method === 'generate')
        return new Promise((a, b) => {
          resolve = a;
          reject = b;
        });
      return { phase: 'ready' };
    },
  };
  const coordinator = createTurnCoordinator({
    repository: repo,
    model,
    prepare: async ({ text }) => ({
      messages: [
        { role: 'system', content: 'Evidence' },
        { role: 'user', content: text },
      ],
      sourceRefs: [{ id: 'S1' }],
      memoryRefs: [],
    }),
    broadcast: (event, data) => events.push({ event, data }),
  });
  const owner = { closed: false, sourceRevision: 0 },
    payload = {
      courseId: '101',
      threadId: chat.activeThreadId,
      text: 'Explain slope',
      turnId: 't1',
      userMessageId: 'u1',
      assistantMessageId: 'a1',
    };
  return {
    repo,
    coordinator,
    owner,
    payload,
    calls,
    events,
    finish: (result) => resolve(result),
    fail: (error) => reject(error),
  };
}
const tick = () => new Promise((r) => setImmediate(r));
test('saves the user before generation, persists streaming, and excludes the final question from preface', async (t) => {
  const s = await setup(t);
  const started = await s.coordinator.start(s.owner, s.payload);
  await tick();
  assert.equal(started.started, true);
  assert.equal(s.calls.at(-1).method, 'generate');
  assert.deepEqual(s.calls.at(-1).payload.messages, [{ role: 'system', content: 'Evidence' }]);
  assert.equal(s.calls.at(-1).payload.text, 'Explain slope');
  assert.equal((await s.repo.getChatState('101')).threads[0].messages[0].text, 'Explain slope');
  s.coordinator.event('chunk', { text: 'Slope means change' }, s.calls.at(-1).id);
  await tick();
  s.finish({ text: 'Slope means change [S1].', status: 'complete' });
  await s.coordinator.settled();
  const messages = (await s.repo.getChatState('101')).threads[0].messages;
  assert.equal(messages.length, 2);
  assert.equal(messages[1].status, 'complete');
  assert.equal(messages[1].text, 'Slope means change [S1].');
  assert.deepEqual(messages[1].sourceRefs, [{ id: 'S1' }]);
});
test('one generation owns all windows and cancelling fences late chunks', async (t) => {
  const s = await setup(t);
  await s.coordinator.start(s.owner, s.payload);
  await tick();
  await assert.rejects(s.coordinator.start({}, { ...s.payload, turnId: 't2' }), /busy|another/i);
  const requestId = s.calls.find((c) => c.method === 'generate').id;
  s.coordinator.event('chunk', { text: 'Partial' }, requestId);
  await tick();
  await s.coordinator.cancel(s.owner);
  s.coordinator.event('chunk', { text: 'Late unwanted' }, requestId);
  s.finish({ text: 'Late unwanted', status: 'complete' });
  await s.coordinator.settled();
  const assistant = (await s.repo.getChatState('101')).threads[0].messages[1];
  assert.equal(assistant.status, 'cancelled');
  assert.equal(assistant.text, 'Partial');
});
test('retry keeps the original question and errors preserve partial replies', async (t) => {
  const s = await setup(t);
  await s.coordinator.start(s.owner, s.payload);
  await tick();
  s.coordinator.event('chunk', { text: 'Some answer' }, s.calls.at(-1).id);
  await tick();
  s.fail(new Error('GPU lost'));
  await s.coordinator.settled();
  let chat = await s.repo.getChatState('101');
  assert.equal(chat.threads[0].messages[1].status, 'error');
  assert.equal(chat.threads[0].messages[1].text, 'Some answer');
  await s.coordinator.start(s.owner, {
    ...s.payload,
    retry: true,
    expectedAttempt: 1,
    assistantMessageId: 'a2',
  });
  await tick();
  s.finish({ text: 'Recovered', status: 'complete' });
  await s.coordinator.settled();
  chat = await s.repo.getChatState('101');
  assert.equal(chat.threads[0].messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(chat.threads[0].messages.at(-1).text, 'Recovered');
});
test('departure while prompt preparation is pending does not start or save a turn', async (t) => {
  const s = await setup(t);
  let release;
  const coordinator = createTurnCoordinator({
    repository: s.repo,
    model: { rpc: () => assert.fail('No inference after departure') },
    prepare: () =>
      new Promise((r) => {
        release = r;
      }),
    broadcast: () => {},
  });
  const promise = coordinator.start(s.owner, s.payload);
  await tick();
  s.owner.closed = true;
  release({ messages: [], sourceRefs: [], memoryRefs: [] });
  await assert.rejects(promise, /changed|closed|cancel/i);
  assert.equal((await s.repo.getChatState('101')).threads[0].messages.length, 0);
});

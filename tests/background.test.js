import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundHub, courseContext } from '../src/background/hub.js';
const listener = () => ({
  handlers: [],
  addListener(fn) {
    this.handlers.push(fn);
  },
});
function setup() {
  let active = {
    id: 7,
    windowId: 1,
    active: true,
    url: 'https://msjc.instructure.com/courses/50427/pages/lecture',
  };
  const api = {
    runtime: { onConnect: listener() },
    tabs: {
      onActivated: listener(),
      onUpdated: listener(),
      onRemoved: listener(),
      query: async ({ windowId }) => [{ ...active, windowId }],
    },
  };
  const records = new Map();
  const chats = new Map();
  const repository = {
    async getCourse(id) {
      return structuredClone(records.get(id) || { courseId: id, generation: 0, snapshot: null });
    },
    async beginImport(id) {
      const r = await this.getCourse(id);
      r.generation++;
      records.set(id, r);
      return r.generation;
    },
    async saveSnapshot(id, generation, snapshot) {
      const r = records.get(id);
      if (r.generation !== generation) return false;
      records.set(id, { ...r, snapshot });
      return true;
    },
    async getLastCourse() {
      return '50427';
    },
    async setLastCourse() {},
    async getChatState(id) {
      return chats.get(id) || {};
    },
  };
  return {
    hub: createBackgroundHub(api, repository),
    api,
    records,
    setActive: (value) => {
      active = value;
    },
  };
}

test('recognizes any MSJC course route and excludes lookalikes and other origins', () => {
  for (const path of [
    '/courses/50427',
    '/courses/50427/pages/lecture',
    '/courses/50427/assignments/1',
    '/courses/50427/modules',
  ])
    assert.equal(
      courseContext({ id: 7, windowId: 1, url: `https://msjc.instructure.com${path}` }).courseId,
      '50427',
    );
  for (const url of [
    'https://evil.test/courses/50427',
    'https://msjc.instructure.com/courses/50427fake',
    'https://msjc.instructure.com/login',
  ])
    assert.equal(courseContext({ id: 7, url }).courseId, null);
});

test('shares an import claim across windows and rejects a stale writer after release', async () => {
  const { hub, records } = setup();
  const a = hub.createSession(() => {}),
    b = hub.createSession(() => {});
  await hub.request(a, 'subscribe', { windowId: 1 });
  await hub.request(b, 'subscribe', { windowId: 2 });
  const first = await hub.request(a, 'claimImport', { courseId: '50427' });
  assert.equal(first.acquired, true);
  assert.equal((await hub.request(b, 'claimImport', { courseId: '50427' })).acquired, false);
  await hub.disconnect(a);
  const next = await hub.request(b, 'claimImport', { courseId: '50427' });
  assert.ok(next.generation > first.generation);
  assert.equal(
    await hub.request(a, 'saveSnapshot', {
      courseId: '50427',
      generation: first.generation,
      snapshot: { stale: true },
    }),
    false,
  );
  assert.equal(
    await hub.request(b, 'saveSnapshot', {
      courseId: '50427',
      generation: next.generation,
      snapshot: { fresh: true },
    }),
    true,
  );
  assert.deepEqual(records.get('50427').snapshot, { fresh: true });
});

test('updates only the corresponding window context and releases claims on course departure', async () => {
  const { hub, setActive } = setup();
  const eventsA = [],
    eventsB = [];
  const a = hub.createSession((x) => eventsA.push(x)),
    b = hub.createSession((x) => eventsB.push(x));
  await hub.request(a, 'subscribe', { windowId: 1 });
  await hub.request(b, 'subscribe', { windowId: 2 });
  await hub.request(a, 'claimImport', { courseId: '50427' });
  setActive({
    id: 8,
    windowId: 1,
    active: true,
    url: 'https://msjc.instructure.com/courses/50618/assignments/2',
  });
  await hub.updateWindow(1);
  assert.equal(eventsA.at(-1).data.courseId, '50618');
  assert.equal(eventsB.filter((x) => x.event === 'context').length, 0);
  assert.equal((await hub.request(b, 'claimImport', { courseId: '50427' })).acquired, true);
});

test('does not install an orphaned claim when the owner disconnects during beginImport', async () => {
  const api = {
    runtime: { onConnect: listener() },
    tabs: {
      onActivated: listener(),
      onUpdated: listener(),
      onRemoved: listener(),
      query: async () => [{ id: 7, url: 'https://msjc.instructure.com/courses/50427/pages/a' }],
    },
  };
  let finish;
  let count = 0;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const repo = {
    setLastCourse: async () => {},
    beginImport: async () => (++count === 1 ? pending : 2),
  };
  const hub = createBackgroundHub(api, repo),
    a = hub.createSession(() => {}),
    b = hub.createSession(() => {});
  await hub.request(a, 'subscribe', { windowId: 1 });
  await hub.request(b, 'subscribe', { windowId: 2 });
  const first = hub.request(a, 'claimImport', { courseId: '50427' });
  await new Promise((r) => setImmediate(r));
  await hub.disconnect(a);
  finish(1);
  assert.equal((await first).acquired, false);
  assert.equal((await hub.request(b, 'claimImport', { courseId: '50427' })).acquired, true);
});

test('a delayed older tab query cannot overwrite the latest course context', async () => {
  const { hub, api } = setup();
  const events = [];
  const a = hub.createSession((x) => events.push(x));
  await hub.request(a, 'subscribe', { windowId: 1 });
  let oldReply;
  let count = 0;
  api.tabs.query = async () =>
    ++count === 1
      ? new Promise((resolve) => {
          oldReply = resolve;
        })
      : [{ id: 9, url: 'https://msjc.instructure.com/courses/50618/pages/latest' }];
  const old = hub.updateWindow(1);
  await new Promise((r) => setImmediate(r));
  await hub.updateWindow(1);
  oldReply([{ id: 8, url: 'https://msjc.instructure.com/courses/50427/pages/older' }]);
  await old;
  assert.equal(a.context.courseId, '50618');
  assert.deepEqual(
    events.filter((x) => x.event === 'context').map((x) => x.data.courseId),
    ['50618'],
  );
});

test('panel heartbeat responds without reading or writing IndexedDB', async () => {
  const api = {
    runtime: { onConnect: listener() },
    tabs: { onActivated: listener(), onUpdated: listener(), onRemoved: listener() },
  };
  const hub = createBackgroundHub(api, {});
  assert.equal(
    await hub.request(
      hub.createSession(() => {}),
      'ping',
    ),
    true,
  );
});

test('same-tab navigation updates current-source context and invalidates source revision', async () => {
  const { hub, setActive } = setup();
  const owner = hub.createSession(() => {});
  await hub.request(owner, 'subscribe', { windowId: 1 });
  const previous = owner.sourceRevision;
  setActive({
    id: 7,
    windowId: 1,
    active: true,
    url: 'https://msjc.instructure.com/courses/50427/pages/next-lecture',
  });
  await hub.updateWindow(1);
  assert.ok(owner.sourceRevision > previous);
  assert.match(owner.context.url, /next-lecture/);
});

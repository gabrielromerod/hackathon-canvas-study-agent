import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB, deleteDB } from 'idb';
import { openRepository } from '../src/storage/repository.js';

test('persists a thread scope separately from source browsing and snapshots each message scope', async (t) => {
  const { repository, connect } = await setup(t);
  const initial = await repository.getChatState('101');
  const id = initial.activeThreadId;
  await repository.setScope('101', id, {
    kind: 'section',
    moduleId: '5',
    sectionId: '8',
    label: 'Getting started',
  });
  await repository.appendMessage('101', 'First', 'msg-1', id);
  await repository.setSelection('101', { moduleId: '9', selectedItemId: '7' });
  await repository.setScope('101', id, {
    kind: 'page',
    moduleId: '5',
    itemId: '12',
    label: 'Functions',
  });
  await repository.appendMessage('101', 'Second', 'msg-2', id);
  repository.close();
  const restored = await connect();
  const chat = await restored.getChatState('101');
  const thread = chat.threads.find((x) => x.id === id);
  assert.equal(thread.scope.kind, 'page');
  assert.equal(thread.messages[0].scope.sectionId, '8');
  assert.equal(thread.messages[1].scope.itemId, '12');
  assert.equal((await restored.getCourse('101')).selection.moduleId, '9');
  const next = await restored.newChat('101');
  assert.deepEqual(next.threads.find((x) => x.id === next.activeThreadId).scope, {
    kind: 'current',
    label: 'This tab',
  });
  await assert.rejects(restored.setScope('101', id, { kind: 'page' }), /scope/i);
});

async function setup(t) {
  const name = `repository-test-${crypto.randomUUID()}`;
  const connections = [];
  const connect = async () => {
    const repository = await openRepository(name);
    connections.push(repository);
    return repository;
  };
  t.after(async () => {
    for (const connection of connections) connection.close();
    await deleteDB(name);
  });
  return { name, connect, repository: await connect() };
}

test('restores course cache, selection, and per-window preference after closing the database', async (t) => {
  const { repository, connect } = await setup(t);
  assert.deepEqual(await repository.getCourse('101'), {
    courseId: '101',
    generation: 0,
    snapshot: null,
    selection: null,
    updatedAt: null,
  });
  assert.equal(await repository.getLastCourse(7), null);
  await repository.setLastCourse(7, '101');
  await repository.setSelection('101', { moduleIds: ['5'], itemIds: ['8'] });
  const generation = await repository.beginImport('101');
  const snapshot = { courseName: 'Calculus', modules: [{ id: '5', items: [] }] };
  const before = Date.now();
  assert.equal(await repository.saveSnapshot('101', generation, snapshot), true);
  repository.close();
  const restored = await connect();
  const course = await restored.getCourse('101');
  assert.equal(course.generation, 1);
  assert.deepEqual(course.snapshot, snapshot);
  assert.deepEqual(course.selection, { moduleIds: ['5'], itemIds: ['8'] });
  assert.ok(course.updatedAt >= before && course.updatedAt <= Date.now());
  assert.equal(await restored.getLastCourse(7), '101');
  assert.equal(await restored.getLastCourse(8), null);
  assert.equal((await restored.getCourse('102')).snapshot, null);
});

test('serializes import generations across connections and rejects stale snapshot writes', async (t) => {
  const { repository, connect } = await setup(t);
  const other = await connect();
  const original = await repository.beginImport('101');
  await repository.saveSnapshot('101', original, { version: 'old' });
  await repository.setSelection('101', ['selected']);
  const generations = await Promise.all([
    repository.beginImport('101'),
    other.beginImport('101'),
    repository.beginImport('101'),
  ]);
  assert.deepEqual([...generations].sort(), [2, 3, 4]);
  assert.deepEqual((await other.getCourse('101')).snapshot, { version: 'old' });
  assert.deepEqual((await other.getCourse('101')).selection, ['selected']);
  assert.equal(await other.saveSnapshot('101', 3, { version: 'stale' }), false);
  assert.equal(await repository.saveSnapshot('101', 4, { version: 'current' }), true);
  assert.equal(await other.saveSnapshot('101', 2, { version: 'late' }), false);
  assert.deepEqual((await other.getCourse('101')).snapshot, { version: 'current' });
  assert.equal((await repository.getCourse('102')).generation, 0);
});

test('upgrades an older course database by adding missing stores without discarding its cache', async (t) => {
  const name = `repository-upgrade-${crypto.randomUUID()}`;
  const old = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('courses', { keyPath: 'courseId' });
    },
  });
  await old.put('courses', {
    courseId: '101',
    generation: 5,
    snapshot: { saved: true },
    selection: ['a'],
    updatedAt: 123,
  });
  old.close();
  const repository = await openRepository(name);
  t.after(async () => {
    repository.close();
    await deleteDB(name);
  });
  assert.deepEqual((await repository.getCourse('101')).snapshot, { saved: true });
  await repository.setLastCourse(9, '101');
  assert.equal(await repository.getLastCourse(9), '101');
  assert.equal((await repository.getChatState('101')).threads.length, 1);
});

test('read-only course and preference lookups do not create persistent placeholder records', async (t) => {
  const { repository, name } = await setup(t);
  await repository.getCourse('missing');
  await repository.getLastCourse(99);
  const inspector = await openDB(name);
  try {
    assert.equal(await inspector.count('courses'), 0);
    assert.equal(await inspector.count('preferences'), 0);
  } finally {
    inspector.close();
  }
});

test('restores conversations and their drafts while reusing an empty active conversation', async (t) => {
  const { repository, connect } = await setup(t);
  const initial = await repository.getChatState('101');
  const thread = initial.threads[0];
  assert.equal(initial.activeThreadId, thread.id);
  assert.equal(thread.title, 'New chat');
  assert.deepEqual(thread.messages, []);
  assert.equal(thread.draft, '');
  assert.equal(typeof thread.createdAt, 'number');
  assert.equal(typeof thread.updatedAt, 'number');
  assert.equal(await repository.setDraft('101', thread.id, 'unsent\n  notes'), undefined);
  for (let i = 0; i < 4; i++) {
    const reused = await repository.newChat('101');
    assert.equal(reused.threads.length, 1);
    assert.equal(reused.activeThreadId, thread.id);
    assert.equal(reused.threads[0].draft, 'unsent\n  notes');
  }
  const sent = await repository.appendMessage(
    '101',
    '  Explain chapter one\nwith examples.  ',
    'message-1',
  );
  assert.equal(sent.threads[0].messages[0].text, 'Explain chapter one\nwith examples.');
  assert.equal(sent.threads[0].messages[0].id, 'message-1');
  assert.equal(typeof sent.threads[0].messages[0].createdAt, 'number');
  assert.equal(sent.threads[0].title, 'Explain chapter one\nwith examples.');
  assert.equal(sent.threads[0].draft, '');
  const next = await repository.newChat('101');
  assert.equal(next.threads.length, 2);
  assert.notEqual(next.activeThreadId, thread.id);
  await repository.setDraft('101', next.activeThreadId, 'next draft');
  repository.close();
  const restored = await connect();
  const restoredState = await restored.getChatState('101');
  assert.equal(restoredState.activeThreadId, next.activeThreadId);
  assert.equal(restoredState.threads[1].draft, 'next draft');
  assert.deepEqual(restoredState.threads[0].messages, sent.threads[0].messages);
  const selected = await restored.selectThread('101', thread.id);
  assert.equal(selected.activeThreadId, thread.id);
  assert.equal(
    selected.threads.find((item) => item.id === next.activeThreadId).draft,
    'next draft',
  );
  assert.equal(selected.threads[0].messages.length, 1);
});

test('keeps chat state isolated from other courses and replacement imports', async (t) => {
  const { repository } = await setup(t);
  const first = await repository.appendMessage('101', 'saved conversation', 'shared-id');
  const second = await repository.appendMessage('102', 'another course', 'shared-id');
  const before = await repository.getChatState('101');
  const generation = await repository.beginImport('101');
  await repository.saveSnapshot('101', generation, { modules: [] });
  assert.deepEqual(await repository.getChatState('101'), before);
  assert.equal(second.threads[0].messages[0].text, 'another course');
  await assert.rejects(repository.selectThread('102', first.activeThreadId), /thread/i);
  await assert.rejects(repository.setDraft('102', first.activeThreadId, 'wrong course'), /thread/i);
  await assert.rejects(
    repository.appendMessage('102', 'wrong course', 'other-id', first.activeThreadId),
    /thread/i,
  );
  assert.deepEqual(await repository.getChatState('102'), second);
});

test('saves late drafts and messages into their target conversation without switching the active one', async (t) => {
  const { repository, connect } = await setup(t);
  const other = await connect();
  const first = await repository.appendMessage('101', 'first', 'first-message');
  const second = await other.newChat('101');
  await repository.setDraft('101', first.activeThreadId, 'late draft');
  await repository.appendMessage('101', 'late send', 'late-message', first.activeThreadId);
  const final = await other.getChatState('101');
  assert.equal(final.activeThreadId, second.activeThreadId);
  assert.deepEqual(
    final.threads[0].messages.map((message) => message.text),
    ['first', 'late send'],
  );
  assert.equal(final.threads[0].draft, '');
  assert.deepEqual(final.threads[1].messages, []);
});

test('serializes concurrent appends and deduplicates message IDs across connections and conversation changes', async (t) => {
  const { repository, connect } = await setup(t);
  const other = await connect();
  await Promise.all([
    repository.appendMessage('101', 'first', '1'),
    other.appendMessage('101', 'second', '2'),
    repository.appendMessage('101', 'first retry', '1'),
    other.appendMessage('101', 'third', '3'),
  ]);
  const state = await repository.getChatState('101');
  assert.equal(state.threads.length, 1);
  assert.deepEqual(
    state.threads[0].messages.map((message) => message.id),
    ['1', '2', '3'],
  );
  assert.equal(state.threads[0].messages[0].text, 'first');
  const next = await repository.newChat('101');
  await repository.setDraft('101', next.activeThreadId, 'preserved draft');
  const retry = await other.appendMessage('101', 'first retry', '1');
  assert.equal(retry.threads[1].messages.length, 0);
  assert.equal(retry.threads[1].draft, 'preserved draft');
});

test('rejects empty messages and preserves complete long message content with a short derived title', async (t) => {
  const { repository } = await setup(t);
  await assert.rejects(repository.appendMessage('101', ' \n\t '), /empty/i);
  const text = 'A'.repeat(150_000) + '\n  final paragraph';
  const state = await repository.appendMessage('101', `  ${text}\n `);
  assert.equal(state.threads[0].messages[0].text, text);
  assert.equal(state.threads[0].title, 'A'.repeat(60));
  assert.ok(state.threads[0].messages[0].id);
  await repository.appendMessage('101', 'second message');
  assert.equal((await repository.getChatState('101')).threads[0].title, 'A'.repeat(60));
});

test('propagates failed writes without committing a partial snapshot or message', async (t) => {
  const { repository } = await setup(t);
  const generation = await repository.beginImport('101');
  await repository.saveSnapshot('101', generation, { original: true });
  await assert.rejects(repository.saveSnapshot('101', generation, { uncloneable() {} }), {
    name: 'DataCloneError',
  });
  assert.deepEqual((await repository.getCourse('101')).snapshot, { original: true });
  const before = await repository.appendMessage('101', 'saved', 'saved-id');
  const originalPut = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'chats') throw new DOMException('Disk is full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    };
    await assert.rejects(repository.appendMessage('101', 'cannot save', 'failed-id'), {
      name: 'QuotaExceededError',
    });
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await repository.getChatState('101'), before);
});

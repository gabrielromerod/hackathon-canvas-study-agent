import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { openRepository } from '../src/storage/repository.js';

async function setup(t) {
  const name = `turn-repository-${crypto.randomUUID()}`;
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
  const repository = await connect();
  const chat = await repository.getChatState('101');
  return { repository, connect, threadId: chat.activeThreadId };
}

function request(threadId, overrides = {}) {
  return {
    threadId,
    turnId: 'turn-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
    text: '  Explain the first chapter.  ',
    modelId: 'local-e2b',
    sourceRefs: [{ moduleId: '5', itemId: '8', title: 'First chapter' }],
    memoryRefs: [{ threadId: 'older-thread', messageId: 'older-message' }],
    ...overrides,
  };
}

function threadIn(chat, threadId) {
  return chat.threads.find((thread) => thread.id === threadId);
}

test('beginTurn atomically creates a user message and streaming assistant with frozen source context', async (t) => {
  const { repository, threadId } = await setup(t);
  await repository.setScope('101', threadId, {
    kind: 'page',
    moduleId: '5',
    itemId: '8',
    label: 'First chapter',
  });
  await repository.setDraft('101', threadId, 'draft to clear');
  const input = request(threadId);
  const begun = await repository.beginTurn('101', input);
  assert.equal(begun.started, true);
  assert.deepEqual(begun.token, {
    turnId: 'turn-1',
    attempt: 1,
    assistantMessageId: 'assistant-1',
  });
  const thread = threadIn(begun.chat, threadId);
  const [user, assistant] = thread.messages;
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.title, 'Explain the first chapter.');
  assert.equal(thread.draft, '');
  assert.equal(user.id, 'user-1');
  assert.equal(user.role, 'user');
  assert.equal(user.text, 'Explain the first chapter.');
  assert.equal(assistant.id, 'assistant-1');
  assert.equal(assistant.role, 'assistant');
  assert.equal(assistant.text, '');
  assert.equal(assistant.status, 'streaming');
  assert.equal(assistant.modelId, 'local-e2b');
  assert.deepEqual(assistant.sourceRefs, input.sourceRefs);
  assert.deepEqual(assistant.memoryRefs, input.memoryRefs);
  assert.deepEqual(user.scope, {
    kind: 'page',
    moduleId: '5',
    itemId: '8',
    label: 'First chapter',
  });
  assert.deepEqual(assistant.scope, user.scope);
  assert.equal(typeof assistant.createdAt, 'number');
  await repository.setScope('101', threadId, { kind: 'course' });
  input.sourceRefs[0].title = 'Changed later';
  const restored = threadIn(await repository.getChatState('101'), threadId);
  assert.equal(restored.messages[1].scope.kind, 'page');
  assert.equal(restored.messages[1].sourceRefs[0].title, 'First chapter');
});

test('repeated beginTurn with the same turn ID cannot duplicate messages or acquire another run', async (t) => {
  const { repository, threadId } = await setup(t);
  const first = await repository.beginTurn('101', request(threadId));
  const duplicate = await repository.beginTurn('101', request(threadId));
  assert.equal(duplicate.started, false);
  assert.deepEqual(duplicate.token, first.token);
  assert.deepEqual(duplicate.chat, first.chat);
});

test('two repository connections cannot begin competing turns in the same conversation', async (t) => {
  const { repository, connect, threadId } = await setup(t);
  const other = await connect();
  const results = await Promise.all([
    repository.beginTurn('101', request(threadId)),
    other.beginTurn(
      '101',
      request(threadId, {
        turnId: 'turn-2',
        userMessageId: 'user-2',
        assistantMessageId: 'assistant-2',
      }),
    ),
  ]);
  assert.equal(results.filter((result) => result.started).length, 1);
  const messages = threadIn(await repository.getChatState('101'), threadId).messages;
  assert.equal(messages.length, 2);
  assert.equal(messages.filter((message) => message.role === 'user').length, 1);
  assert.equal(messages.filter((message) => message.role === 'assistant').length, 1);
});

test('checkpointTurn accepts cumulative text in sequence and rejects delayed or duplicate checkpoints', async (t) => {
  const { repository, connect, threadId } = await setup(t);
  const other = await connect();
  const { token } = await repository.beginTurn('101', request(threadId));
  const current = await other.checkpointTurn('101', {
    threadId,
    ...token,
    sequence: 2,
    text: '  Current answer\n\n```js\n  const x = 1;\n```\n',
  });
  assert.equal(current.saved, true);
  assert.equal(
    (
      await repository.checkpointTurn('101', {
        threadId,
        ...token,
        sequence: 1,
        text: 'Outdated answer',
      })
    ).saved,
    false,
  );
  assert.equal(
    (
      await repository.checkpointTurn('101', {
        threadId,
        ...token,
        sequence: 2,
        text: 'Duplicate answer',
      })
    ).saved,
    false,
  );
  const message = threadIn(await repository.getChatState('101'), threadId).messages[1];
  assert.equal(message.text, '  Current answer\n\n```js\n  const x = 1;\n```\n');
  assert.equal(message.status, 'streaming');
});

test('finishTurn preserves the full answer after database reopen and rejects later streaming writes', async (t) => {
  const { repository, connect, threadId } = await setup(t);
  const { token } = await repository.beginTurn('101', request(threadId));
  const text = '  ' + 'A'.repeat(150_000) + '\n\nFinal paragraph.\n';
  assert.equal(
    (
      await repository.finishTurn('101', {
        threadId,
        ...token,
        sequence: 1,
        text,
        status: 'complete',
      })
    ).saved,
    true,
  );
  repository.close();
  const restored = await connect();
  const message = threadIn(await restored.getChatState('101'), threadId).messages[1];
  assert.equal(message.text, text);
  assert.equal(message.status, 'complete');
  assert.equal(
    (
      await restored.checkpointTurn('101', {
        threadId,
        ...token,
        sequence: 2,
        text: 'Late fragment',
      })
    ).saved,
    false,
  );
  assert.equal(threadIn(await restored.getChatState('101'), threadId).messages[1].text, text);
});

test('cancellation preserves the last checkpoint and fences all later turn writes', async (t) => {
  const { repository, threadId } = await setup(t);
  const { token } = await repository.beginTurn('101', request(threadId));
  await repository.checkpointTurn('101', {
    threadId,
    ...token,
    sequence: 1,
    text: 'Partial answer',
  });
  assert.equal(
    (
      await repository.finishTurn('101', {
        threadId,
        ...token,
        sequence: 2,
        status: 'cancelled',
        error: 'Stopped by user',
      })
    ).saved,
    true,
  );
  assert.equal(
    (
      await repository.checkpointTurn('101', {
        threadId,
        ...token,
        sequence: 3,
        text: 'Arrived after cancellation',
      })
    ).saved,
    false,
  );
  assert.equal(
    (
      await repository.finishTurn('101', {
        threadId,
        ...token,
        sequence: 4,
        text: 'Late completion',
        status: 'complete',
      })
    ).saved,
    false,
  );
  const assistant = threadIn(await repository.getChatState('101'), threadId).messages[1];
  assert.equal(assistant.text, 'Partial answer');
  assert.equal(assistant.status, 'cancelled');
  assert.equal(assistant.error, 'Stopped by user');
});

test('retryTurn keeps the user and failed answer, increments the attempt, and fences the old attempt', async (t) => {
  const { repository, threadId } = await setup(t);
  const { token } = await repository.beginTurn('101', request(threadId));
  await repository.finishTurn('101', {
    threadId,
    ...token,
    sequence: 1,
    text: 'Partial failed answer',
    status: 'error',
    error: 'Local inference stopped',
  });
  const retry = await repository.retryTurn('101', {
    threadId,
    turnId: 'turn-1',
    expectedAttempt: 1,
    assistantMessageId: 'assistant-retry',
  });
  assert.equal(retry.started, true);
  assert.deepEqual(retry.token, {
    turnId: 'turn-1',
    attempt: 2,
    assistantMessageId: 'assistant-retry',
  });
  const messages = threadIn(retry.chat, threadId).messages;
  assert.deepEqual(
    messages.map((message) => message.id),
    ['user-1', 'assistant-1', 'assistant-retry'],
  );
  assert.equal(messages.filter((message) => message.role === 'user').length, 1);
  assert.equal(messages[1].text, 'Partial failed answer');
  assert.equal(messages[1].status, 'error');
  assert.equal(messages[2].status, 'streaming');
  assert.equal(
    (
      await repository.checkpointTurn('101', {
        threadId,
        ...token,
        sequence: 99,
        text: 'Old attempt fragment',
      })
    ).saved,
    false,
  );
  assert.equal(
    (
      await repository.finishTurn('101', {
        threadId,
        ...token,
        sequence: 100,
        text: 'Old completion',
        status: 'complete',
      })
    ).saved,
    false,
  );
  assert.equal(
    (
      await repository.retryTurn('101', {
        threadId,
        turnId: 'turn-1',
        expectedAttempt: 1,
        assistantMessageId: 'duplicate-retry',
      })
    ).started,
    false,
  );
  await repository.finishTurn('101', {
    threadId,
    ...retry.token,
    sequence: 1,
    text: 'Successful retry',
    status: 'complete',
  });
  assert.equal(
    threadIn(await repository.getChatState('101'), threadId).messages[2].text,
    'Successful retry',
  );
});

test('an earlier completed turn cannot overwrite a newer turn in the same conversation', async (t) => {
  const { repository, threadId } = await setup(t);
  const first = await repository.beginTurn('101', request(threadId));
  await repository.finishTurn('101', {
    threadId,
    ...first.token,
    sequence: 1,
    text: 'First answer',
    status: 'complete',
  });
  const second = await repository.beginTurn(
    '101',
    request(threadId, {
      turnId: 'turn-2',
      userMessageId: 'user-2',
      assistantMessageId: 'assistant-2',
      text: 'Next question',
    }),
  );
  assert.equal(second.started, true);
  assert.equal(
    (
      await repository.checkpointTurn('101', {
        threadId,
        ...first.token,
        sequence: 100,
        text: 'Stale first answer',
      })
    ).saved,
    false,
  );
  const messages = threadIn(await repository.getChatState('101'), threadId).messages;
  assert.equal(messages[1].text, 'First answer');
  assert.equal(messages[3].text, '');
});

test('turn checkpoints stay in their explicit conversation when the active conversation changes', async (t) => {
  const { repository, threadId } = await setup(t);
  const { token } = await repository.beginTurn('101', request(threadId));
  const next = await repository.newChat('101');
  await repository.checkpointTurn('101', {
    threadId,
    ...token,
    sequence: 1,
    text: 'Targeted answer',
  });
  const state = await repository.getChatState('101');
  assert.equal(state.activeThreadId, next.activeThreadId);
  assert.equal(threadIn(state, threadId).messages[1].text, 'Targeted answer');
  assert.deepEqual(threadIn(state, next.activeThreadId).messages, []);
});

test('turn creation rejects another course thread and leaves both course conversations untouched', async (t) => {
  const { repository, threadId } = await setup(t);
  const firstBefore = await repository.getChatState('101');
  const secondBefore = await repository.getChatState('102');
  await assert.rejects(repository.beginTurn('102', request(threadId)), /thread/i);
  assert.deepEqual(await repository.getChatState('101'), firstBefore);
  assert.deepEqual(await repository.getChatState('102'), secondBefore);
});

test('legacy user messages and existing conversations survive turn creation and replacement imports', async (t) => {
  const { repository, threadId } = await setup(t);
  await repository.appendMessage('101', 'Legacy note', 'legacy-message', threadId);
  const legacy = threadIn(await repository.getChatState('101'), threadId).messages[0];
  assert.equal(legacy.role ?? 'user', 'user');
  const begun = await repository.beginTurn('101', request(threadId));
  const generation = await repository.beginImport('101');
  await repository.saveSnapshot('101', generation, { modules: [] });
  const restored = await repository.getChatState('101');
  assert.deepEqual(threadIn(restored, threadId).messages[0], legacy);
  assert.deepEqual(restored, begun.chat);
});

test('quota errors cannot commit half a turn or replace the last persisted checkpoint', async (t) => {
  const { repository, threadId } = await setup(t);
  const before = await repository.getChatState('101');
  const originalPut = IDBObjectStore.prototype.put;
  const denyChatWrites = function (...args) {
    if (this.name === 'chats') throw new DOMException('Disk is full', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try {
    IDBObjectStore.prototype.put = denyChatWrites;
    await assert.rejects(repository.beginTurn('101', request(threadId)), {
      name: 'QuotaExceededError',
    });
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await repository.getChatState('101'), before);
  const { token } = await repository.beginTurn('101', request(threadId));
  await repository.checkpointTurn('101', {
    threadId,
    ...token,
    sequence: 1,
    text: 'Saved partial',
  });
  try {
    IDBObjectStore.prototype.put = denyChatWrites;
    await assert.rejects(
      repository.checkpointTurn('101', {
        threadId,
        ...token,
        sequence: 2,
        text: 'Cannot save',
      }),
      { name: 'QuotaExceededError' },
    );
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.equal(
    threadIn(await repository.getChatState('101'), threadId).messages[1].text,
    'Saved partial',
  );
});

test('a retry records newly retrieved references while preserving the original scope and question', async (t) => {
  const { repository, threadId } = await setup(t);
  const started = await repository.beginTurn('101', request(threadId));
  await repository.finishTurn('101', {
    threadId,
    ...started.token,
    sequence: 1,
    status: 'error',
    text: 'partial',
  });
  const retried = await repository.retryTurn('101', {
    threadId,
    turnId: 'turn-1',
    expectedAttempt: 1,
    assistantMessageId: 'retry-ref',
    sourceRefs: [{ id: 'S1', title: 'Updated passage' }],
    memoryRefs: [],
  });
  assert.deepEqual(retried.chat.threads[0].messages.at(-1).sourceRefs, [
    { id: 'S1', title: 'Updated passage' },
  ]);
  assert.equal(
    retried.chat.threads[0].messages.filter((message) => message.role === 'user').length,
    1,
  );
});

test('live-tab turns freeze the resolved source while the chat keeps following This tab', async (t) => {
  const { repository, threadId } = await setup(t);
  await repository.setScope('101', threadId, { kind: 'current' });
  const result = await repository.beginTurn(
    '101',
    request(threadId, { scope: { kind: 'page', moduleId: '5', itemId: '8', label: 'Slope' } }),
  );
  assert.equal(result.chat.threads[0].scope.kind, 'current');
  assert.equal(result.chat.threads[0].messages[0].scope.kind, 'page');
  assert.equal(result.chat.threads[0].messages[1].scope.itemId, '8');
});

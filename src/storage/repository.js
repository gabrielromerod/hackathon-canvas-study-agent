import { openDB } from 'idb';
import { normalizeScope } from '../chat/scope.js';

const VERSION = 2;

function emptyCourse(courseId) {
  return { courseId, generation: 0, snapshot: null, selection: null, updatedAt: null };
}

function emptyThread() {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    draft: '',
    scope: { kind: 'current', label: 'This tab' },
  };
}

function emptyChat(courseId) {
  const thread = emptyThread();
  return { courseId, threads: [thread], activeThreadId: thread.id };
}

function chatState(record) {
  return { threads: record.threads, activeThreadId: record.activeThreadId };
}

function findThread(record, threadId) {
  const thread = record.threads.find((entry) => entry.id === threadId);
  if (!thread) throw new Error('Chat thread does not exist in this course.');
  return thread;
}

function turnToken(message) {
  return {
    turnId: message.turnId,
    attempt: message.attempt,
    assistantMessageId: message.id,
  };
}

function assistantMessage(payload, scope, attempt, now) {
  return {
    id: payload.assistantMessageId,
    role: 'assistant',
    turnId: payload.turnId,
    attempt,
    sequence: 0,
    text: '',
    status: 'streaming',
    createdAt: now,
    updatedAt: now,
    scope: normalizeScope(scope),
    modelId: payload.modelId ?? null,
    sourceRefs: payload.sourceRefs ?? [],
    memoryRefs: payload.memoryRefs ?? [],
  };
}

function requireMessageId(record, id) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('A message ID is required.');
  if (record.threads.some((thread) => thread.messages.some((message) => message.id === id))) {
    throw new Error('This message ID already exists in the course.');
  }
}

function writeTurn(record, payload, terminal = false) {
  const thread = findThread(record, payload.threadId);
  const token = thread.activeTurn;
  const message = thread.messages.find((entry) => entry.id === payload.assistantMessageId);
  if (
    !token ||
    token.turnId !== payload.turnId ||
    token.attempt !== payload.attempt ||
    token.assistantMessageId !== payload.assistantMessageId ||
    !message ||
    message.role !== 'assistant' ||
    message.status !== 'streaming' ||
    !Number.isSafeInteger(payload.sequence) ||
    payload.sequence <= message.sequence
  )
    return { saved: false, chat: chatState(record) };
  if (!terminal && typeof payload.text !== 'string')
    throw new Error('Checkpoint text is required.');
  if (payload.text !== undefined && typeof payload.text !== 'string')
    throw new Error('Invalid assistant text.');
  if (terminal && !['complete', 'error', 'cancelled'].includes(payload.status)) {
    throw new Error('Invalid terminal turn status.');
  }
  const now = Date.now();
  if (payload.text !== undefined) message.text = payload.text;
  message.sequence = payload.sequence;
  message.updatedAt = now;
  thread.updatedAt = now;
  if (terminal) {
    message.status = payload.status;
    if (payload.error !== undefined) message.error = String(payload.error);
    thread.activeTurn = null;
  }
  return { saved: true, chat: chatState(record) };
}

export async function openRepository(name = 'canvas-study-agent') {
  const db = await openDB(name, VERSION, {
    upgrade(database) {
      for (const [store, keyPath] of [
        ['courses', 'courseId'],
        ['chats', 'courseId'],
        ['preferences', 'windowId'],
      ]) {
        if (!database.objectStoreNames.contains(store))
          database.createObjectStore(store, { keyPath });
      }
    },
    blocking() {
      db.close();
    },
  });

  // The read and write share one transaction, so separate worker connections
  // cannot overwrite each other's changes after reading the same old record.
  async function update(store, key, initial, change, shouldWrite = () => true) {
    const transaction = db.transaction(store, 'readwrite');
    try {
      const record = (await transaction.store.get(key)) ?? initial(key);
      const result = change(record);
      if (shouldWrite(result)) await transaction.store.put(record);
      await transaction.done;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        /* Transaction may already have aborted. */
      }
      await transaction.done.catch(() => {});
      throw error;
    }
  }

  return {
    close() {
      db.close();
    },

    async getCourse(courseId) {
      return (await db.get('courses', courseId)) ?? emptyCourse(courseId);
    },

    beginImport(courseId) {
      return update('courses', courseId, emptyCourse, (course) => ++course.generation);
    },

    saveSnapshot(courseId, generation, snapshot) {
      return update('courses', courseId, emptyCourse, (course) => {
        if (course.generation !== generation) return false;
        course.snapshot = snapshot;
        course.updatedAt = Date.now();
        return true;
      });
    },

    async setSelection(courseId, selection) {
      await update('courses', courseId, emptyCourse, (course) => {
        course.selection = selection;
      });
    },

    async getChatState(courseId) {
      const existing = await db.get('chats', courseId);
      if (existing) return chatState(existing);
      return update('chats', courseId, emptyChat, chatState);
    },

    beginTurn(courseId, payload) {
      return update(
        'chats',
        courseId,
        emptyChat,
        (record) => {
          const thread = findThread(record, payload.threadId);
          const previous = thread.messages.findLast(
            (message) => message.role === 'assistant' && message.turnId === payload.turnId,
          );
          if (previous || thread.activeTurn) {
            return {
              started: false,
              token: previous ? turnToken(previous) : thread.activeTurn,
              chat: chatState(record),
            };
          }
          if (typeof payload.turnId !== 'string' || !payload.turnId.trim())
            throw new Error('A turn ID is required.');
          if (typeof payload.text !== 'string' || !payload.text.trim())
            throw new Error('Cannot save an empty message.');
          requireMessageId(record, payload.userMessageId);
          requireMessageId(record, payload.assistantMessageId);
          if (payload.userMessageId === payload.assistantMessageId)
            throw new Error('Turn message IDs must differ.');
          const text = payload.text.trim();
          const now = Date.now();
          const scope = normalizeScope(payload.scope ?? thread.scope);
          const assistant = assistantMessage(payload, scope, 1, now);
          if (!thread.messages.length) thread.title = text.slice(0, 60);
          thread.messages.push(
            {
              id: payload.userMessageId,
              role: 'user',
              turnId: payload.turnId,
              text,
              createdAt: now,
              scope,
            },
            assistant,
          );
          thread.draft = '';
          thread.updatedAt = now;
          thread.activeTurn = turnToken(assistant);
          return { started: true, token: thread.activeTurn, chat: chatState(record) };
        },
        (result) => result.started,
      );
    },

    checkpointTurn(courseId, payload) {
      return update(
        'chats',
        courseId,
        emptyChat,
        (record) => writeTurn(record, payload),
        (result) => result.saved,
      );
    },

    finishTurn(courseId, payload) {
      return update(
        'chats',
        courseId,
        emptyChat,
        (record) => writeTurn(record, payload, true),
        (result) => result.saved,
      );
    },

    retryTurn(courseId, payload) {
      return update(
        'chats',
        courseId,
        emptyChat,
        (record) => {
          const thread = findThread(record, payload.threadId);
          const previous = thread.messages.findLast(
            (message) => message.role === 'assistant' && message.turnId === payload.turnId,
          );
          const lastUser = thread.messages.findLast(
            (message) => (message.role ?? 'user') === 'user',
          );
          if (
            thread.activeTurn ||
            !previous ||
            previous.attempt !== payload.expectedAttempt ||
            !['error', 'cancelled'].includes(previous.status) ||
            lastUser?.turnId !== payload.turnId
          )
            return {
              started: false,
              token: previous ? turnToken(previous) : null,
              chat: chatState(record),
            };
          requireMessageId(record, payload.assistantMessageId);
          const now = Date.now();
          const assistant = assistantMessage(
            {
              ...previous,
              assistantMessageId: payload.assistantMessageId,
              sourceRefs: payload.sourceRefs ?? previous.sourceRefs,
              memoryRefs: payload.memoryRefs ?? previous.memoryRefs,
            },
            previous.scope,
            previous.attempt + 1,
            now,
          );
          thread.messages.push(assistant);
          thread.updatedAt = now;
          thread.activeTurn = turnToken(assistant);
          return { started: true, token: thread.activeTurn, chat: chatState(record) };
        },
        (result) => result.started,
      );
    },

    recoverInterruptedTurns(courseId) {
      let changed = false;
      // The worker calls this only after establishing that no live run owns the course.
      return update(
        'chats',
        courseId,
        emptyChat,
        (record) => {
          const now = Date.now();
          for (const thread of record.threads) {
            let interrupted = Boolean(thread.activeTurn);
            for (const message of thread.messages) {
              if (message.role !== 'assistant' || message.status !== 'streaming') continue;
              message.status = 'cancelled';
              message.error = 'Local generation was interrupted. Retry to continue.';
              message.updatedAt = now;
              interrupted = true;
            }
            if (interrupted) {
              thread.activeTurn = null;
              thread.updatedAt = now;
              changed = true;
            }
          }
          return chatState(record);
        },
        () => changed,
      );
    },

    newChat(courseId) {
      return update('chats', courseId, emptyChat, (record) => {
        const active = findThread(record, record.activeThreadId);
        if (active.messages.length) {
          const next = emptyThread();
          record.threads.push(next);
          record.activeThreadId = next.id;
        }
        return chatState(record);
      });
    },

    selectThread(courseId, threadId) {
      return update('chats', courseId, emptyChat, (record) => {
        findThread(record, threadId);
        record.activeThreadId = threadId;
        return chatState(record);
      });
    },

    setScope(courseId, threadId, scope) {
      return update('chats', courseId, emptyChat, (record) => {
        findThread(record, threadId).scope = normalizeScope(scope);
        return chatState(record);
      });
    },

    async appendMessage(courseId, text, messageId = crypto.randomUUID(), threadId = null) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('Cannot save an empty message.');
      return update('chats', courseId, emptyChat, (record) => {
        const thread = findThread(record, threadId ?? record.activeThreadId);
        if (
          record.threads.some((entry) => entry.messages.some((message) => message.id === messageId))
        ) {
          return chatState(record);
        }
        const now = Date.now();
        if (!thread.messages.length) thread.title = trimmed.slice(0, 60);
        thread.messages.push({
          id: messageId,
          text: trimmed,
          createdAt: now,
          scope: normalizeScope(thread.scope),
        });
        thread.draft = '';
        thread.updatedAt = now;
        return chatState(record);
      });
    },

    async setDraft(courseId, threadId, text) {
      await update('chats', courseId, emptyChat, (record) => {
        const thread = findThread(record, threadId);
        thread.draft = text;
        thread.updatedAt = Date.now();
      });
    },

    async getLastCourse(windowId) {
      return (await db.get('preferences', windowId))?.courseId ?? null;
    },

    async setLastCourse(windowId, courseId) {
      await db.put('preferences', { windowId, courseId });
    },
  };
}

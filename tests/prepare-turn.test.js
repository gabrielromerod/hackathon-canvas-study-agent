import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptPreparer } from '../src/chat/prepare.js';
const tokenizer = {
  countText: (text) => text.length,
  countMessages: (messages) => JSON.stringify(messages).length,
};
const snapshot = {
  courseId: '101',
  courseTitle: 'Math',
  modules: [
    {
      id: '5',
      title: 'Chapter',
      items: [
        {
          id: '8',
          type: 'Page',
          title: 'Slope',
          url: 'https://msjc.instructure.com/courses/101/pages/slope',
          content: {
            status: 'loaded',
            markdown: 'Slope is the change in y divided by change in x.',
          },
        },
      ],
    },
  ],
};
test('retry derives the stored question and scope and does not repeat the question in history', async () => {
  const user = {
    id: 'u',
    role: 'user',
    turnId: 't',
    text: 'Explain slope',
    scope: { kind: 'page', moduleId: '5', itemId: '8', label: 'Slope' },
  };
  const chat = {
    activeThreadId: 'a',
    threads: [
      {
        id: 'a',
        scope: { kind: 'course' },
        messages: [
          user,
          {
            id: 'old',
            role: 'assistant',
            turnId: 't',
            attempt: 1,
            status: 'cancelled',
            text: 'partial',
            scope: user.scope,
          },
        ],
      },
    ],
  };
  const prepare = createPromptPreparer({
    repository: { getCourse: async () => ({ snapshot }), getChatState: async () => chat },
    getTokenizer: async () => tokenizer,
  });
  const result = await prepare({
    courseId: '101',
    threadId: 'a',
    turnId: 't',
    retry: true,
    expectedAttempt: 1,
    text: 'Wrong client question',
  });
  assert.equal(result.messages.at(-1).content, 'Explain slope');
  assert.equal(result.messages.filter((message) => message.content === 'Explain slope').length, 1);
  assert.equal(result.scope.kind, 'page');
  assert.equal(chat.threads[0].messages.length, 2);
});
test('an unavailable snapshot or stale retry fails before inference and leaves saved chat unchanged', async () => {
  const prepare = createPromptPreparer({
    repository: {
      getCourse: async () => ({ snapshot: null }),
      getChatState: async () => ({ threads: [] }),
    },
    getTokenizer: async () => tokenizer,
  });
  await assert.rejects(
    prepare({ courseId: '101', threadId: 'a', text: 'Question' }),
    /read|course|source/i,
  );
});

test('This tab is resolved per turn and never widens an unknown or closed page', async () => {
  const chat = {
    activeThreadId: 'a',
    threads: [{ id: 'a', scope: { kind: 'current', label: 'This tab' }, messages: [] }],
  };
  const prepare = createPromptPreparer({
    repository: { getCourse: async () => ({ snapshot }), getChatState: async () => chat },
    getTokenizer: async () => tokenizer,
  });
  const result = await prepare({
    courseId: '101',
    threadId: 'a',
    text: 'Explain slope',
    context: {
      courseId: '101',
      tabId: 1,
      url: 'https://msjc.instructure.com/courses/101/pages/slope',
    },
  });
  assert.equal(result.scope.kind, 'page');
  assert.equal(result.scope.itemId, '8');
  assert.equal(result.sourceRefs[0].itemId, '8');
  await assert.rejects(
    prepare({
      courseId: '101',
      threadId: 'a',
      text: 'Explain',
      context: {
        courseId: '101',
        tabId: 1,
        url: 'https://msjc.instructure.com/courses/101/unknown',
      },
    }),
    /scope|source|tab/i,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, until } from './fixtures/native-panel-harness.js';
test('ready local AI sends a real turn request, shows partial text, Stop and Retry without duplicating a question', async (t) => {
  let finish, id;
  const model = {
    rpc: async (method, payload, requestId) => {
      if (method === 'generate') {
        id = requestId;
        return new Promise((r) => (finish = r));
      }
      return { phase: 'ready', cached: true };
    },
  };
  const prepare = async ({ text }) => ({
    messages: [
      { role: 'system', content: 'Sources' },
      { role: 'user', content: text },
    ],
    sourceRefs: [],
    memoryRefs: [],
  });
  const { root, window, hub } = await setup(t, { model, prepare });
  await until(() => /Ready/.test(root.querySelector('#model-toggle').textContent));
  const input = root.querySelector('#message-input');
  input.value = 'Explain slopes';
  input.dispatchEvent(new window.Event('input'));
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { cancelable: true }));
  await until(() => id);
  hub.modelEvent('chunk', { text: 'Slope is change' }, id);
  await until(() =>
    root.querySelector('.assistant-message')?.textContent.includes('Slope is change'),
  );
  assert.equal(root.querySelector('#stop-generation').hidden, false);
  root.querySelector('#stop-generation').click();
  finish({ text: 'Unwanted late completion', status: 'stopped' });
  await until(() => root.querySelector('.retry-answer'));
  assert.equal(root.querySelectorAll('.user-message').length, 1);
  assert.doesNotMatch(root.querySelector('.assistant-message').textContent, /Unwanted/);
  assert.match(root.querySelector('#local-notice').textContent, /device|local/i);
});
test('microphone adds local dictation to the editable persisted draft and stops when sources open', async (t) => {
  let recognition,
    stops = 0;
  class Recognition {
    processLocally = false;
    static async available() {
      return 'available';
    }
    constructor() {
      recognition = this;
    }
    start() {
      this.onstart();
    }
    abort() {
      stops++;
    }
    stop() {
      stops++;
    }
  }
  const { root, window, repo } = await setup(t, { SpeechRecognition: Recognition });
  const input = root.querySelector('#message-input');
  input.value = 'My note: ';
  input.dispatchEvent(new window.Event('input'));
  root.querySelector('#dictate-message').click();
  await until(() => recognition);
  recognition.onresult({
    resultIndex: 0,
    results: [Object.assign([{ transcript: 'explain limits' }], { isFinal: true })],
  });
  assert.equal(input.value, 'My note: explain limits');
  root.querySelector('#sources-toggle').click();
  assert.ok(stops > 0);
  await until(async () => {
    const chat = await repo.getChatState('50427');
    return (
      chat.threads.find((t) => t.id === chat.activeThreadId).draft === 'My note: explain limits'
    );
  });
});

test('a cached model still loading keeps the draft and cannot silently save a question without a reply', async (t) => {
  const { root, window, app } = await setup(t);
  app.receive('modelStatus', { phase: 'loading', cached: true });
  const input = root.querySelector('#message-input');
  input.value = 'My actual question';
  input.dispatchEvent(new window.Event('input'));
  assert.equal(root.querySelector('#send-message').disabled, true);
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { cancelable: true }));
  await new Promise((r) => setImmediate(r));
  assert.equal(root.querySelectorAll('.user-message').length, 0);
  assert.equal(input.value, 'My actual question');
});

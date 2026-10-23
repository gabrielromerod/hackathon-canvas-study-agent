import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, until } from './fixtures/native-panel-harness.js';

test('renders course-wide reference shell and Sources with safe module text, Markdown and file links', async (t) => {
  const { root } = await setup(t);
  assert.equal(root.querySelector('h1').textContent, 'Study Agent');
  assert.match(root.querySelector('#course-name').textContent, /MATH/);
  assert.match(root.querySelector('#local-notice').textContent, /Replies are not connected yet/);
  root.querySelector('#sources-toggle').click();
  assert.equal(root.querySelector('#sources-view').hidden, false);
  assert.match(root.querySelector('#source-list').textContent, /Week 1 <script>/);
  assert.equal(root.querySelector('#source-list script'), null);
  assert.match(root.querySelector('.markdown-preview').textContent, /## All concepts/);
  assert.match(root.querySelector('.file-download').href, /files\/33\/download/);
  assert.match(root.querySelector('#source-summary').textContent, /1\/1 pages/);
  root.querySelector('#back-to-chat').click();
  assert.equal(root.querySelector('#sources-view').hidden, true);
});

test('sends and saves local messages without assistant replies; new chat and history restore the old conversation', async (t) => {
  const { root, window, repo } = await setup(t);
  const input = root.querySelector('#message-input');
  input.value = 'I want to review functions <img src=x onerror=alert(1)>';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => root.querySelectorAll('.user-message').length === 1);
  assert.equal(root.querySelector('.user-message img'), null);
  assert.equal(root.querySelectorAll('.assistant-message').length, 0);
  root.querySelector('#new-chat').click();
  await until(() => root.querySelectorAll('.user-message').length === 0);
  root.querySelector('#history-toggle').click();
  await until(() => root.querySelectorAll('.history-item').length === 1);
  root.querySelector('.history-item').click();
  await until(() => root.querySelectorAll('.user-message').length === 1);
  assert.equal(
    (await repo.getChatState('50427')).threads.filter((x) => x.messages.length).length,
    1,
  );
});

test('exports schema3 course data separately from chat and native close uses the correct window', async (t) => {
  const { root, blob, closed } = await setup(t);
  root.querySelector('[data-action="export"]').click();
  await until(() => blob());
  const data = JSON.parse(await blob().text());
  assert.equal(data.schemaVersion, 3);
  assert.equal(data.summary.pages.loaded, 1);
  assert.equal(data.summary.files.available, 1);
  assert.equal(data.messages, undefined);
  root.querySelector('#close-panel').click();
  await until(() => closed());
  assert.deepEqual(closed(), { windowId: 1 });
});

test('Shift+Enter and IME composition do not send; a normal Enter sends and drafts persist', async (t) => {
  const { root, window, repo } = await setup(t);
  const input = root.querySelector('#message-input');
  input.value = 'Remember the limits';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }),
  );
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
  );
  await until(async () => true);
  assert.equal(root.querySelectorAll('.user-message').length, 0);
  await until(() => root.querySelector('#send-message').disabled === false);
  const chat = await repo.getChatState('50427');
  assert.equal(chat.threads.find((x) => x.id === chat.activeThreadId).draft, 'Remember the limits');
  input.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await until(() => root.querySelectorAll('.user-message').length === 1);
});

test('history orders multiple saved conversations using repository timestamps', async (t) => {
  const { root, window } = await setup(t);
  const input = root.querySelector('#message-input');
  for (const text of ['First conversation', 'Second conversation']) {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    root
      .querySelector('#message-form')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => root.querySelectorAll('.user-message').length === 1);
    root.querySelector('#new-chat').click();
    await until(() => root.querySelectorAll('.user-message').length === 0);
  }
  root.querySelector('#history-toggle').click();
  await until(() => root.querySelectorAll('.history-item').length === 2);
  assert.equal(root.querySelector('.history-title').textContent, 'Second conversation');
});

test('a delayed send response cannot replace a new view after course A → B → A', async (t) => {
  const { app, root, window, repo, setReplyHook } = await setup(t);
  const input = root.querySelector('#message-input');
  let finish;
  const deferred = new Promise((resolve) => {
    finish = resolve;
  });
  setReplyHook(async (method, result) => {
    if (method === 'appendMessage') await deferred;
    return result;
  });
  input.value = 'Old pending message';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => root.querySelectorAll('.user-message').length === 1);
  const newer = await repo.newChat('50427');
  const nextId = newer.activeThreadId;
  await repo.setDraft('50427', nextId, 'Keep this draft');
  const ctx = (id) => ({
    courseId: id,
    tabId: 7,
    windowId: 1,
    url: `https://msjc.instructure.com/courses/${id}/pages/a`,
  });
  app.receive('context', ctx('50618'));
  await until(() => app.reader.state.courseId === '50618' && app.reader.state.chat);
  app.receive('context', ctx('50427'));
  await until(() => app.reader.state.chat?.activeThreadId === nextId);
  assert.equal(input.value, 'Keep this draft');
  finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(app.reader.state.chat.activeThreadId, nextId);
  assert.equal(input.value, 'Keep this draft');
});

test('an initial empty chat keeps the welcome heading at the top of a short viewport', async (t) => {
  const { root } = await setup(t, { contentScrollHeight: 1000 });
  assert.equal(root.querySelector('#messages').childElementCount, 0);
  assert.equal(root.querySelector('#panel-content').scrollTop, 0);
});

test('worker reconnection preserves cached sources and restores the saved draft', async (t) => {
  const { app, root, repo } = await setup(t);
  const context = { ...app.reader.state.context };
  const chat = await repo.getChatState('50427');
  await repo.setDraft('50427', chat.activeThreadId, 'Draft survives an idle worker');
  app.receive('reconnecting', 'Reconnecting to local storage…');
  assert.equal(app.reader.state.connected, false);
  assert.equal(app.reader.state.phase, 'reconnecting');
  assert.equal(app.reader.state.snapshot.courseId, '50427');
  app.receive('context', context);
  await until(() => root.querySelector('#message-input').value === 'Draft survives an idle worker');
  assert.equal(app.reader.state.connected, true);
  assert.equal(root.querySelector('#app-error').hidden, true);
});

test('context dropdown selects modules, sections and pages without opening Sources or changing course exports', async (t) => {
  const { root, window, repo, blob } = await setup(t);
  const chip = root.querySelector('#context-chip');
  chip.click();
  assert.equal(root.querySelector('#sources-view').hidden, true);
  assert.equal(root.querySelector('#scope-picker')?.hidden, false);
  const choose = (kind) =>
    root.querySelector(`#scope-options button[data-scope-kind="${kind}"]`).click();
  choose('module');
  await until(() => chip.textContent.includes('Week 1'));
  assert.equal(root.querySelector('#scope-picker').hidden, true);
  assert.equal(root.activeElement, chip);
  assert.equal(root.querySelector('#scope-options script'), null);
  chip.click();
  choose('section');
  await until(() => chip.textContent.includes('Lectures'));
  chip.click();
  choose('page');
  await until(() => chip.textContent.includes('Lecture') && !chip.textContent.includes('Lectures'));
  const input = root.querySelector('#message-input');
  input.value = 'Explain this page';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => root.querySelectorAll('.user-message').length === 1);
  const chat = await repo.getChatState('50427');
  const thread = chat.threads.find((x) => x.id === chat.activeThreadId);
  assert.equal(thread.scope.kind, 'page');
  assert.equal(thread.scope.itemId, '11');
  assert.equal(thread.messages[0].scope.kind, 'page');
  root.querySelector('#sources-toggle').click();
  assert.match(chip.textContent, /Lecture/);
  root.querySelector('#export-course').click();
  await until(() => blob());
  assert.equal(JSON.parse(await blob().text()).summary.lessonCount, 3);
});

test('scope picker closes on Escape and outside click and restores conversation scope from history', async (t) => {
  const { root, window } = await setup(t);
  const chip = root.querySelector('#context-chip');
  chip.click();
  root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(root.querySelector('#scope-picker')?.hidden, true);
  assert.equal(root.activeElement, chip);
  chip.click();
  root.querySelector('#message-input').click();
  assert.equal(root.querySelector('#scope-picker').hidden, true);
  chip.click();
  root.querySelector('#scope-options button[data-scope-kind="section"]').click();
  await until(() => chip.textContent.includes('Lectures'));
  const input = root.querySelector('#message-input');
  input.value = 'Section question';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => root.querySelectorAll('.user-message').length === 1);
  root.querySelector('#new-chat').click();
  await until(() => root.querySelectorAll('.user-message').length === 0);
  assert.match(chip.textContent, /This tab/);
  root.querySelector('#history-toggle').click();
  root.querySelector('.history-item').click();
  await until(() => chip.textContent.includes('Lectures'));
});

test('a delayed scope reply cannot freeze or replace the view after a history selection', async (t) => {
  const { app, root, window, setReplyHook } = await setup(t);
  const input = root.querySelector('#message-input');
  input.value = 'Saved conversation';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  root
    .querySelector('#message-form')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => root.querySelectorAll('.user-message').length === 1);
  const id = app.reader.state.chat.activeThreadId;
  root.querySelector('#new-chat').click();
  await until(() => app.reader.state.chat.activeThreadId !== id);
  root.querySelector('#history-toggle').click();
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  setReplyHook(async (method, result) => {
    if (method === 'setScope') await pending;
    return result;
  });
  root.querySelector('#context-chip').click();
  root.querySelector('#scope-options button[data-scope-kind="page"]').click();
  root.querySelector('.history-item').click();
  await until(() => app.reader.state.chat.activeThreadId === id);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(input.disabled, false);
  assert.match(root.querySelector('#context-chip').textContent, /This tab/);
});

import { createTransport } from './transport.js';
import { createCanvasSource } from '../canvas/source.js';
import { createReaderController } from '../course/controller.js';
import { pageContentSummary } from '../course/content-loader.js';
import { fileAccessSummary } from '../course/file-loader.js';
import { htmlToMarkdown } from '../markdown.js';
import { activeThread, renderMessages, renderHistory } from '../chat/view.js';
import { renderSources } from './sources.js';
import { createScopePicker } from './scope-picker.js';
import { createModelView } from './model-view.js';
import { createDictation } from './dictation.js';

export async function initializePanel(api = chrome, root = document, dependencies = {}) {
  const view = root.defaultView;
  const input = root.querySelector('#message-input');
  const errorBanner = root.querySelector('#app-error');
  let pane = 'chat',
    filter = 'all',
    localError = '',
    sending = false,
    savingScope = false,
    disposed = false,
    draftKey = '',
    messageKey = '',
    generationBusy = false;
  let windowId,
    viewRevision = 0,
    hydratedCourse = null;
  const report = (error) => {
    localError = error?.message || String(error);
    render();
  };
  const act = (action) => async (event) => {
    event?.preventDefault();
    let token = viewRevision;
    try {
      const result = action();
      token = viewRevision;
      return await result;
    } catch (error) {
      if (token === viewRevision) report(error);
      return false;
    }
  };
  const transport =
    dependencies.transport || createTransport(api, (event, data) => receive(event, data));
  const rpc = (method, payload) => transport.rpc(method, payload);
  const reader = createReaderController({
    rpc,
    source: dependencies.source || createCanvasSource(api),
    convert: dependencies.convert || ((html, url) => htmlToMarkdown(html, url, view.DOMParser)),
    onChange: render,
  });
  const scopePicker = createScopePicker(root, async (scope) => {
    const state = reader.state,
      thread = activeThread(state.chat);
    if (!thread || savingScope || sending) return;
    const token = viewRevision,
      courseId = state.courseId;
    let saved = false;
    dictation.stop();
    savingScope = true;
    render();
    try {
      const chat = await rpc('setScope', { courseId, threadId: thread.id, scope });
      if (
        token === viewRevision &&
        courseId === state.courseId &&
        activeThread(state.chat)?.id === thread.id
      ) {
        state.chat = chat;
        saved = true;
        scopePicker.close();
      }
    } catch (error) {
      if (token === viewRevision) report(error);
    } finally {
      if (token === viewRevision) {
        savingScope = false;
        render();
        if (saved) root.querySelector('#context-chip').focus();
      }
    }
  });
  const modelView = createModelView(root, rpc, () => render(), report);
  const dictation = createDictation({
    SpeechRecognition: view.SpeechRecognition || view.webkitSpeechRecognition,
    getDraft: () => input.value,
    onDraft: (text) => {
      input.value = text;
      input.dispatchEvent(new view.Event('input', { bubbles: true }));
    },
    onStatus: (status) => {
      if (disposed) return;
      const button = root.querySelector('#dictate-message');
      button.setAttribute('aria-pressed', String(status.listening));
      button.setAttribute('aria-label', status.listening ? 'Stop dictation' : 'Dictate in English');
      root.querySelector('#install-speech').hidden = status.available !== 'downloadable';
      root.querySelector('#install-speech').disabled = status.installing;
      const label = root.querySelector('#dictation-status');
      label.hidden = !(status.error || status.listening || status.starting || status.installing);
      label.textContent =
        status.error ||
        (status.listening
          ? 'Listening in English · On this device'
          : status.installing
            ? 'Installing English dictation…'
            : 'Checking local dictation…');
    },
  });
  root.querySelector('#dictate-message').addEventListener('click', () => {
    if (dictation.state.listening || dictation.state.starting) dictation.stop();
    else
      void dictation.start().then((ok) => {
        if (!ok) show('model');
      });
  });
  root.querySelector('#install-speech').addEventListener('click', () => void dictation.install());
  root.querySelector('#speech-check').addEventListener('click', () => void dictation.check());
  root.querySelector('#stop-generation').addEventListener(
    'click',
    act(() =>
      rpc('stopTurn', {
        courseId: reader.state.courseId,
        threadId: activeThread(reader.state.chat)?.id,
      }),
    ),
  );

  function receive(event, data) {
    if (event === 'modelStatus') {
      modelView.receive(data);
      return;
    }
    if (event === 'generation') {
      generationBusy = data.busy;
      render();
      return;
    }
    if (event === 'context') {
      if (
        data.courseId !== reader.state.context?.courseId ||
        data.tabId !== reader.state.context?.tabId ||
        data.url !== reader.state.context?.url
      ) {
        dictation.stop();
        viewRevision++;
        sending = false;
        savingScope = false;
      }
      localError = '';
      void reader.connect(data).catch(report);
    } else if (event === 'reconnecting') {
      viewRevision++;
      sending = false;
      savingScope = false;
      localError = '';
      void reader.connect({ courseId: null, tabId: null, windowId });
      reader.state.phase = 'reconnecting';
      render();
    } else if (event === 'error') report(data);
    else reader.receive(event, data);
  }
  function show(next, nextFilter = filter) {
    dictation.stop();
    scopePicker.close();
    pane = next;
    if (pane !== 'chat') root.querySelector('#panel-content').scrollTop = 0;
    root.querySelector('#course-name').hidden = pane === 'model';
    root.querySelector('.context-row').hidden = pane === 'model';
    root.querySelector('.composer-footer').hidden = pane === 'model';
    root.querySelector('#settings-toggle').setAttribute('aria-expanded', String(pane === 'model'));
    filter = nextFilter;
    for (const name of ['chat', 'sources', 'history', 'model'])
      root.querySelector(`#${name}-view`).hidden = pane !== name;
    root.querySelector('#sources-toggle').setAttribute('aria-expanded', String(pane === 'sources'));
    render();
  }
  function render() {
    if (disposed) return;
    const state = reader.state;
    scopePicker.update(state, savingScope || sending);
    if (pane === 'model') root.querySelector('#scope-status').hidden = true;
    if (state.chat && hydratedCourse !== state.courseId) {
      hydratedCourse = state.courseId;
      filter = state.selection?.filter || 'all';
    }
    root.querySelector('#course-name').textContent =
      state.snapshot?.courseTitle ||
      (state.courseId ? `Course ${state.courseId}` : 'Your Canvas companion');
    const pages = state.snapshot ? pageContentSummary(state.snapshot) : null;
    const files = state.snapshot ? fileAccessSummary(state.snapshot) : null;
    let status = state.courseId ? 'Course connected' : 'Open an MSJC Canvas course to get started.';
    if (state.phase === 'reconnecting') status = 'Reconnecting to local storage…';
    else if (!state.connected && state.courseId)
      status = 'Saved course · Open this course in Canvas to reconnect';
    else if (state.phase === 'another-window') status = 'Reading this course in another window…';
    else if (state.phase === 'discovering' || state.phase === 'connecting')
      status = 'Connecting your course materials…';
    else if (state.busy)
      status = `Reading course${pages ? ` · ${pages.loaded}/${pages.total} pages · ${files.available}/${files.total} files` : '…'}`;
    else if (state.updatedAt)
      status = `Last read ${new Date(state.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
    root.querySelector('#connection-status').textContent = status;
    const error = localError || state.error;
    errorBanner.textContent = error;
    errorBanner.hidden = !error;
    for (const id of ['new-chat', 'history-toggle'])
      root.querySelector(`#${id}`).disabled = !state.chat || sending || savingScope;
    root.querySelector('#refresh-course').disabled = !state.connected || state.busy;
    root.querySelector('#read-content').disabled =
      !state.connected ||
      state.busy ||
      Boolean(pages && pages.pending + pages.failed + files.pending + files.failed === 0);
    for (const button of root.querySelectorAll('#export-course, [data-action="export"]'))
      button.disabled = !state.snapshot || state.busy;
    for (const button of root.querySelectorAll('[data-filter]'))
      button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
    const thread = activeThread(state.chat);
    const generating = Boolean(thread?.activeTurn);
    root.querySelector('#stop-generation').hidden = !generating;
    const ready = modelView.state.phase === 'ready';
    const aiBusy = generationBusy || modelView.state.phase === 'generating';
    const waitingForModel = Boolean(modelView.state.cached && !ready);
    root.querySelector('#local-notice').hidden = ready;
    root.querySelector('#local-notice').textContent = ready
      ? 'Replies stay on this device.'
      : aiBusy
        ? 'Generating on this device…'
        : waitingForModel
          ? 'Loading the saved model for local replies…'
          : 'Messages saved locally. Replies are not connected yet.';
    input.placeholder =
      ready || aiBusy ? 'Ask about your course…' : 'Save a question or a thought…';
    root
      .querySelector('#send-message')
      .setAttribute('aria-label', ready ? 'Send message' : 'Save message');
    root.querySelector('#send-message').title = ready ? 'Send message' : 'Save message';
    root.querySelector('#dictate-message').disabled = !thread || pane !== 'chat';
    input.disabled = !thread || sending || savingScope;
    const key = `${state.courseId}:${thread?.id || ''}`;
    if (key !== draftKey) {
      draftKey = key;
      input.value = thread?.draft || '';
    }
    root.querySelector('#send-message').disabled =
      !thread ||
      sending ||
      savingScope ||
      generating ||
      aiBusy ||
      waitingForModel ||
      !input.value.trim();
    const nextMessageKey = `${key}:${thread?.messages.map((message) => `${message.id}:${message.sequence || 0}:${message.status || ''}:${message.text.length}`).join(',') || ''}`;
    if (messageKey !== nextMessageKey) {
      messageKey = nextMessageKey;
      renderMessages(root, state.chat, {
        onSelect: selectThread,
        onRetry: (message) => void retry(message),
      });
      if (pane === 'chat')
        root.querySelector('#panel-content').scrollTop = thread?.messages.length
          ? root.querySelector('#panel-content').scrollHeight
          : 0;
    }
    if (pane === 'sources')
      renderSources(root, state, filter, (selection) => {
        state.selection = selection;
        void rpc('setSelection', { courseId: state.courseId, selection }).catch(report);
      });
    if (pane === 'history')
      renderHistory(root, state.chat, (threadId) => void selectThread(threadId));
  }
  async function selectThread(threadId) {
    try {
      dictation.stop();
      const token = ++viewRevision;
      sending = false;
      savingScope = false;
      const courseId = reader.state.courseId;
      const chat = await rpc('selectThread', { courseId, threadId });
      if (token === viewRevision && courseId === reader.state.courseId) {
        reader.state.chat = chat;
        show('chat');
        input.focus();
      }
    } catch (error) {
      report(error);
    }
  }
  async function exportJson() {
    localError = '';
    const courseId = reader.state.courseId;
    const text = await reader.exportCourse();
    const url = view.URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = root.createElement('a');
    link.href = url;
    link.download = `canvas-${courseId}-modules.json`;
    root.body.append(link);
    link.click();
    link.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  }
  root
    .querySelector('#sources-toggle')
    .addEventListener('click', () => show(pane === 'sources' ? 'chat' : 'sources'));
  root
    .querySelector('#settings-toggle')
    .addEventListener('click', () => show(pane === 'model' ? 'chat' : 'model'));
  root.querySelector('#model-back').addEventListener('click', () => show('chat'));
  root.querySelector('#back-to-chat').addEventListener('click', () => {
    show('chat');
    input.focus();
  });
  root.querySelector('#history-back').addEventListener('click', () => {
    show('chat');
    input.focus();
  });
  root
    .querySelector('#history-toggle')
    .addEventListener('click', () => show(pane === 'history' ? 'chat' : 'history'));
  root.querySelector('#new-chat').addEventListener(
    'click',
    act(async () => {
      dictation.stop();
      const token = ++viewRevision;
      sending = false;
      savingScope = false;
      const courseId = reader.state.courseId;
      const chat = await rpc('newChat', { courseId });
      if (token === viewRevision && courseId === reader.state.courseId) {
        reader.state.chat = chat;
        show('chat');
        input.focus();
      }
    }),
  );
  root.querySelector('#close-panel').addEventListener(
    'click',
    act(() => api.sidePanel.close({ windowId })),
  );
  root.querySelector('#refresh-course').addEventListener(
    'click',
    act(() => {
      localError = '';
      return reader.read({ refresh: true });
    }),
  );
  root.querySelector('#read-content').addEventListener(
    'click',
    act(() => {
      localError = '';
      return reader.read();
    }),
  );
  root.querySelector('#export-course').addEventListener('click', act(exportJson));
  for (const button of root.querySelectorAll('[data-action]'))
    button.addEventListener(
      'click',
      act(() => {
        if (button.dataset.action === 'export') return exportJson();
        show('sources', button.dataset.action === 'files' ? 'files' : 'all');
      }),
    );
  for (const button of root.querySelectorAll('[data-filter]'))
    button.addEventListener('click', () => show('sources', button.dataset.filter));
  input.addEventListener('input', () => {
    const state = reader.state,
      thread = activeThread(state.chat);
    if (thread) {
      thread.draft = input.value;
      void rpc('setDraft', {
        courseId: state.courseId,
        threadId: thread.id,
        text: input.value,
      }).catch(report);
    }
    render();
    input.style.height = 'auto';
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 54), 160)}px`;
  });
  const send = act(async () => {
    const text = input.value.trim(),
      state = reader.state,
      thread = activeThread(state.chat);
    if (
      !text ||
      !thread ||
      sending ||
      savingScope ||
      thread.activeTurn ||
      generationBusy ||
      (modelView.state.cached && modelView.state.phase !== 'ready')
    )
      return;
    dictation.stop();
    const token = viewRevision,
      courseId = state.courseId;
    sending = true;
    render();
    try {
      const usingAI = modelView.state.phase === 'ready';
      const result = await rpc(usingAI ? 'sendTurn' : 'appendMessage', {
        courseId,
        threadId: thread.id,
        text,
        messageId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        userMessageId: crypto.randomUUID(),
        assistantMessageId: crypto.randomUUID(),
      });
      if (
        token === viewRevision &&
        courseId === state.courseId &&
        activeThread(state.chat)?.id === thread.id
      ) {
        state.chat = usingAI ? result.chat : result;
        input.value = '';
        input.style.height = '';
        show('chat');
      }
    } finally {
      if (token === viewRevision) {
        sending = false;
        render();
        input.focus();
      }
    }
  });
  async function retry(message) {
    try {
      const state = reader.state,
        thread = activeThread(state.chat);
      if (!thread || generationBusy) return;
      await rpc('retryTurn', {
        courseId: state.courseId,
        threadId: thread.id,
        turnId: message.turnId,
        expectedAttempt: message.attempt,
        assistantMessageId: crypto.randomUUID(),
      });
    } catch (error) {
      report(error);
    }
  }
  root.querySelector('#message-form').addEventListener('submit', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  });
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      viewRevision++;
      reader.dispose();
      scopePicker.dispose();
      modelView.dispose();
      dictation.dispose();
      transport.close();
    }
  };
  view.addEventListener('pagehide', dispose, { once: true });
  windowId = (await api.windows.getCurrent()).id;
  const context = await rpc('subscribe', { windowId });
  await reader.connect(context);
  void modelView.connect();
  return { reader, receive, dispose, show, exportJson };
}

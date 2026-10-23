import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { openRepository } from '../../src/storage/repository.js';
import { createBackgroundHub } from '../../src/background/hub.js';
import { initializePanel } from '../../src/panel/app.js';

const html = await readFile(new URL('../../public/sidepanel.html', import.meta.url), 'utf8');
export const origin = 'https://msjc.instructure.com';
export const modulesUrl = `${origin}/courses/50427/modules`;
const event = () => ({ addListener() {} });

export async function setup(t, options = {}) {
  const {
    withPage = true,
    withFile = true,
    sourceUrl = `${origin}/courses/50427/pages/lecture`,
    waitForRead = true,
    pendingPage,
  } = options;
  let pageFail = Boolean(options.pageFail),
    discoveryFail = Boolean(options.discoveryFail);
  const dom = new JSDOM(html, { url: 'chrome-extension://study-agent/sidepanel.html' });
  t.after(() => dom.window.close());
  if (options.contentScrollHeight != null)
    Object.defineProperty(dom.window.document.querySelector('#panel-content'), 'scrollHeight', {
      value: options.contentScrollHeight,
    });
  const repo = await openRepository(`native-panel-test-${crypto.randomUUID()}`);
  t.after(() => repo.close());
  const injections = [],
    requests = [],
    navigation = [];
  let closed, blob, downloaded, app;
  const courseId = new URL(sourceUrl).pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
  const api = {
    windows: { getCurrent: async () => ({ id: 1 }) },
    sidePanel: {
      close: async (value) => {
        closed = value;
      },
    },
    runtime: { onConnect: event() },
    tabs: {
      query: async () => [{ id: 7, windowId: 1, url: sourceUrl }],
      create: async (value) => {
        navigation.push({ action: 'create', value });
        throw new Error('Unexpected tab navigation');
      },
      update: async (...value) => {
        navigation.push({ action: 'update', value });
        throw new Error('Unexpected tab navigation');
      },
      onActivated: event(),
      onUpdated: event(),
      onRemoved: event(),
    },
    scripting: {
      executeScript: async ({ target, func, args = [] }) => {
        injections.push({ tabId: target.tabId, functionName: func.name });
        assert.equal(target.tabId, 7, 'Content must be read from the connected Canvas tab');
        const fetch = async (url) => {
          requests.push(url);
          await new Promise((resolve) => setImmediate(resolve));
          const pathname = new URL(url).pathname;
          let body,
            status = 200;
          if (pathname.endsWith(`/courses/${courseId}`)) {
            if (discoveryFail) throw new Error('Cannot access contents of the page.');
            body = { id: Number(courseId), name: 'MATH-C2210-1354' };
          } else if (pathname.endsWith('/modules')) {
            const items = [
              { id: 10, position: 1, type: 'SubHeader', title: 'Lectures' },
              {
                id: 13,
                position: 2,
                type: 'Assignment',
                title: 'Homework',
                html_url: `${origin}/courses/${courseId}/modules/items/13`,
                content_details: { due_at: '2026-10-25T12:00:00Z', points_possible: 8 },
              },
            ];
            if (withPage)
              items.push({
                id: 11,
                position: 3,
                type: 'Page',
                title: 'Lecture',
                page_url: 'lecture',
                html_url: `${origin}/courses/${courseId}/modules/items/11`,
              });
            if (withFile)
              items.push({
                id: 12,
                position: 4,
                type: 'File',
                title: 'Review.pdf',
                content_id: 33,
              });
            body = [
              {
                id: 1,
                position: 1,
                name: 'Week 1 <script>alert(1)</script> <img src=x onerror=alert(1)>',
                items_count: items.length,
                items,
              },
              { id: 2, position: 2, name: 'Week 2', items_count: 0, items: [] },
            ];
          } else if (pathname.endsWith('/pages/lecture')) {
            if (pendingPage) await pendingPage();
            status = pageFail ? 403 : 200;
            body = pageFail
              ? {}
              : {
                  page_id: 22,
                  title: 'Lecture',
                  body: '<h2>All concepts</h2><p>Complete lesson. All <strong>concepts</strong>.</p>',
                  html_url: `${origin}/courses/${courseId}/pages/lecture`,
                };
          } else if (pathname.endsWith('/files/33')) {
            body = {
              id: 33,
              display_name: 'Review.pdf',
              'content-type': 'application/pdf',
              size: 201304,
              locked_for_user: false,
            };
          } else {
            throw new Error(`Unexpected Canvas API request: ${url}`);
          }
          return new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          });
        };
        const injected = vm.runInNewContext(`(${func.toString()})`, {
          location: new URL(sourceUrl),
          URL,
          AbortSignal,
          fetch,
        });
        return [{ frameId: 0, result: await injected(...args) }];
      },
    },
  };
  const hub = createBackgroundHub(api, repo, { model: options.model, prepare: options.prepare });
  const session = hub.createSession((message) => {
    app?.receive(message.event, message.data);
  });
  let replyHook = async (_method, result) => result;
  const transport = {
    rpc: async (method, payload) => replyHook(method, await hub.request(session, method, payload)),
    close: () => hub.disconnect(session),
  };
  dom.window.URL.createObjectURL = (value) => {
    blob = value;
    return 'blob:local-export';
  };
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.document.addEventListener('click', (event) => {
    if (event.target.download) {
      downloaded = { name: event.target.download, url: event.target.href };
      event.preventDefault();
    }
  });
  if (options.SpeechRecognition) dom.window.SpeechRecognition = options.SpeechRecognition;
  app = await initializePanel(api, dom.window.document, { transport });
  t.after(() => app.dispose());
  if (waitForRead)
    await app.reader.whenIdle().catch((error) => {
      if (!discoveryFail) throw error;
    });
  return {
    app,
    hub,
    root: dom.window.document,
    window: dom.window,
    repo,
    injections,
    requests,
    navigation,
    setReplyHook: (fn) => {
      replyHook = fn;
    },
    setPageFail: (value) => {
      pageFail = value;
    },
    setDiscoveryFail: (value) => {
      discoveryFail = value;
    },
    closed: () => closed,
    blob: () => blob,
    download: () => downloaded,
  };
}

export async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('Panel operation did not finish');
}

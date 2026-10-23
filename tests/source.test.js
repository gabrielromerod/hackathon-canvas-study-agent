import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { createCanvasSource } from '../src/canvas/source.js';
const origin = 'https://msjc.instructure.com';
const context = { tabId: 7, courseId: '50427', url: `${origin}/courses/50427/pages/lecture` };
const snapshot = () => ({
  schemaVersion: 2,
  courseId: '50427',
  courseTitle: 'Course',
  sourceUrl: `${origin}/courses/50427/modules`,
  modules: [],
  itemCount: 0,
  warnings: [],
  extractedAt: '2026-10-23T00:00:00Z',
});
function source(replies) {
  const calls = [];
  const api = {
    scripting: {
      executeScript: async (options) => {
        calls.push(options);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  };
  return { calls, adapter: createCanvasSource(api) };
}

test('discovers through the originally authorized tab without querying or changing tabs', async () => {
  const { adapter, calls } = source([[{ frameId: 0, result: snapshot() }]]);
  const result = await adapter.discover(context);
  assert.equal(result.courseId, '50427');
  assert.deepEqual(calls[0].target, { tabId: 7 });
  assert.equal(calls[0].func.name, 'discoverCourse');
  assert.deepEqual(calls[0].args, [{ courseId: '50427' }]);
});

test('passes page and file readers the original tab and exact requested item identifiers', async () => {
  const page = { status: 'loaded', html: '<p>Lesson</p>', pageId: 4 };
  const file = {
    status: 'available',
    format: 'file',
    file: { id: '5', downloadUrl: `${origin}/courses/50427/files/5/download` },
  };
  const { adapter, calls } = source([[{ result: page }], [{ result: file }]]);
  const request = {
    courseId: '50427',
    moduleId: '1',
    itemId: '2',
    pageId: null,
    pageSlug: 'lecture',
  };
  assert.deepEqual(await adapter.readPage(context, request), page);
  assert.deepEqual(
    await adapter.readFile(context, { courseId: '50427', moduleId: '1', itemId: '3', fileId: '5' }),
    file,
  );
  assert.deepEqual(
    calls.map((call) => call.target),
    [{ tabId: 7 }, { tabId: 7 }],
  );
  assert.deepEqual(calls[0].args, [request]);
  assert.equal(calls[0].func.name, 'fetchPageContent');
  assert.equal(calls[1].func.name, 'fetchFileMetadata');
});

test('runs serialized discovery and readers in a same-course assignment tab', async () => {
  const replies = [
    { name: 'Biology' },
    [],
    { body: '<p>Lecture</p>', page_id: 4 },
    { id: 5, display_name: 'Notes.pdf', size: 20, locked_for_user: false },
  ];
  const requests = [];
  const api = {
    scripting: {
      executeScript: async ({ target, func, args }) => {
        assert.equal(target.tabId, 7);
        const fetch = async (url, options) => {
          requests.push(url);
          assert.equal(options.method, 'GET');
          return new Response(JSON.stringify(replies.shift()), {
            headers: { 'content-type': 'application/json' },
          });
        };
        const injected = vm.runInNewContext(`(${func.toString()})`, {
          location: new URL(`${origin}/courses/50427/assignments/100`),
          URL,
          AbortSignal,
          fetch,
        });
        return [{ frameId: 0, result: await injected(...args) }];
      },
    },
  };
  const adapter = createCanvasSource(api);
  assert.equal((await adapter.discover(context)).courseTitle, 'Biology');
  assert.equal(
    (
      await adapter.readPage(context, {
        courseId: '50427',
        moduleId: '1',
        itemId: '2',
        pageSlug: 'lecture',
      })
    ).status,
    'loaded',
  );
  assert.equal(
    (
      await adapter.readFile(context, {
        courseId: '50427',
        moduleId: '1',
        itemId: '3',
        fileId: '5',
      })
    ).status,
    'available',
  );
  assert.equal(requests.length, 4);
  assert.equal(requests[2], `${origin}/api/v1/courses/50427/pages/lecture`);
});

test('falls back to DOM extraction only on the exact original Modules route', async () => {
  for (const suffix of ['/modules', '/modules/?expanded=1']) {
    const { adapter, calls } = source([
      new Error('Canvas API unavailable'),
      [{ result: snapshot() }],
    ]);
    assert.equal(
      (await adapter.discover({ ...context, url: `${origin}/courses/50427${suffix}` })).courseId,
      '50427',
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1].func.name, 'extractModules');
    assert.deepEqual(calls[1].target, { tabId: 7 });
    assert.deepEqual(calls[1].args, []);
  }
});

test('serialized DOM fallback reads modules without a worker DOMParser', async () => {
  const dom = new JSDOM(
    '<title>Course Modules: Biology</title><div id="context_modules"><div class="context_module" id="context_module_1"><h2>Week 1</h2></div></div>',
    { url: `${origin}/courses/50427/modules` },
  );
  let attempts = 0;
  const api = {
    scripting: {
      executeScript: async ({ func, args }) => {
        if (++attempts === 1) throw new Error('API unavailable');
        const injected = vm.runInNewContext(`(${func.toString()})`, {
          document: dom.window.document,
          location: dom.window.location,
          URL,
        });
        return [{ result: await injected(...args) }];
      },
    },
  };
  const result = await createCanvasSource(api).discover({
    ...context,
    url: `${origin}/courses/50427/modules`,
  });
  assert.equal(result.modules[0].title, 'Week 1');
  assert.equal(result.courseTitle, 'Biology');
});

test('a discovery failure on any non-Modules route stays on the original tab and is explicit', async () => {
  for (const url of [
    context.url,
    `${origin}/courses/50427/assignments/1`,
    `${origin}/courses/50427/modules/1`,
    `${origin}/courses/504270/modules`,
    'https://msjc.instructure.com.evil.test/courses/50427/modules',
  ]) {
    const { adapter, calls } = source([new Error('HTTP 403')]);
    await assert.rejects(adapter.discover({ ...context, url }), /discover|403/i);
    assert.equal(calls.length, 1);
  }
});

test('rejects empty or malformed injection results and surfaces discovery errors', async () => {
  for (const reply of [
    [],
    [{ result: null }],
    [{ result: { error: 'No course access' } }],
    [{ result: { ...snapshot(), courseId: '99' } }],
    [{ result: { ...snapshot(), modules: [{}] } }],
  ]) {
    const { adapter } = source([reply]);
    await assert.rejects(adapter.discover(context), /course|Canvas|discover|access/i);
  }
  const page = source([[{ result: { status: 'loaded' } }]]);
  await assert.rejects(
    page.adapter.readPage(context, { courseId: '50427', moduleId: '1', itemId: '2' }),
    /page|Canvas/i,
  );
  const file = source([[{ result: { status: 'available' } }]]);
  await assert.rejects(
    file.adapter.readFile(context, { courseId: '50427', moduleId: '1', itemId: '2' }),
    /file|Canvas/i,
  );
});

test('preserves explicit reader errors and locks as status results', async () => {
  const error = { status: 'error', error: 'HTTP 403' };
  const locked = { status: 'locked', format: 'file', error: 'Not yet available' };
  const { adapter } = source([[{ result: error }], [{ result: locked }]]);
  assert.deepEqual(
    await adapter.readPage(context, { courseId: '50427', moduleId: '1', itemId: '2' }),
    error,
  );
  assert.deepEqual(
    await adapter.readFile(context, { courseId: '50427', moduleId: '1', itemId: '3' }),
    locked,
  );
});

test('rejects missing tabs and cross-course reader requests before injection', async () => {
  const { adapter, calls } = source([]);
  await assert.rejects(adapter.discover({ ...context, tabId: null }), /tab/i);
  await assert.rejects(
    adapter.readPage(context, { courseId: '99', moduleId: '1', itemId: '2' }),
    /course/i,
  );
  await assert.rejects(
    adapter.readFile(context, { courseId: '99', moduleId: '1', itemId: '2' }),
    /course/i,
  );
  assert.equal(calls.length, 0);
});

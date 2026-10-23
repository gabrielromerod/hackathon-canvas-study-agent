import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadPageContents } from '../src/course/content-loader.js';
import { htmlToMarkdown } from '../src/markdown.js';
const Parser = new JSDOM('').window.DOMParser;
const convert = (html, url) => htmlToMarkdown(html, url, Parser);
const make = (items) => ({ courseId: '50427', modules: [{ id: '10', items }] });
const page = (id, extra = {}) => ({
  id,
  type: 'Page',
  title: `Lecture ${id}`,
  locked: false,
  pageId: id,
  ...extra,
});

test('loads page Markdown into the export shape without retaining raw HTML or changing other items', async () => {
  const snapshot = make([page('1'), { id: '2', type: 'Assignment', title: 'Homework' }]);
  await loadPageContents(
    snapshot,
    async (request) => ({
      status: 'loaded',
      html: '<h2>Lecture</h2><p>Read <strong>this</strong>.</p>',
      sourceUrl: 'https://msjc.instructure.com/courses/50427/pages/lecture',
      pageId: request.pageId,
    }),
    convert,
  );
  assert.equal(snapshot.modules[0].items[0].content.markdown, '## Lecture\n\nRead **this**.');
  assert.equal(snapshot.modules[0].items[0].content.format, 'markdown');
  assert.equal(snapshot.modules[0].items[1].content, undefined);
  assert.equal(snapshot.contentSummary.loaded, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /<h2>|"html":/);
});

test('keeps successes across retries and reports individual failures and locked pages', async () => {
  const snapshot = make([page('1'), page('2'), page('3', { locked: true })]);
  const calls = [];
  let retry = false;
  const read = async (request) => {
    calls.push(request.itemId);
    if (request.itemId === '2' && !retry) return { status: 'error', error: 'HTTP 403' };
    return {
      status: 'loaded',
      html: '<p>Lesson</p>',
      sourceUrl: 'https://msjc.instructure.com/lesson',
    };
  };
  await loadPageContents(snapshot, read, convert);
  assert.deepEqual(snapshot.contentSummary, {
    total: 3,
    loaded: 1,
    failed: 1,
    locked: 1,
    pending: 0,
  });
  assert.match(snapshot.modules[0].items[1].content.error, /403/);
  retry = true;
  await loadPageContents(snapshot, read, convert);
  assert.deepEqual(calls.sort(), ['1', '2', '2']);
  assert.equal(snapshot.contentSummary.loaded, 2);
});

test('limits concurrent API operations and reuses page data for repeated module links', async () => {
  const snapshot = make([page('1'), page('2'), page('3'), page('4', { pageId: '1' })]);
  let active = 0,
    maximum = 0;
  const calls = [];
  await loadPageContents(
    snapshot,
    async (request) => {
      calls.push(request.pageId);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return {
        status: 'loaded',
        html: '<p>Full page</p>',
        sourceUrl: 'https://msjc.instructure.com/lecture',
      };
    },
    convert,
  );
  assert.equal(maximum, 2);
  assert.deepEqual(calls.sort(), ['1', '2', '3']);
  assert.equal(snapshot.contentSummary.loaded, 4);
});

test('does not truncate large pages or hide conversion failures', async () => {
  const snapshot = make([page('1'), page('2')]);
  await loadPageContents(
    snapshot,
    async (request) => ({
      status: 'loaded',
      html: request.itemId === '1' ? `<p>${'Long lesson. '.repeat(5000)}</p>` : 'bad',
      sourceUrl: 'https://msjc.instructure.com/lecture',
    }),
    (html, url) => {
      if (html === 'bad') throw new Error('Conversion failed');
      return convert(html, url);
    },
  );
  assert.equal(
    (snapshot.modules[0].items[0].content.markdown.match(/Long lesson\./g) || []).length,
    5000,
  );
  assert.equal(snapshot.modules[0].items[1].content.status, 'error');
  assert.match(snapshot.modules[0].items[1].content.error, /Conversion failed/);
});

test('deduplicates known page slugs and persists each completed module item', async () => {
  const snapshot = make([
    page('1', { pageId: null, pageSlug: 'same' }),
    page('2', { pageId: null, pageSlug: 'same' }),
  ]);
  const calls = [],
    persisted = [];
  await loadPageContents(
    snapshot,
    async (request) => {
      calls.push(request);
      return {
        status: 'loaded',
        html: '<p>Shared</p>',
        sourceUrl: 'https://msjc.instructure.com/courses/50427/pages/same',
      };
    },
    convert,
    undefined,
    {
      onItem: async (moduleId, item) => {
        await new Promise((resolve) => setImmediate(resolve));
        persisted.push([moduleId, item.id, item.content.status]);
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageSlug, 'same');
  assert.deepEqual(persisted.sort(), [
    ['10', '1', 'loaded'],
    ['10', '2', 'loaded'],
  ]);
});

test('stops scheduling and discards in-flight page results after cancellation', async () => {
  const snapshot = make([page('1'), page('2'), page('3')]);
  const started = [],
    pending = [],
    persisted = [];
  let active = true;
  const loading = loadPageContents(
    snapshot,
    (request) => {
      started.push(request.itemId);
      return started.length > 2
        ? Promise.resolve({ status: 'error', error: 'Unexpected new job' })
        : new Promise((resolve) => pending.push(resolve));
    },
    convert,
    undefined,
    { shouldContinue: () => active, onItem: (moduleId, item) => persisted.push(item.id) },
  );
  assert.deepEqual(started, ['1', '2']);
  active = false;
  pending.forEach((resolve) =>
    resolve({
      status: 'loaded',
      html: '<p>stale</p>',
      sourceUrl: 'https://msjc.instructure.com/lecture',
    }),
  );
  await loading;
  assert.deepEqual(started, ['1', '2']);
  assert.equal(
    snapshot.modules[0].items.some((item) => item.content),
    false,
  );
  assert.deepEqual(persisted, []);
});

test('awaits item persistence before scheduling another page on that worker', async () => {
  const snapshot = make([page('1'), page('2'), page('3')]);
  const events = [];
  await loadPageContents(
    snapshot,
    async ({ itemId }) => {
      events.push(`read:${itemId}`);
      return {
        status: 'loaded',
        html: '<p>ok</p>',
        sourceUrl: 'https://msjc.instructure.com/lecture',
      };
    },
    convert,
    undefined,
    {
      onItem: async (moduleId, item) => {
        await new Promise((resolve) => setImmediate(resolve));
        events.push(`saved:${item.id}`);
      },
    },
  );
  assert.equal(events.filter((value) => value.startsWith('saved:')).length, 3);
  assert.ok(
    events.indexOf('read:3') > Math.min(events.indexOf('saved:1'), events.indexOf('saved:2')),
  );
});

test('does not mutate even locked pages when the import was already cancelled', async () => {
  const snapshot = make([page('1', { locked: true }), page('2')]);
  const before = structuredClone(snapshot);
  await loadPageContents(
    snapshot,
    () => {
      throw new Error('Must not read');
    },
    convert,
    () => {
      throw new Error('Must not report');
    },
    { shouldContinue: () => false },
  );
  assert.deepEqual(snapshot, before);
});

test('persists locked and failed page states without reading locked pages', async () => {
  const snapshot = make([page('1', { locked: true }), page('2')]);
  const reads = [],
    saved = [];
  await loadPageContents(
    snapshot,
    async ({ itemId }) => {
      reads.push(itemId);
      return { status: 'error', error: 'HTTP 403' };
    },
    convert,
    undefined,
    { onItem: async (moduleId, item) => saved.push([moduleId, item.id, item.content.status]) },
  );
  assert.deepEqual(reads, ['2']);
  assert.deepEqual(saved.sort(), [
    ['10', '1', 'locked'],
    ['10', '2', 'error'],
  ]);
});

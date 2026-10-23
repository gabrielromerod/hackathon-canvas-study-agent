import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { discoverCourse } from '../src/canvas/discovery.js';
const origin = 'https://msjc.instructure.com';
const prefix = `${origin}/api/v1/courses/50427`;
function run(replies, context = `${origin}/courses/50427/pages/lecture`, courseId = '50427') {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    const reply = replies.shift();
    assert.ok(reply, `Unexpected request ${url}`);
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status || 200,
      headers: {
        'content-type': reply.type || 'application/json',
        ...(reply.link ? { link: reply.link } : {}),
      },
    });
  };
  const fn = vm.runInNewContext(`(${discoverCourse.toString()})`, {
    fetch,
    location: new URL(context),
    URL,
    AbortSignal,
  });
  return { calls, result: fn({ courseId }) };
}
const item = (id, position, extra = {}) => ({
  id,
  position,
  title: `Item ${id}`,
  type: 'Page',
  page_url: `page-${id}`,
  html_url: `${origin}/courses/50427/pages/page-${id}`,
  ...extra,
});

test('discovers paginated modules from a course page and preserves Canvas positions and snapshot fields', async () => {
  const job = run([
    { body: { id: 50427, name: 'Biology' } },
    {
      body: [{ id: 20, position: 2, name: 'Week 2', items_count: 1, items: [item(3, 1)] }],
      link: `<${prefix}/modules?page=2>; rel="next", <${prefix}/modules?page=2>; rel="last"`,
    },
    {
      body: [
        {
          id: 10,
          position: 1,
          name: 'Week 1',
          items_count: 2,
          items: [
            item(2, 2, {
              type: 'Assignment',
              content_details: {
                points_possible: 15,
                due_at: '2026-10-24T00:00:00Z',
                locked_for_user: true,
              },
            }),
            item(1, 1),
          ],
        },
      ],
    },
  ]);
  const snapshot = await job.result;
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.courseId, '50427');
  assert.equal(snapshot.courseTitle, 'Biology');
  assert.equal(snapshot.sourceUrl, `${origin}/courses/50427/modules`);
  assert.ok(!Number.isNaN(Date.parse(snapshot.extractedAt)));
  assert.equal(snapshot.itemCount, 3);
  assert.deepEqual(
    Array.from(snapshot.modules, (module) => module.id),
    ['10', '20'],
  );
  assert.deepEqual(
    Array.from(snapshot.modules[0].items, (value) => value.id),
    ['1', '2'],
  );
  assert.equal(snapshot.modules[0].week, 1);
  assert.equal(snapshot.modules[0].items[0].pageSlug, 'page-1');
  assert.equal(snapshot.modules[0].items[0].pageId, null);
  assert.equal(snapshot.modules[0].items[0].content.status, 'not_loaded');
  assert.equal(snapshot.modules[0].items[1].points, 15);
  assert.equal(snapshot.modules[0].items[1].dueDate, '2026-10-24T00:00:00Z');
  assert.equal(snapshot.modules[0].items[1].locked, true);
  const modulesUrl = new URL(job.calls[1]);
  assert.deepEqual(modulesUrl.searchParams.getAll('include[]'), ['items', 'content_details']);
  assert.equal(modulesUrl.searchParams.get('per_page'), '100');
  assert.equal(job.calls[0], prefix);
});

test('fetches complete paginated items when inline items are absent or incomplete', async () => {
  const job = run([
    { body: { name: 'Biology' } },
    {
      body: [
        { id: 10, name: 'First', position: 1, items_count: 2 },
        { id: 20, name: 'Second', position: 2, items_count: 2, items: [item(99, 1)] },
      ],
    },
    { body: [item(2, 2)], link: `<${prefix}/modules/10/items?page=2>; rel="next"` },
    { body: [item(1, 1)] },
    { body: [item(3, 1), item(4, 2)] },
  ]);
  const snapshot = await job.result;
  assert.deepEqual(
    Array.from(snapshot.modules[0].items, (value) => value.id),
    ['1', '2'],
  );
  assert.deepEqual(
    Array.from(snapshot.modules[1].items, (value) => value.id),
    ['3', '4'],
  );
  assert.equal(snapshot.itemCount, 4);
  assert.equal(new URL(job.calls[2]).pathname, '/api/v1/courses/50427/modules/10/items');
  assert.deepEqual(new URL(job.calls[2]).searchParams.getAll('include[]'), ['content_details']);
  assert.equal(new URL(job.calls[4]).pathname, '/api/v1/courses/50427/modules/20/items');
});

test('maps Canvas types, IDs and module locks without treating sections as locked', async () => {
  const types = ['SubHeader', 'File', 'Discussion', 'ExternalUrl', 'ExternalTool', 'Quiz'];
  const job = run([
    { body: { name: 'Course' } },
    {
      body: [
        {
          id: 1,
          name: 'Locked',
          state: 'locked',
          items_count: 6,
          items: types.map((type, index) =>
            item(index + 1, index + 1, { type, content_id: index + 100 }),
          ),
        },
      ],
    },
  ]);
  const snapshot = await job.result;
  assert.deepEqual(
    Array.from(snapshot.modules[0].items, (value) => value.type),
    ['Section', 'Attachment', 'Discussion Topic', 'External Url', 'External Tool', 'Quiz'],
  );
  assert.equal(snapshot.modules[0].items[0].locked, false);
  assert.equal(snapshot.modules[0].items[1].locked, true);
  assert.equal(snapshot.modules[0].items[1].fileId, '101');
  assert.equal(snapshot.modules[0].items[1].content.status, 'not_loaded');
});

test('accepts same-course assignments and course roots but rejects other courses and lookalike origins before fetching', async () => {
  for (const route of [
    '/courses/50427',
    '/courses/50427/assignments/22',
    '/courses/50427/modules/10',
  ]) {
    assert.equal(
      (await run([{ body: {} }, { body: [] }], `${origin}${route}`).result).courseId,
      '50427',
    );
  }
  for (const context of [
    `${origin}/courses/504270/pages/x`,
    `${origin}/courses/50428/modules`,
    `${origin}/courses/50427-evil/modules`,
    'https://msjc.instructure.com.evil.test/courses/50427/modules',
    'http://msjc.instructure.com/courses/50427/modules',
  ]) {
    const job = run([], context);
    await assert.rejects(job.result, /course|Canvas/i);
    assert.equal(job.calls.length, 0);
  }
  const invalid = run([], `${origin}/courses/50427/modules`, '../users');
  await assert.rejects(invalid.result);
  assert.equal(invalid.calls.length, 0);
});

test('refuses unsafe pagination links without requesting them', async () => {
  for (const next of [
    'https://evil.test/api/v1/courses/50427/modules?page=2',
    `${origin}/api/v1/courses/504270/modules?page=2`,
    `${origin}/api/v1/courses/50428/modules?page=2`,
    `${origin}/courses/50427/modules`,
    `${origin}/api/v1/users`,
    `${origin}/api/v1/courses/50427/modules/../users`,
    `https://name:secret@msjc.instructure.com/api/v1/courses/50427/modules?page=2`,
  ]) {
    const job = run([{ body: {} }, { body: [], link: `<${next}>; rel="next"` }]);
    await assert.rejects(job.result, /pagination|course|unsafe/i);
    assert.equal(job.calls.length, 2);
  }
});

test('throws on API failures, login HTML, malformed lists and pagination cycles', async () => {
  for (const replies of [
    [{ status: 403 }],
    [{ type: 'text/html' }],
    [{ body: {} }, { body: {} }],
    [
      { body: {} },
      { body: [], link: `<${prefix}/modules?page=2>; rel="next"` },
      { body: [], link: `<${prefix}/modules?page=2>; rel="next"` },
    ],
  ]) {
    await assert.rejects(run(replies).result);
  }
});

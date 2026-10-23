import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fetchPageContent } from '../src/canvas/page-reader.js';
const contextUrl = 'https://msjc.instructure.com/courses/50427/modules';
const request = { courseId: '50427', moduleId: '651767', itemId: '5730559', pageId: '2882740' };

function run(requestData, responses, context = contextUrl) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'GET');
    const value = responses.shift();
    assert.ok(value, `Unexpected request: ${url}`);
    return new Response(typeof value.body === 'string' ? value.body : JSON.stringify(value.body), {
      status: value.status || 200,
      headers: { 'Content-Type': value.type || 'application/json' },
    });
  };
  const fn = vm.runInNewContext(`(${fetchPageContent.toString()})`, {
    location: new URL(context),
    fetch,
    URL,
    AbortSignal,
  });
  return { result: fn(requestData), calls };
}

test('retrieves a known page ID with session-only GET and preserves the complete body', async () => {
  const job = run(request, [
    {
      body: {
        page_id: 2882740,
        title: 'Lecture',
        html_url: 'https://msjc.instructure.com/courses/50427/pages/lecture',
        body: '<p>Full lecture.</p>',
        updated_at: '2026-10-23T00:00:00Z',
        locked_for_user: false,
      },
    },
  ]);
  const result = await job.result;
  assert.equal(result.status, 'loaded');
  assert.equal(result.html, '<p>Full lecture.</p>');
  assert.deepEqual(job.calls, [
    'https://msjc.instructure.com/api/v1/courses/50427/pages/page_id:2882740',
  ]);
});

test('resolves the page slug through module metadata when DOM page ID is unavailable', async () => {
  const job = run({ ...request, pageId: null }, [
    { body: { id: 5730559, type: 'Page', page_url: 'lecture-with-spaces' } },
    { body: { page_id: 12, title: 'Lecture', body: '' } },
  ]);
  assert.equal((await job.result).html, '');
  assert.deepEqual(job.calls, [
    'https://msjc.instructure.com/api/v1/courses/50427/modules/651767/items/5730559',
    'https://msjc.instructure.com/api/v1/courses/50427/pages/lecture-with-spaces',
  ]);
});

test('reports locked, unauthorized, missing, and non-JSON login responses explicitly', async () => {
  for (const [response, status, pattern] of [
    [
      { body: { locked_for_user: true, lock_explanation: 'Not yet available' } },
      'locked',
      /Not yet available/,
    ],
    [{ status: 401, body: {} }, 'error', /401/],
    [{ status: 404, body: {} }, 'error', /404/],
    [{ type: 'text/html', body: '<h1>Sign in</h1>' }, 'error', /sign in/i],
    [{ body: { title: 'No body' } }, 'error', /body/i],
  ]) {
    const result = await run(request, [response]).result;
    assert.equal(result.status, status);
    assert.match(result.error, pattern);
    assert.equal(result.html, undefined);
  }
});

test('rejects other origins, other courses, and invalid identifiers before any request', async () => {
  for (const [data, context] of [
    [request, 'https://example.com/courses/50427/modules'],
    [request, 'https://msjc.instructure.com/courses/50618/modules'],
    [{ ...request, itemId: '../users' }, contextUrl],
  ]) {
    const job = run(data, [], context);
    assert.equal((await job.result).status, 'error');
    assert.deepEqual(job.calls, []);
  }
});

test('reads from any page in the same course and uses a known slug directly', async () => {
  for (const route of ['pages/lecture', 'assignments/1', '']) {
    const job = run(
      { ...request, pageId: null, pageSlug: 'lecture/one' },
      [{ body: { body: '<p>Lecture</p>' } }],
      `https://msjc.instructure.com/courses/50427/${route}`,
    );
    assert.equal((await job.result).status, 'loaded');
    assert.deepEqual(job.calls, [
      'https://msjc.instructure.com/api/v1/courses/50427/pages/lecture%2Fone',
    ]);
  }
});

test('rejects course-ID lookalikes and host lookalikes before reading a page', async () => {
  for (const url of [
    'https://msjc.instructure.com/courses/504270/pages/x',
    'https://msjc.instructure.com/courses/50427-evil/pages/x',
    'https://msjc.instructure.com.evil.test/courses/50427/pages/x',
  ]) {
    const job = run(request, [], url);
    assert.equal((await job.result).status, 'error');
    assert.equal(job.calls.length, 0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const { fetchCurrentPlacement } = await import('../src/canvas/current-placement.js').catch(
  (error) => {
    if (
      error.code === 'ERR_MODULE_NOT_FOUND' &&
      error.url?.endsWith('/src/canvas/current-placement.js')
    )
      return {};
    throw error;
  },
);
const origin = 'https://msjc.instructure.com';
function run(
  path,
  {
    body = { items: [{ current: { id: 12, module_id: 1 } }] },
    status = 200,
    type = 'application/json',
    beforeResponse,
    beforeJson,
    requestUrl,
    actualUrl,
    courseId = '101',
  } = {},
) {
  assert.equal(
    typeof fetchCurrentPlacement,
    'function',
    'Current placement bridge must be implemented',
  );
  let href = actualUrl || `${origin}${path}`;
  const calls = [];
  const location = {
    get href() {
      return href;
    },
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (beforeResponse) href = beforeResponse;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers({ 'content-type': type }),
      json: async () => {
        if (beforeJson) href = beforeJson;
        return body;
      },
    };
  };
  const fn = vm.runInNewContext(`(${fetchCurrentPlacement.toString()})`, {
    location,
    URL,
    fetch,
    AbortSignal,
  });
  return { calls, result: fn({ courseId, url: requestUrl || href }) };
}

test('maps direct Canvas assets to course-scoped metadata GET requests without reading their bodies', async () => {
  for (const [route, assetType] of [
    ['assignments', 'Assignment'],
    ['quizzes', 'Quiz'],
    ['discussion_topics', 'Discussion'],
    ['external_tools', 'ExternalTool'],
  ]) {
    const job = run(`/courses/101/${route}/501?x=1`);
    assert.equal((await job.result).moduleItemId, '12');
    assert.equal(job.calls.length, 1);
    const request = new URL(job.calls[0].url);
    assert.equal(request.origin, origin);
    assert.equal(request.pathname, '/api/v1/courses/101/module_item_sequence');
    assert.equal(request.searchParams.get('asset_type'), assetType);
    assert.equal(request.searchParams.get('asset_id'), '501');
  }
});

test('known module item query and route IDs resolve without any API request', async () => {
  for (const path of [
    '/courses/101/assignments/501?module_item_id=12',
    '/courses/101/modules/items/12',
    '/courses/101/modules/items/12/?x=1',
  ]) {
    const job = run(path);
    assert.equal((await job.result).moduleItemId, '12');
    assert.equal(job.calls.length, 0);
  }
});

test('ambiguous, missing and invalid current IDs never select an arbitrary placement', async () => {
  for (const body of [
    { items: [] },
    { items: [{ current: null }] },
    { items: [{ current: { id: '../users' } }] },
    { items: [{ current: { id: 12 } }, { current: { id: 13 } }] },
    { items: [{ current: { id: 12 } }, { current: { id: 12 } }] },
    {},
  ]) {
    assert.equal((await run('/courses/101/assignments/501', { body }).result).moduleItemId, null);
  }
});

test('Pages, unknown paths and malformed module item hints produce no external or page requests', async () => {
  for (const path of [
    '/courses/101/pages/lecture',
    '/courses/101',
    '/courses/101/modules',
    '/courses/101/assignments/501?module_item_id=../users',
    '/courses/101/modules/items/12-evil',
  ]) {
    const job = run(path);
    assert.equal((await job.result).moduleItemId, null);
    assert.equal(job.calls.length, 0);
  }
});

test('rejects wrong courses, stale requested URLs and origin or course lookalikes before fetching', async () => {
  for (const options of [
    { courseId: '102' },
    { requestUrl: `${origin}/courses/101/assignments/999` },
    { actualUrl: `${origin}/courses/1010/assignments/501` },
    { actualUrl: 'https://msjc.instructure.com.evil.test/courses/101/assignments/501' },
    { actualUrl: 'http://msjc.instructure.com/courses/101/assignments/501' },
    { actualUrl: `${origin}/courses/101%2Fassignments/501` },
  ]) {
    const job = run('/courses/101/assignments/501', options);
    await assert.rejects(job.result, /course|Canvas|changed|tab/i);
    assert.equal(job.calls.length, 0);
  }
});

test('navigation while fetch or JSON parsing awaits fences the old placement result', async () => {
  for (const options of [
    { beforeResponse: `${origin}/courses/101/assignments/999` },
    { beforeJson: `${origin}/courses/102/assignments/501` },
    { beforeJson: `${origin}/courses/101/assignments/501#new-section` },
  ]) {
    const job = run('/courses/101/assignments/501', options);
    await assert.rejects(job.result, /changed|course|tab/i);
    assert.equal(job.calls.length, 1);
  }
});

test('permission and sign-in responses are explicit errors rather than successful placements', async () => {
  for (const options of [{ status: 403 }, { type: 'text/html' }]) {
    await assert.rejects(
      run('/courses/101/assignments/501', options).result,
      /403|JSON|sign in|Canvas/i,
    );
  }
});

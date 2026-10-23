import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fetchFileMetadata } from '../src/canvas/file-reader.js';
const request = { courseId: '50427', moduleId: '651772', itemId: '5730593', fileId: '20456581' };
const origin = 'https://msjc.instructure.com';
function run(data, replies, locationUrl = `${origin}/courses/50427/modules`) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'same-origin');
    const reply = replies.shift();
    assert.ok(reply, `Unexpected request ${url}`);
    return new Response(reply.body || JSON.stringify(reply.json || {}), {
      status: reply.status || 200,
      headers: { 'content-type': reply.type || 'application/json' },
    });
  };
  const fn = vm.runInNewContext(`(${fetchFileMetadata.toString()})`, {
    fetch,
    location: new URL(locationUrl),
    URL,
    AbortSignal,
  });
  return { calls, result: fn(data) };
}
const metadata = {
  id: 20456581,
  display_name: 'Lecture.pdf',
  'content-type': 'application/pdf',
  size: 20,
  url: `${origin}/files/20456581/download?verifier=secret`,
  locked_for_user: false,
};

test('reads only file metadata and returns a stable authenticated download link', async () => {
  const job = run(request, [{ json: metadata }]);
  const result = await job.result;
  assert.equal(result.status, 'available');
  assert.equal(result.format, 'file');
  assert.equal(
    result.file.downloadUrl,
    `${origin}/courses/50427/files/20456581/download?download_frd=1`,
  );
  assert.equal(result.file.sourceUrl, `${origin}/courses/50427/files/20456581`);
  assert.equal(result.file.name, 'Lecture.pdf');
  assert.equal(result.file.size, 20);
  assert.deepEqual(job.calls, [`${origin}/api/v1/courses/50427/files/20456581`]);
  assert.doesNotMatch(JSON.stringify(result), /secret|public_url|base64/);
});

test('resolves missing file IDs and supports non-PDF and large files without conversion', async () => {
  const job = run({ ...request, fileId: null }, [
    { json: { type: 'File', content_id: 20456581 } },
    {
      json: {
        ...metadata,
        size: 100 * 1024 * 1024,
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        display_name: 'Notes.docx',
      },
    },
  ]);
  const result = await job.result;
  assert.equal(result.status, 'available');
  assert.equal(result.file.name, 'Notes.docx');
  assert.equal(job.calls.length, 2);
});

test('reports actual locked, login, and permission errors explicitly', async () => {
  for (const replies of [
    [{ json: { ...metadata, locked_for_user: true } }],
    [{ body: '<h1>Login</h1>', type: 'text/html' }],
    [{ status: 403 }],
  ]) {
    const result = await run(request, replies).result;
    assert.ok(['error', 'locked'].includes(result.status));
    assert.ok(result.error);
    assert.equal(result.file, undefined);
  }
});

test('rejects another course or invalid IDs before requesting metadata', async () => {
  for (const [data, location] of [
    [request, `${origin}/courses/50618/modules`],
    [{ ...request, fileId: '../users' }, undefined],
  ]) {
    const job = run(data, [], location);
    assert.equal((await job.result).status, 'error');
    assert.equal(job.calls.length, 0);
  }
});

test('keeps module-linked files available when hidden from the Files list but not locked', async () => {
  const result = await run(request, [
    { json: { ...metadata, hidden_for_user: true, locked_for_user: false } },
  ]).result;
  assert.equal(result.status, 'available');
  assert.ok(result.file.downloadUrl);
});

test('reads file access from same-course pages, assignments and course root', async () => {
  for (const route of ['pages/lecture', 'assignments/1', '']) {
    const job = run(request, [{ json: metadata }], `${origin}/courses/50427/${route}`);
    assert.equal((await job.result).status, 'available');
    assert.equal(job.calls.length, 1);
  }
});

test('rejects course-ID and host lookalikes without reading metadata', async () => {
  for (const url of [
    `${origin}/courses/504270/pages/x`,
    `${origin}/courses/50427-evil/assignments/1`,
    'https://msjc.instructure.com.evil.test/courses/50427/pages/x',
  ]) {
    const job = run(request, [], url);
    assert.equal((await job.result).status, 'error');
    assert.equal(job.calls.length, 0);
  }
});

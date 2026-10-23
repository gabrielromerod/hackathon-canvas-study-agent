import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFileMetadata } from '../src/course/file-loader.js';
const file = (id, extra = {}) => ({
  id,
  type: 'Attachment',
  fileId: id,
  title: `${id}.pdf`,
  locked: false,
  ...extra,
});
const snapshot = (items) => ({ courseId: '50427', modules: [{ id: '10', items }] });
const available = (id) => ({
  status: 'available',
  format: 'file',
  file: {
    id,
    name: `${id}.pdf`,
    downloadUrl: `https://msjc.instructure.com/courses/50427/files/${id}/download?download_frd=1`,
  },
});

test('loads file access metadata, deduplicates IDs, and retries only actual failures', async () => {
  const data = snapshot([
    file('1'),
    file('2'),
    file('3', { fileId: '1' }),
    { id: '4', type: 'Page' },
  ]);
  const calls = [];
  let fail = true;
  const read = async ({ fileId }) => {
    calls.push(fileId);
    return fileId === '2' && fail ? { status: 'error', error: 'HTTP 403' } : available(fileId);
  };
  await loadFileMetadata(data, read);
  assert.equal(data.fileSummary.failed, 1);
  fail = false;
  await loadFileMetadata(data, read);
  assert.deepEqual(calls, ['1', '2', '2']);
  assert.equal(data.fileSummary.available, 3);
  assert.equal(data.modules[0].items[0].content.file.id, '1');
  assert.equal(data.modules[0].items[3].content, undefined);
});

test('keeps locked and inaccessible files explicit without treating them as converted text', async () => {
  const data = snapshot([file('1', { locked: true }), file('2')]);
  await loadFileMetadata(data, async () => {
    throw new Error('HTTP 403');
  });
  assert.deepEqual(data.fileSummary, { total: 2, available: 0, failed: 1, locked: 1, pending: 0 });
  assert.equal(data.modules[0].items[0].content.status, 'locked');
  assert.equal(data.modules[0].items[1].content.error, 'HTTP 403');
});

test('awaits file persistence and stops after cancellation during that save', async () => {
  const data = snapshot([file('1'), file('2')]);
  const calls = [],
    saves = [];
  let active = true;
  await loadFileMetadata(
    data,
    async ({ fileId }) => {
      calls.push(fileId);
      return available(fileId);
    },
    undefined,
    {
      shouldContinue: () => active,
      onItem: async (moduleId, item) => {
        await new Promise((resolve) => setImmediate(resolve));
        saves.push([moduleId, item.id]);
        active = false;
      },
    },
  );
  assert.deepEqual(calls, ['1']);
  assert.deepEqual(saves, [['10', '1']]);
  assert.equal(data.modules[0].items[1].content, undefined);
});

test('discards an in-flight file result after cancellation', async () => {
  const data = snapshot([file('1'), file('2')]);
  let active = true,
    resolve;
  const saves = [];
  const loading = loadFileMetadata(
    data,
    ({ fileId }) =>
      fileId === '1'
        ? new Promise((done) => {
            resolve = done;
          })
        : Promise.resolve(available(fileId)),
    undefined,
    { shouldContinue: () => active, onItem: () => saves.push('saved') },
  );
  active = false;
  resolve(available('1'));
  await loading;
  assert.equal(data.modules[0].items[0].content, undefined);
  assert.deepEqual(saves, []);
});

test('does not mutate locked files when the import was already cancelled', async () => {
  const data = snapshot([file('1', { locked: true }), file('2')]);
  const before = structuredClone(data);
  await loadFileMetadata(
    data,
    () => {
      throw new Error('Must not read');
    },
    () => {
      throw new Error('Must not report');
    },
    { shouldContinue: () => false },
  );
  assert.deepEqual(data, before);
});

test('persists locked and failed file states and propagates persistence errors', async () => {
  const data = snapshot([file('1', { locked: true }), file('2')]);
  const reads = [],
    saved = [];
  await loadFileMetadata(
    data,
    async ({ fileId }) => {
      reads.push(fileId);
      return { status: 'error', error: 'HTTP 403' };
    },
    undefined,
    { onItem: async (moduleId, item) => saved.push([moduleId, item.id, item.content.status]) },
  );
  assert.deepEqual(reads, ['2']);
  assert.deepEqual(saved, [
    ['10', '1', 'locked'],
    ['10', '2', 'error'],
  ]);
  await assert.rejects(
    loadFileMetadata(snapshot([file('3')]), async () => available('3'), undefined, {
      onItem: async () => {
        throw new Error('Save failed');
      },
    }),
    /Save failed/,
  );
});

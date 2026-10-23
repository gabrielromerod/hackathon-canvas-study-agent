import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaderController } from '../src/course/controller.js';
const context = (id = '50427') => ({
  courseId: id,
  tabId: 7,
  windowId: 1,
  url: `https://msjc.instructure.com/courses/${id}/pages/a`,
});
const snapshot = (id = '50427') => ({
  courseId: id,
  courseTitle: 'Calculus',
  sourceUrl: `https://msjc.instructure.com/courses/${id}/modules`,
  extractedAt: '2026-10-23T00:00:00Z',
  warnings: [],
  itemCount: 2,
  modules: [
    {
      id: '1',
      title: 'Week 1',
      week: 1,
      items: [
        {
          id: '11',
          type: 'Page',
          title: 'Lecture',
          pageId: '22',
          content: { status: 'not_loaded' },
        },
        {
          id: '12',
          type: 'Attachment',
          fileId: '33',
          title: 'Review.pdf',
          content: { status: 'not_loaded' },
        },
      ],
    },
  ],
});
function setup(overrides = {}) {
  const saved = [];
  let gen = 0;
  const records = new Map();
  const rpc = async (method, p) => {
    if (method === 'getCourse')
      return records.get(p.courseId) || { snapshot: null, selection: null };
    if (method === 'getChatState') return { threads: [], activeThreadId: null };
    if (method === 'claimImport') return { acquired: true, generation: ++gen };
    if (method === 'saveSnapshot') {
      saved.push(structuredClone(p.snapshot));
      records.set(p.courseId, { snapshot: structuredClone(p.snapshot) });
      return true;
    }
    if (method === 'getLastCourse') return null;
    return true;
  };
  const source = {
    discover: async (c) => snapshot(c.courseId),
    readPage: async () => ({
      status: 'loaded',
      html: '<p>complete</p>',
      sourceUrl: 'https://msjc.instructure.com/courses/50427/pages/a',
      pageId: 22,
    }),
    readFile: async () => ({
      status: 'available',
      format: 'file',
      file: {
        id: '33',
        name: 'Review.pdf',
        size: 20,
        downloadUrl: 'https://msjc.instructure.com/courses/50427/files/33/download?download_frd=1',
      },
    }),
    ...overrides,
  };
  const controller = createReaderController({
    rpc,
    source,
    convert: () => ({ markdown: 'Complete **lesson**', warnings: [] }),
  });
  return { controller, saved, records };
}

test('connects from a lecture, automatically reads Pages and file metadata, and exports schema3', async () => {
  const { controller, saved } = setup();
  await controller.connect(context());
  await controller.whenIdle();
  const data = JSON.parse(await controller.exportCourse());
  assert.equal(data.course.modules[0].lessons[0].content.markdown, 'Complete **lesson**');
  assert.equal(data.summary.files.available, 1);
  assert.ok(saved.length >= 3);
  assert.equal(controller.state.busy, false);
});

test('restores complete cached data without repeating reads and stays usable while disconnected', async () => {
  let reads = 0;
  const { controller, records } = setup({
    discover: async () => {
      reads++;
      return snapshot();
    },
  });
  const cached = snapshot();
  cached.modules[0].items[0].content = { status: 'loaded', format: 'markdown', markdown: 'Saved' };
  cached.modules[0].items[1].content = { status: 'available', format: 'file', file: { id: '33' } };
  records.set('50427', { snapshot: cached });
  await controller.connect(context());
  await controller.whenIdle();
  assert.equal(reads, 0);
  await controller.connect({ courseId: null, tabId: 7, windowId: 1 });
  assert.equal(controller.state.snapshot.courseId, '50427');
  assert.equal(controller.state.connected, false);
});

test('ignores an old-course discovery that finishes after switching course', async () => {
  let finish;
  const first = new Promise((r) => {
    finish = r;
  });
  const { controller, saved } = setup({
    discover: (c) => (c.courseId === '50427' ? first : Promise.resolve(snapshot(c.courseId))),
  });
  await controller.connect(context());
  await new Promise((r) => setImmediate(r));
  await controller.connect(context('50618'));
  finish(snapshot());
  await controller.whenIdle();
  await new Promise((r) => setImmediate(r));
  assert.equal(controller.state.courseId, '50618');
  assert.ok(!saved.some((x) => x.courseId === '50427'));
});

test('closing stops scheduling remaining reads and an export waits for the active read', async () => {
  let resolve;
  let calls = 0;
  const pending = new Promise((r) => {
    resolve = r;
  });
  const { controller } = setup({
    readPage: async () => {
      calls++;
      return pending;
    },
  });
  await controller.connect(context());
  await new Promise((r) => setImmediate(r));
  const exporting = controller.exportCourse();
  let exported = false;
  exporting.then(
    () => {
      exported = true;
    },
    () => {},
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(exported, false);
  controller.dispose();
  resolve({ status: 'loaded', html: 'x', sourceUrl: 'https://msjc.instructure.com/a' });
  await assert.rejects(exporting, /changed|closed|cancel/i);
  assert.equal(calls, 1);
});

test('keeps export disabled while another window owns the course import', async () => {
  const { controller } = setup();
  await controller.connect(context());
  await controller.whenIdle();
  controller.receive('importStarted', { courseId: '50427' });
  assert.equal(controller.state.busy, true);
  await assert.rejects(controller.exportCourse(), /another window/i);
  controller.receive('importReleased', { courseId: '50427' });
  assert.equal(controller.state.busy, false);
});

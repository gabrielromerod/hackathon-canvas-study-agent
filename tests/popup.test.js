import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, until, origin, modulesUrl } from './fixtures/native-panel-harness.js';

// These original reader regressions now run against the shipped native sidebar.
test('renders course modules, assignment metadata and warnings as safe source text', async (t) => {
  const { root } = await setup(t, { withPage: false, withFile: false });
  root.querySelector('#sources-toggle').click();
  assert.equal(root.querySelectorAll('#source-list > details.module').length, 2);
  assert.match(root.querySelector('#source-summary').textContent, /2 modules/);
  assert.match(root.querySelector('#source-list').textContent, /Due Oct 25/);
  assert.match(root.querySelector('#source-list').textContent, /8 pts/);
  assert.match(
    root.querySelector('#source-list summary').textContent,
    /<img src=x onerror=alert\(1\)>/,
  );
  assert.equal(root.querySelector('#source-list img, #source-list script'), null);
  assert.equal(
    root.querySelector('#source-list a').href,
    `${origin}/courses/50427/modules/items/13`,
  );
  assert.match(root.querySelector('#source-warnings').textContent, /Week 2/);
  assert.equal(root.querySelector('#source-warnings').hidden, false);
  assert.equal(root.querySelector('#export-course').disabled, false);
});

test('export waits for an active lecture read and includes complete Markdown instead of HTML', async (t) => {
  let releasePage,
    pageStarted = false;
  const pending = new Promise((resolve) => {
    releasePage = resolve;
  });
  const fixture = await setup(t, {
    withFile: false,
    waitForRead: false,
    pendingPage: () => {
      pageStarted = true;
      return pending;
    },
  });
  fixture.root.querySelector('#sources-toggle').click();
  await until(() => pageStarted);
  const exporting = fixture.app.exportJson();
  assert.equal(fixture.download(), undefined);
  assert.equal(fixture.root.querySelector('#export-course').disabled, true);
  releasePage();
  await exporting;
  const exported = JSON.parse(await fixture.blob().text());
  const lecture = exported.course.modules[0].lessons.find((item) => item.type === 'Page');
  assert.equal(lecture.content.markdown, '## All concepts\n\nComplete lesson. All **concepts**.');
  assert.equal(lecture.content.format, 'markdown');
  assert.equal(exported.summary.pages.loaded, 1);
  assert.doesNotMatch(JSON.stringify(exported), /<h2>|"html":/);
  assert.match(
    fixture.root.querySelector('.markdown-preview').textContent,
    /Complete lesson\. All \*\*concepts\*\*/,
  );
});

test('automatically reads module-linked content and shows previews without opening Canvas tabs', async (t) => {
  const fixture = await setup(t, { withFile: false, waitForRead: false });
  fixture.root.querySelector('[data-action="modules"]').click();
  await fixture.app.reader.whenIdle();
  assert.equal(fixture.root.querySelector('#sources-view').hidden, false);
  assert.match(fixture.root.querySelector('#source-summary').textContent, /1\/1 pages/);
  assert.match(fixture.root.querySelector('.markdown-preview').textContent, /\*\*concepts\*\*/);
  assert.equal(fixture.root.querySelector('#read-content').disabled, true);
  assert.deepEqual(fixture.navigation, []);
});

test('failed page retrieval stays visible and honest in export, and Read content retries it', async (t) => {
  const fixture = await setup(t, { pageFail: true, withFile: false });
  fixture.root.querySelector('#sources-toggle').click();
  assert.match(fixture.root.querySelector('#source-list').textContent, /403/);
  assert.equal(fixture.root.querySelector('#read-content').disabled, false);
  fixture.root.querySelector('#export-course').click();
  await until(() => fixture.download());
  const exported = JSON.parse(await fixture.blob().text());
  assert.equal(exported.summary.pages.failed, 1);
  assert.equal(
    exported.course.modules[0].lessons.find((item) => item.type === 'Page').content.status,
    'error',
  );
  fixture.setPageFail(false);
  fixture.root.querySelector('#read-content').click();
  await fixture.app.reader.whenIdle();
  assert.match(fixture.root.querySelector('.markdown-preview').textContent, /Complete lesson/);
  assert.doesNotMatch(fixture.root.querySelector('#source-list').textContent, /HTTP 403/);
  assert.match(fixture.root.querySelector('#source-summary').textContent, /1\/1 pages/);
  assert.equal(fixture.root.querySelector('#read-content').disabled, true);
});

test('exports accessible file metadata and authenticated download links without PDF conversion', async (t) => {
  const fixture = await setup(t);
  fixture.root.querySelector('[data-action="files"]').click();
  fixture.root.querySelector('#export-course').click();
  await until(() => fixture.download());
  const text = await fixture.blob().text();
  const exported = JSON.parse(text);
  const pdf = exported.course.modules[0].lessons.find((item) => item.type === 'Attachment');
  assert.equal(pdf.content.status, 'available');
  assert.equal(pdf.content.format, 'file');
  assert.equal(pdf.content.file.name, 'Review.pdf');
  assert.equal(pdf.content.file.mimeType, 'application/pdf');
  assert.equal(pdf.content.file.size, 201304);
  assert.equal(pdf.content.file.requiresCanvasLogin, true);
  assert.equal(exported.summary.files.available, 1);
  assert.equal(exported.summary.pages.loaded, 1);
  assert.equal(fixture.root.querySelector('.file-download').href, pdf.content.file.downloadUrl);
  assert.match(fixture.root.querySelector('#source-summary').textContent, /1\/1 files available/);
  assert.doesNotMatch(text, /pdfContentSummary|OCR|needs_ocr|base64/);
});

test('the native sidebar reads the connected Canvas tab rather than the extension document', async (t) => {
  const fixture = await setup(t);
  assert.equal(fixture.window.location.protocol, 'chrome-extension:');
  assert.equal(fixture.app.reader.state.context.tabId, 7);
  assert.equal(fixture.app.reader.state.snapshot.courseId, '50427');
  assert.equal(
    fixture.app.reader.state.snapshot.modules[0].items.find((item) => item.type === 'Page').content
      .status,
    'loaded',
  );
  assert.deepEqual([...new Set(fixture.injections.map((call) => call.tabId))], [7]);
  assert.deepEqual(fixture.navigation, []);
});

test('connects and reads successfully from course home, lecture and assignment routes', async (t) => {
  for (const route of ['', '/pages/lecture', '/assignments/13']) {
    const fixture = await setup(t, {
      sourceUrl: `${origin}/courses/50427${route}`,
      withFile: false,
    });
    assert.equal(fixture.app.reader.state.connected, true);
    assert.equal(fixture.root.querySelector('#app-error').hidden, true);
    assert.match(fixture.root.querySelector('#course-name').textContent, /MATH-C2210/);
    assert.equal(fixture.root.querySelector('[data-action="export"]').disabled, false);
    assert.equal(
      fixture.app.reader.state.snapshot.modules[0].items.find((item) => item.type === 'Page')
        .content.status,
      'loaded',
    );
    assert.deepEqual(fixture.navigation, []);
  }
});

test('discovery failures remain explicit and cannot export an incorrect empty course', async (t) => {
  const fixture = await setup(t, { discoveryFail: true });
  assert.equal(fixture.root.querySelector('#app-error').hidden, false);
  assert.match(fixture.root.querySelector('#app-error').textContent, /Cannot access/);
  assert.equal(fixture.app.reader.state.snapshot, null);
  assert.equal(fixture.root.querySelector('[data-action="export"]').disabled, true);
  assert.equal(fixture.root.querySelector('#refresh-course').disabled, false);
  await assert.rejects(fixture.app.exportJson(), /Cannot access/);
  assert.equal(fixture.download(), undefined);
  assert.equal(fixture.blob(), undefined);
});

test('exports the complete course as readable local JSON with the expected filename', async (t) => {
  const fixture = await setup(t, { withPage: false, withFile: false });
  fixture.root.querySelector('[data-action="export"]').click();
  await until(() => fixture.download());
  assert.deepEqual(fixture.download(), {
    name: 'canvas-50427-modules.json',
    url: 'blob:local-export',
  });
  assert.equal(fixture.blob().type, 'application/json');
  const text = await fixture.blob().text();
  const exported = JSON.parse(text);
  assert.equal(exported.schemaVersion, 3);
  assert.equal(exported.course.id, '50427');
  assert.equal(exported.course.modules[0].lessons[0].title, 'Homework');
  assert.equal(exported.course.modules[0].lessons[0].points, 8);
  assert.equal(exported.summary.lessonCount, 1);
  assert.equal(exported.summary.moduleCount, 2);
  assert.equal(exported.course.modulesUrl, modulesUrl);
  assert.match(text, /\n  "course": \{/);
  assert.equal(exported.messages, undefined);
});

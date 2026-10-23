import test from 'node:test';
import assert from 'node:assert/strict';
import { createCourseExport, serializeCourseExport } from '../src/course/export.js';

const snapshot = () => ({
  courseId: '50427',
  courseTitle: 'Calculus I',
  sourceUrl: 'https://msjc.instructure.com/courses/50427/modules',
  extractedAt: '2026-10-23T00:00:00Z',
  warnings: [],
  modules: [
    {
      id: '1',
      title: 'Week 1',
      week: 1,
      items: [
        { id: '10', title: 'Lectures', type: 'Section' },
        {
          id: '11',
          title: 'Functions',
          type: 'Page',
          pageId: '123',
          url: 'https://msjc.instructure.com/courses/50427/modules/items/11',
          content: {
            status: 'loaded',
            format: 'markdown',
            markdown: '# Functions\n\nAll content.',
            pageId: 123,
            sourceUrl: 'https://msjc.instructure.com/courses/50427/pages/functions',
          },
        },
        {
          id: '12',
          title: 'Review.pdf',
          type: 'Attachment',
          fileId: '456',
          content: {
            status: 'available',
            format: 'file',
            file: {
              id: '456',
              name: 'Review.pdf',
              mimeType: 'application/pdf',
              size: 100,
              downloadUrl:
                'https://msjc.instructure.com/courses/50427/files/456/download?download_frd=1',
            },
          },
        },
        {
          id: '13',
          title: 'Homework',
          type: 'Assignment',
          url: 'https://msjc.instructure.com/courses/50427/modules/items/13',
          points: 8,
          dueDate: 'Oct 25',
        },
        { id: '14', title: 'Empty section', type: 'Section' },
      ],
    },
    { id: '2', title: 'Week 2', week: 2, items: [] },
  ],
});

test('exports course → modules → lessons → content and preserves sections and order', () => {
  const data = snapshot();
  const result = createCourseExport(data);
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.course.id, '50427');
  assert.equal(result.course.title, 'Calculus I');
  const module = result.course.modules[0];
  assert.deepEqual(
    module.lessons.map((l) => l.id),
    ['11', '12', '13'],
  );
  assert.deepEqual(
    module.sections.map((s) => s.title),
    ['Lectures', 'Empty section'],
  );
  assert.deepEqual(module.lessons[0].section, { id: '10', title: 'Lectures' });
  assert.equal(module.lessons[0].content.markdown, '# Functions\n\nAll content.');
  assert.equal(module.lessons[1].content.file.id, '456');
  assert.equal(module.lessons[2].content.status, 'link_only');
  assert.equal(module.lessons[2].content.format, 'link');
  assert.equal(module.lessons[2].points, 8);
  assert.equal(result.summary.lessonCount, 3);
  assert.equal(result.summary.sectionCount, 2);
  assert.equal(result.summary.pages.loaded, 1);
  assert.equal(result.summary.files.available, 1);
  assert.deepEqual(result.course.modules[1].lessons, []);
  assert.equal(data.modules[0].items.length, 5);
  assert.equal(result.modules, undefined);
});

test('exports honest failed/locked states and readable indented JSON', () => {
  const data = snapshot();
  data.modules[0].items[1].content = { status: 'error', error: 'HTTP 403' };
  data.modules[0].items[2].content = { status: 'locked', error: 'Locked by Canvas' };
  const text = serializeCourseExport(data);
  assert.match(text, /\n  "course": \{\n    "id":/);
  const result = JSON.parse(text);
  assert.equal(result.course.modules[0].lessons[0].content.error, 'HTTP 403');
  assert.equal(result.summary.pages.failed, 1);
  assert.equal(result.summary.files.locked, 1);
  assert.doesNotMatch(text, /pdfContentSummary|needsOcr|base64|"html":/);
});

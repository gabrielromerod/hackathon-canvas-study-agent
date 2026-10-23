import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractModules } from '../src/canvas/extractor.js';

const url = 'https://msjc.instructure.com/courses/50427/modules';
const fixture = `<!doctype html><title>Course Modules: Calculus I</title>
<div id="breadcrumbs"><a href="/courses/50427">MATH-C2210-1354</a></div>
<div id="context_modules">
 <div class="context_module" id="context_module_10" data-module-id="10">
  <h2>Week 10 - Applications</h2><span class="name">Week 10 - Applications</span>
  <div style="display:none"><ul>
   <li class="context_module_item" id="context_module_item_100"><span class="type_icon" title="Context Module Sub Header"></span><h3><span class="item_name"><span class="title locked_title">Readings</span></span></h3></li>
   <li class="context_module_item" id="context_module_item_101"><span class="type_icon" title="Assignment"></span><span class="item_name"><a class="title item_link" href="/courses/50427/modules/items/101"> Homework   4.3 </a><span class="title locked_title">Homework 4.3</span></span><div class="due_date_display">Oct 18</div><div class="points_possible_display">0 pts</div></li>
  </ul></div>
 </div>
 <div class="context_module" id="context_module_9" data-module-id="9"><h2>Week 9 - Related Rates</h2><ul>
  <li class="context_module_item" id="context_module_item_90"><span class="type_icon" title="Page"></span><span class="item_name"><span class="title locked_title">Locked lecture</span></span></li>
  <li class="context_module_item" id="context_module_item_91"><span class="type_icon" title="External Url"></span><span class="item_name"><a href="javascript:alert(1)">&lt;script&gt;alert(1)&lt;/script&gt;</a></span></li>
 </ul></div>
 <div class="context_module" id="context_module_11" data-module-id="11"><h2>Exam 1</h2><ul></ul></div>
 <div class="context_module" id="context_module_blank"><h2>Template</h2></div>
</div>`;
const doc = (html = fixture) => new JSDOM(html, { url }).window.document;

test('reads every module in source order, including collapsed week rows and section headers', () => {
  const result = extractModules(doc(), url);
  assert.equal(result.courseId, '50427');
  assert.equal(result.courseTitle, 'MATH-C2210-1354');
  assert.deepEqual(
    result.modules.map((m) => [m.id, m.week, m.title]),
    [
      ['10', 10, 'Week 10 - Applications'],
      ['9', 9, 'Week 9 - Related Rates'],
      ['11', null, 'Exam 1'],
    ],
  );
  assert.equal(result.itemCount, 4);
  assert.deepEqual(
    result.modules[0].items.map((i) => i.title),
    ['Readings', 'Homework 4.3'],
  );
  assert.equal(result.modules[0].items[0].type, 'Section');
  assert.equal(result.modules[0].items[0].locked, false);
  assert.equal(
    result.modules[0].items[1].url,
    'https://msjc.instructure.com/courses/50427/modules/items/101',
  );
  assert.equal(result.modules[0].items[1].dueDate, 'Oct 18');
  assert.equal(result.modules[0].items[1].points, 0);
});

test('preserves locked and empty modules without inventing dates, points, or weeks', () => {
  const result = extractModules(doc(), url);
  assert.equal(result.modules[1].items[0].locked, true);
  assert.equal(result.modules[1].items[0].url, null);
  assert.equal(result.modules[1].items[0].dueDate, null);
  assert.equal(result.modules[1].items[0].points, null);
  assert.deepEqual(result.modules[2].items, []);
  assert.match(result.warnings.join(' '), /Exam 1/);
});

test('keeps untrusted titles as text and excludes executable URLs', () => {
  const item = extractModules(doc(), url).modules[1].items[1];
  assert.equal(item.title, '<script>alert(1)</script>');
  assert.equal(item.url, null);
});

test('rejects other hosts, course home pages, and login pages', () => {
  for (const invalid of [
    'https://example.com/courses/50427/modules',
    'https://msjc.instructure.com/courses/50427',
    'https://msjc.instructure.com/login',
  ]) {
    assert.throws(() => extractModules(doc(), invalid), /Modules page/);
  }
});

test('distinguishes missing page markup from a genuinely empty modules list', () => {
  assert.throws(() => extractModules(doc('<title>Sign in</title>'), url), /not loaded/);
  const result = extractModules(doc('<title>Modules</title><div id="context_modules"></div>'), url);
  assert.deepEqual(result.modules, []);
  assert.match(result.warnings.join(' '), /No modules/);
});

test('extracts Canvas attachment IDs for file access without visiting the file', () => {
  const root = doc(
    '<title>Modules</title><div id="context_modules"><div class="context_module" id="context_module_1"><h2>Week 1</h2><li class="context_module_item Attachment_20456581" id="context_module_item_5730593"><span class="type_icon" title="Attachment"></span><span class="item_name"><a href="/courses/50427/modules/items/5730593">Lecture.pdf</a></span></li></div></div>',
  );
  assert.equal(extractModules(root, url).modules[0].items[0].fileId, '20456581');
});

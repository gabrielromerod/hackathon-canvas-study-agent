import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMessages } from '../src/chat/view.js';
function setup(message) {
  const { document } = new JSDOM('<div id="welcome"></div><div id="messages"></div>').window;
  return {
    document,
    chat: {
      activeThreadId: 't',
      threads: [
        {
          id: 't',
          messages: [
            { id: 'a', role: 'assistant', createdAt: Date.now(), status: 'complete', ...message },
          ],
        },
      ],
    },
  };
}
test('assistant Markdown is rendered safely with course-validated citations', () => {
  const { document, chat } = setup({
    text: '**Slope** is change [S1]. [S9] <script>alert(1)</script> ![x](https://evil.test/pixel) [bad](javascript:alert(1))',
    sourceRefs: [
      {
        id: 'S1',
        courseId: '101',
        title: 'Slope lecture',
        url: 'https://msjc.instructure.com/courses/101/pages/slope',
      },
    ],
  });
  renderMessages(document, chat);
  assert.equal(document.querySelector('.assistant-message strong')?.textContent, 'Slope');
  assert.equal(document.querySelector('script,img'), null);
  assert.equal(document.querySelector('a[href^="javascript:"]'), null);
  assert.equal(
    document.querySelector('.citation')?.href,
    'https://msjc.instructure.com/courses/101/pages/slope',
  );
  assert.match(document.body.textContent, /S9/);
});
test('foreign citation URLs never become evidence links and prior-chat refs open the saved chat', () => {
  let selected;
  const { document, chat } = setup({
    text: 'Remember [M1] and [S1].',
    sourceRefs: [
      {
        id: 'S1',
        courseId: '101',
        title: 'Foreign',
        url: 'https://msjc.instructure.com/courses/999/pages/slope',
      },
    ],
    memoryRefs: [{ id: 'M1', courseId: '101', threadId: 'old', title: 'Earlier discussion' }],
  });
  renderMessages(document, chat, {
    onSelect: (id) => {
      selected = id;
    },
  });
  assert.equal(document.querySelector('a'), null);
  document.querySelector('.memory-citation').click();
  assert.equal(selected, 'old');
});
test('partial replies show their status and retry only the latest failed answer', () => {
  let retried;
  const { document, chat } = setup({
    text: 'Partial',
    status: 'error',
    error: 'GPU lost',
    turnId: 'turn',
    attempt: 1,
  });
  renderMessages(document, chat, {
    onRetry: (message) => {
      retried = message.id;
    },
  });
  assert.match(document.body.textContent, /GPU lost/);
  document.querySelector('.retry-answer').click();
  assert.equal(retried, 'a');
});

test('grouped citations link each validated source and leave unknown ids unlinked', () => {
  const { document, chat } = setup({
    text: 'Supported [S1, S2, S99].',
    sourceRefs: [
      {
        id: 'S1',
        courseId: '101',
        title: 'One',
        url: 'https://msjc.instructure.com/courses/101/pages/one',
      },
      {
        id: 'S2',
        courseId: '101',
        title: 'Two',
        url: 'https://msjc.instructure.com/courses/101/pages/two',
      },
    ],
  });
  renderMessages(document, chat);
  assert.equal(document.querySelectorAll('.citation').length, 2);
  assert.match(document.body.textContent, /S99/);
});

test('source Markdown link extraction vets HTTPS destinations, resolves relative links, and deduplicates them', async () => {
  const { extractSourceLinks } = await import('../src/chat/source-links.js').catch((error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof extractSourceLinks, 'function');
  const links = extractSourceLinks(
    '[Textbook](https://openstax.org/books/writing-guide/pages/1-introduction) ' +
      '[Again](https://openstax.org/books/writing-guide/pages/1-introduction) ' +
      '[Lesson](../pages/lesson) [Foreign](/courses/999/pages/other) ' +
      '[Other Canvas](https://other.instructure.com/courses/101/pages/other) ' +
      '[Code](javascript:alert(1)) [HTTP](http://example.com/book) ' +
      '[Credentials](https://user:secret@example.com/book) ' +
      '![Tracking](https://example.com/pixel) <a href="https://example.com/html">HTML</a>',
    'https://msjc.instructure.com/courses/101/pages/start',
    '101',
  );
  assert.deepEqual(links, [
    { title: 'Textbook', url: 'https://openstax.org/books/writing-guide/pages/1-introduction' },
    { title: 'Lesson', url: 'https://msjc.instructure.com/courses/101/pages/lesson' },
  ]);
  assert.deepEqual(
    extractSourceLinks(
      '[Book](https://openstax.org/books/test)',
      'https://msjc.instructure.com/courses/999/pages/a',
      '101',
    ),
    [],
  );
});

test('only exact supplied course and textbook URLs remain live in assistant Markdown', () => {
  const textbook = 'https://openstax.org/books/writing-guide/pages/1-introduction';
  const source = 'https://msjc.instructure.com/courses/101/pages/reading';
  const { document, chat } = setup({
    text:
      `[Read the chapter](${textbook}) [Course page](${source}) ` +
      '[Invented](https://openstax.org/books/writing-guide/pages/invented) ' +
      '[Foreign](https://msjc.instructure.com/courses/999/pages/reading) [Bad](javascript:alert(1))',
    sourceRefs: [
      {
        id: 'S1',
        courseId: '101',
        title: 'Reading',
        url: source,
        links: [
          { title: 'Writing Guide', url: textbook },
          { title: 'Foreign', url: 'https://msjc.instructure.com/courses/999/pages/reading' },
          { title: 'Bad', url: 'javascript:alert(1)' },
        ],
      },
    ],
  });
  renderMessages(document, chat);
  const anchors = [...document.querySelectorAll('.assistant-body a')];
  assert.deepEqual(
    anchors.map((a) => a.href),
    [textbook, source],
  );
  for (const anchor of anchors) {
    assert.equal(anchor.target, '_blank');
    assert.equal(anchor.rel, 'noopener noreferrer');
  }
  assert.match(document.querySelector('.assistant-body').textContent, /Invented/);
});

test('source links are visible below the reply and deduplicated across repeated source chunks', () => {
  const source = 'https://msjc.instructure.com/courses/101/pages/reading';
  const textbook = 'https://openstax.org/books/writing-guide/pages/1-introduction';
  const { document, chat } = setup({
    text: 'Here is the reading.',
    sourceRefs: [
      {
        id: 'S1',
        courseId: '101',
        title: 'Reading',
        url: source,
        links: [{ title: 'Writing Guide', url: textbook }],
      },
      {
        id: 'S2',
        courseId: '101',
        title: 'Reading',
        url: source,
        links: [{ title: 'Writing Guide', url: textbook }],
      },
      {
        id: 'S3',
        courseId: '101',
        title: 'Practice',
        url: 'https://msjc.instructure.com/courses/101/pages/practice',
      },
    ],
  });
  renderMessages(document, chat);
  const visible = [...document.querySelectorAll('.reply-source-links a')];
  assert.deepEqual(
    visible.map((a) => a.href),
    [source, textbook],
  );
  assert.ok(visible.every((a) => !a.closest('details')));
  const listed = [...document.querySelectorAll('.reply-source-links a, .reply-references a')];
  assert.equal(listed.length, 3);
  assert.equal(new Set(listed.map((a) => a.href)).size, 3);
  assert.equal(
    document.querySelector('.reply-references a').textContent.includes('Practice'),
    true,
  );
});

test('renders inline and display fractions as MathML while preserving LaTeX escapes and code examples', () => {
  const { document, chat } = setup({
    text:
      String.raw`A fraction $\frac{1}{2}$ and set $\{x\}$.

$$\frac{x+1}{x-1}$$

Code: ` +
      '`$\\frac{1}{2}$`' +
      String.raw` and escaped \$5.`,
  });
  renderMessages(document, chat);
  assert.equal(document.querySelectorAll('.katex').length, 3);
  assert.equal(document.querySelectorAll('math mfrac').length, 2);
  assert.equal(document.querySelectorAll('.katex-display').length, 1);
  assert.match(document.querySelector('.assistant-body code').textContent, /\\frac/);
  assert.match(document.querySelector('.assistant-body').textContent, /escaped \$5/);
  assert.match(document.querySelectorAll('math')[1].textContent, /\{x\}/);
});

test('math commands cannot create links, scripts, or reuse macros across expressions', () => {
  const { document, chat } = setup({
    text: String.raw`$\href{https://evil.test}{click}$ $\text{<script>alert(1)</script>}$ $\gdef\privateMacro{secret}\privateMacro$ $\privateMacro$`,
  });
  renderMessages(document, chat);
  assert.equal(document.querySelector('a,script,img,iframe'), null);
  assert.ok(document.querySelector('math'));
  const finalMath = [...document.querySelectorAll('math')].at(-1);
  assert.match(finalMath.textContent, /privateMacro/);
  assert.doesNotMatch(finalMath.textContent, /secret/);
});

test('visible source links prioritize the source actually cited in the answer', () => {
  const { document, chat } = setup({
    text: 'The requirement is on the Week One road map [S8].',
    sourceRefs: [
      {
        id: 'S1',
        courseId: '101',
        title: 'Week Two',
        url: 'https://msjc.instructure.com/courses/101/pages/week-two',
      },
      {
        id: 'S8',
        courseId: '101',
        title: 'Week One',
        url: 'https://msjc.instructure.com/courses/101/pages/week-one',
      },
    ],
  });
  renderMessages(document, chat);
  assert.equal(document.querySelector('.reply-source-links a').textContent, 'Week One');
});

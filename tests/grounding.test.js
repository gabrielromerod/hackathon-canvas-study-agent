import test from 'node:test';
import assert from 'node:assert/strict';

// Import optionally so the pre-implementation milestone fails on the missing
// capability, while keeping syntax/dependency errors visible.
const { buildGroundedPrompt } = await import('../src/chat/grounding.js').catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/src/chat/grounding.js'))
    return {};
  throw error;
});

// Deterministic token accounting includes Unicode characters and chat-template
// overhead. Production supplies the installed model's actual tokenizer adapter.
const tokenizer = {
  countText: (text) => Array.from(text).length,
  countMessages(messages) {
    return 3 + messages.reduce((total, message) => total + this.countText(message.content) + 4, 0);
  },
};
const courseScope = { kind: 'course' };
const pageScope = (itemId = '12') => ({ kind: 'page', moduleId: '1', itemId });
const sourceUrl = (itemId) => `https://msjc.instructure.com/courses/101/pages/page-${itemId}`;
const page = (id, title, markdown, extra = {}) => ({
  id,
  type: 'Page',
  title,
  url: sourceUrl(id),
  locked: false,
  content: { status: 'loaded', format: 'markdown', markdown, sourceUrl: sourceUrl(id) },
  ...extra,
});
function snapshot() {
  return {
    schemaVersion: 2,
    courseId: '101',
    courseTitle: 'Calculus',
    sourceUrl: 'https://msjc.instructure.com/courses/101/modules',
    extractedAt: '2026-10-23T12:00:00Z',
    warnings: [],
    itemCount: 7,
    modules: [
      {
        id: '1',
        title: 'Week 1',
        week: 1,
        items: [
          { id: '11', type: 'Section', title: 'Limits' },
          page(
            '12',
            'One-sided limits',
            'LEFT_LIMIT_EVIDENCE: a left limit approaches a value from smaller inputs.',
          ),
          {
            id: '13',
            type: 'Assignment',
            title: 'Limits homework',
            dueDate: '2026-10-25T12:00:00Z',
            points: 8,
            locked: false,
            url: 'https://msjc.instructure.com/courses/101/assignments/13',
          },
          { id: '14', type: 'Section', title: 'Derivatives' },
          page(
            '15',
            'Derivative definition',
            'DERIVATIVE_EVIDENCE: the derivative measures instantaneous rate of change.',
          ),
        ],
      },
      {
        id: '2',
        title: 'Week 2',
        week: 2,
        items: [
          { id: '21', type: 'Section', title: 'Integrals' },
          page(
            '22',
            'Integral definition',
            'INTEGRAL_EVIDENCE: integration accumulates quantities over an interval.',
          ),
        ],
      },
    ],
  };
}
function chat() {
  return {
    courseId: '101',
    activeThreadId: 'current',
    threads: [
      {
        id: 'current',
        title: 'Current conversation',
        createdAt: 1,
        updatedAt: 1,
        scope: courseScope,
        messages: [],
        draft: '',
      },
    ],
  };
}
function input(extra = {}) {
  return {
    snapshot: snapshot(),
    chat: chat(),
    threadId: 'current',
    scope: courseScope,
    text: 'Explain the derivative definition.',
    tokenizer,
    ...extra,
  };
}
async function build(args) {
  assert.equal(typeof buildGroundedPrompt, 'function', 'buildGroundedPrompt must be implemented');
  return await buildGroundedPrompt(args);
}
const promptText = (result) => result.messages.map((message) => message.content).join('\n');
const evidenceText = (result) => `${promptText(result)}\n${result.warnings.join('\n')}`;
const message = (id, text, extra = {}) => ({
  id,
  text,
  createdAt: 1,
  scope: courseScope,
  ...extra,
});

// The incorrect branches these tests catch are scope widening, grounding on
// inaccessible bodies, cross-course history leakage, and inaccurate budgeting.
test('section scope ends at the next Section and excludes sibling modules', async () => {
  const result = await build(
    input({
      scope: { kind: 'section', moduleId: '1', sectionId: '11' },
      text: 'Summarize the limits section and its homework.',
    }),
  );
  assert.equal(result.scope.kind, 'section');
  assert.match(promptText(result), /LEFT_LIMIT_EVIDENCE/);
  assert.doesNotMatch(promptText(result), /DERIVATIVE_EVIDENCE|INTEGRAL_EVIDENCE/);
  assert.ok(result.sourceRefs.some((ref) => ref.itemId === '12'));
  assert.ok(
    result.sourceRefs.every((ref) => ref.moduleId === '1' && ['12', '13'].includes(ref.itemId)),
  );
});

test('page scope includes only the chosen Page even when the question matches a sibling better', async () => {
  const result = await build(
    input({ scope: pageScope(), text: 'Explain derivatives and integrals from this page.' }),
  );
  assert.match(promptText(result), /LEFT_LIMIT_EVIDENCE/);
  assert.doesNotMatch(promptText(result), /DERIVATIVE_EVIDENCE|INTEGRAL_EVIDENCE/);
  assert.ok(result.sourceRefs.length > 0);
  assert.ok(result.sourceRefs.every((ref) => ref.moduleId === '1' && ref.itemId === '12'));
});

test('module scope includes its sources and cannot retrieve another module', async () => {
  const result = await build(
    input({
      scope: { kind: 'module', moduleId: '1' },
      text: 'Give an overview of limits, derivatives and integration.',
    }),
  );
  assert.doesNotMatch(promptText(result), /INTEGRAL_EVIDENCE/);
  assert.ok(result.sourceRefs.some((ref) => ['12', '15'].includes(ref.itemId)));
  assert.ok(result.sourceRefs.every((ref) => ref.moduleId === '1'));
});

test('an omitted scope restores the selected conversation scope', async () => {
  const state = chat();
  state.threads[0].scope = pageScope('15');
  const args = input({ chat: state });
  delete args.scope;
  const result = await build(args);
  assert.equal(result.scope.kind, 'page');
  assert.equal(result.scope.itemId, '15');
  assert.doesNotMatch(promptText(result), /LEFT_LIMIT_EVIDENCE|INTEGRAL_EVIDENCE/);
});

test('locked or unloaded page bodies cannot become source evidence and file contents remain unavailable', async () => {
  const course = snapshot();
  course.modules[0].items.push(
    page('16', 'Locked nebula lecture', 'LOCKED_BODY_SECRET about nebula', { locked: true }),
    page('17', 'Unread nebula lecture', 'UNAVAILABLE_BODY_SECRET about nebula', {
      content: {
        status: 'error',
        markdown: 'UNAVAILABLE_BODY_SECRET about nebula',
        error: 'HTTP 403',
      },
    }),
    {
      id: '18',
      type: 'Attachment',
      title: 'Review.pdf',
      fileId: '33',
      locked: false,
      content: {
        status: 'available',
        format: 'file',
        file: {
          id: '33',
          name: 'Review.pdf',
          mimeType: 'application/pdf',
          size: 201304,
          sourceUrl: 'https://msjc.instructure.com/courses/101/files/33',
          downloadUrl: 'https://msjc.instructure.com/courses/101/files/33/download?download_frd=1',
        },
      },
    },
  );
  const result = await build(
    input({
      snapshot: course,
      text: 'What does Review.pdf say about nebula, and how many points is Limits homework?',
    }),
  );
  assert.doesNotMatch(promptText(result), /LOCKED_BODY_SECRET|UNAVAILABLE_BODY_SECRET/);
  assert.match(promptText(result), /Review\.pdf/);
  assert.match(
    evidenceText(result),
    /metadata[- ]only|(?:content|body|text) (?:is )?(?:unavailable|not (?:read|loaded))/i,
  );
  assert.match(promptText(result), /8/);
  assert.ok(result.sourceRefs.some((ref) => ref.itemId === '18'));
});

test('same-course checks reject another course chat envelope and untagged chat state', async () => {
  await assert.rejects(() => build(input({ chat: { ...chat(), courseId: '102' } })), /course/i);
  const untagged = chat();
  delete untagged.courseId;
  await assert.rejects(() => build(input({ chat: untagged })), /course/i);
});

test('missing conversations and stale or mismatched scopes fail instead of broadening retrieval', async () => {
  await assert.rejects(() => build(input({ threadId: 'missing' })), /thread|conversation/i);
  for (const scope of [
    { kind: 'module', moduleId: '404' },
    { kind: 'section', moduleId: '1', sectionId: '21' },
    { kind: 'page', moduleId: '1', itemId: '22' },
    { kind: 'page', moduleId: '1', itemId: '13' },
  ]) {
    await assert.rejects(() => build(input({ scope })), /scope|source|page|module|section/i);
  }
});

test('recent active conversation preserves roles while the new question appears last exactly once', async () => {
  const state = chat();
  state.threads[0].messages = [
    message('u1', 'Please use a small example.'),
    message('a1', 'Earlier derivative explanation.', { role: 'assistant', status: 'complete' }),
  ];
  const text = 'Now explain the left limit.';
  const result = await build(input({ chat: state, text }));
  assert.deepEqual(result.messages.at(-1), { role: 'user', content: text });
  assert.ok(
    result.messages.some(
      (entry) => entry.role === 'user' && entry.content.includes('Please use a small example.'),
    ),
  );
  assert.ok(
    result.messages.some(
      (entry) =>
        entry.role === 'assistant' && entry.content.includes('Earlier derivative explanation.'),
    ),
  );
  assert.equal(result.messages.filter((entry) => entry.content === text).length, 1);
  assert.equal(
    result.memoryRefs.some((ref) => ref.threadId === 'current'),
    false,
  );
});

test('same-course prior-chat memory retrieves relevant completed messages and excludes drafts and unfinished replies', async () => {
  const state = chat();
  state.threads.push(
    {
      id: 'older',
      title: 'Derivative practice',
      createdAt: 1,
      updatedAt: 2,
      scope: courseScope,
      draft: 'UNSENT_DRAFT_SECRET',
      messages: [
        message('old-user', 'DERIVATIVE_MEMORY: I prefer a bicycle speed example for derivatives.'),
        message('unfinished', 'UNFINISHED_REPLY_SECRET derivative', {
          role: 'assistant',
          status: 'generating',
        }),
        message('failed', 'FAILED_REPLY_SECRET derivative', { role: 'assistant', status: 'error' }),
      ],
    },
    {
      id: 'newer',
      title: 'Unrelated shopping',
      createdAt: 3,
      updatedAt: 4,
      scope: courseScope,
      draft: '',
      messages: [message('unrelated', 'UNRELATED_MEMORY_SECRET: buy a carton of milk.')],
    },
  );
  const result = await build(
    input({
      chat: state,
      text: 'Explain derivatives using the bicycle speed example we discussed.',
    }),
  );
  assert.match(promptText(result), /DERIVATIVE_MEMORY/);
  assert.doesNotMatch(
    promptText(result),
    /UNSENT_DRAFT_SECRET|UNFINISHED_REPLY_SECRET|FAILED_REPLY_SECRET|UNRELATED_MEMORY_SECRET/,
  );
  const memory = result.memoryRefs.find((ref) => ref.threadId === 'older');
  assert.ok(memory);
  assert.ok(memory.messageIds.includes('old-user'));
  assert.equal(memory.courseId, '101');
  assert.match(
    evidenceText(result),
    /memory|prior (?:chat|conversation)|previous (?:chat|conversation)/i,
  );
});

test('narrow scope cannot pull prior-chat evidence from a different historical scope', async () => {
  const state = chat();
  state.threads.push({
    id: 'old',
    title: 'Limits and derivatives',
    scope: courseScope,
    messages: [
      message('matching', 'SCOPED_MEMORY: left limits approach smaller inputs.', {
        scope: pageScope(),
      }),
      message('outside', 'OTHER_SCOPE_MEMORY_SECRET: left limit practice.', {
        scope: pageScope('15'),
      }),
      message('broad', 'BROAD_SCOPE_MEMORY_SECRET: left limit practice.', { scope: courseScope }),
    ],
  });
  const result = await build(
    input({ chat: state, scope: pageScope(), text: 'Remind me about our left limit practice.' }),
  );
  assert.match(promptText(result), /SCOPED_MEMORY/);
  assert.doesNotMatch(promptText(result), /OTHER_SCOPE_MEMORY_SECRET|BROAD_SCOPE_MEMORY_SECRET/);
});

test('included source and memory references resolve to cited prompt excerpts and remain deterministic', async () => {
  const args = input();
  const first = await build(args);
  const second = await build(args);
  assert.deepEqual(first, second);
  assert.ok(first.sourceRefs.some((ref) => ref.itemId === '15'));
  const ids = [...first.sourceRefs, ...first.memoryRefs].map((ref) => ref.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const ref of first.sourceRefs) {
    assert.equal(ref.courseId, '101');
    assert.equal(typeof ref.title, 'string');
    assert.ok(ref.url.startsWith('https://msjc.instructure.com/courses/101/'));
    assert.ok(promptText(first).includes(`[${ref.id}]`));
  }
});

test('lexical retrieval prioritizes relevant evidence under the 6144-token input budget', async () => {
  const course = snapshot();
  course.modules[0].items[1].content.markdown = 'UNRELATED_CONTENT '.repeat(1500);
  course.modules[0].items[4].content.markdown =
    '# Derivative\n\nDERIVATIVE_TARGET: bicycle speed is an instantaneous derivative.\n\n' +
    'Additional derivative explanation. '.repeat(1000);
  const state = chat();
  state.threads[0].messages = Array.from({ length: 40 }, (_, index) =>
    message(`old-${index}`, `Earlier question ${index}: ${'long context '.repeat(30)}`),
  );
  const text = 'Explain bicycle speed as a derivative, with a clear example.';
  const result = await build(input({ snapshot: course, chat: state, text }));
  assert.equal(result.inputTokens, tokenizer.countMessages(result.messages));
  assert.ok(result.inputTokens <= 6144, `Input exceeded budget: ${result.inputTokens}`);
  assert.match(promptText(result), /DERIVATIVE_TARGET/);
  assert.deepEqual(result.messages.at(-1), { role: 'user', content: text });
  assert.ok(result.sourceRefs.some((ref) => ref.itemId === '15'));
});

test('an oversized current question is rejected rather than silently truncated', async () => {
  await assert.rejects(() => build(input({ text: '界'.repeat(6145) })), /token|budget|long|limit/i);
});

test('builder does not mutate cached course content, conversations or selected scope', async () => {
  const args = input();
  const original = structuredClone({
    snapshot: args.snapshot,
    chat: args.chat,
    scope: args.scope,
    text: args.text,
  });
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  freeze(args.snapshot);
  freeze(args.chat);
  freeze(args.scope);
  await build(args);
  assert.deepEqual(
    { snapshot: args.snapshot, chat: args.chat, scope: args.scope, text: args.text },
    original,
  );
});

test('zero lexical overlap uses only the latest previous eligible scoped conversation within the memory budget', async () => {
  const state = chat();
  const saved = (id, updatedAt, messages) => ({
    id,
    title: id,
    updatedAt,
    scope: pageScope(),
    messages,
    draft: 'DRAFT_NEVER_CONTEXT',
  });
  state.threads.push(
    saved('older', 10, [
      message('m1', 'OLDER_ELIGIBLE_MEMORY: visual illustrations helped.', { scope: pageScope() }),
    ]),
    saved('latest-eligible', 20, [
      message('m2', 'LATEST_ELIGIBLE_MEMORY: concise visual illustrations helped.', {
        scope: pageScope(),
      }),
      message('too-large', 'OVER_BUDGET_MEMORY: ' + 'x'.repeat(600), { scope: pageScope() }),
    ]),
    saved('newer-outside', 30, [
      message('m3', 'OUTSIDE_SCOPE_MEMORY: worked on drawings.', { scope: pageScope('15') }),
    ]),
    saved('newest-partial', 40, [
      message('m4', 'PARTIAL_REPLY_MEMORY: pending result.', {
        scope: pageScope(),
        role: 'assistant',
        status: 'streaming',
      }),
    ]),
  );
  const result = await build(input({ chat: state, scope: pageScope(), text: 'Zoology?' }));
  assert.match(promptText(result), /LATEST_ELIGIBLE_MEMORY/);
  assert.doesNotMatch(
    promptText(result),
    /OLDER_ELIGIBLE_MEMORY|OUTSIDE_SCOPE_MEMORY|PARTIAL_REPLY_MEMORY|DRAFT_NEVER_CONTEXT|OVER_BUDGET_MEMORY/,
  );
  assert.ok(result.memoryRefs.length > 0);
  assert.ok(result.memoryRefs.every((ref) => ref.threadId === 'latest-eligible'));
  assert.equal(result.memoryRefs[0].courseId, '101');
  assert.ok(result.memoryRefs[0].messageIds.includes('m2'));
  assert.ok(result.inputTokens <= 6144);
});

test('unsupported course facts are separated from explicitly labeled General explanation', async () => {
  const result = await build(input());
  assert.match(result.messages[0].content, /General explanation/);
  assert.match(
    result.messages[0].content,
    /insufficient|missing|not (?:support|enough)|does not support/i,
  );
});

test('concept questions request actual tutoring even when a page only lists learning objectives', async () => {
  const data = snapshot();
  data.modules[0].items[1].content.markdown =
    'In this section you will identify a rational function.';
  const result = await build(
    input({ snapshot: data, scope: pageScope(), text: 'What is a rational function?' }),
  );
  const instructions = result.messages[0].content;
  assert.match(instructions, /plain-language definition/i);
  assert.match(instructions, /worked example/i);
  assert.match(instructions, /do not merely repeat learning objectives/i);
  assert.match(instructions, /General explanation/);
  assert.match(instructions, /follow-up/i);
  assert.match(instructions, /language/i);
  assert.doesNotMatch(instructions, /Give concise, direct explanations/);
});

test('retrieved Markdown carries the actual textbook links as reference provenance', async () => {
  const data = snapshot();
  data.modules[0].items[1].content.markdown =
    'Read [Basic functions](https://openstax.org/books/calculus-volume-1/pages/1-2-basic-classes-of-functions).';
  const result = await build(input({ snapshot: data, scope: pageScope() }));
  assert.deepEqual(result.sourceRefs[0].links, [
    {
      title: 'Basic functions',
      url: 'https://openstax.org/books/calculus-volume-1/pages/1-2-basic-classes-of-functions',
    },
  ]);
});

test('a named page keeps its late paragraphs ahead of overlapping sibling excerpts when the whole page fits', async () => {
  const course = snapshot();
  const paragraphs = Array.from(
    { length: 7 },
    (_, index) =>
      `Day ${index}: ${'Read the weekly activities and prepare your notes. '.repeat(5)}`,
  );
  paragraphs.push(
    'Saturday: make comments and ask questions on at least three other people’s posts.',
  );
  course.modules[0].items = [
    ...Array.from({ length: 14 }, (_, index) =>
      page(
        `noise-${index}`,
        'Introduction board minimum classmates reply',
        'Introduction board: reply to classmates. '.repeat(8),
      ),
    ),
    page('roadmap', 'Week One road map', paragraphs.join('\n\n')),
  ];
  course.modules = [course.modules[0]];
  const result = await build(
    input({
      snapshot: course,
      text: 'Using the Week One road map, what is the minimum number of classmates I must reply to on the introduction board?',
    }),
  );
  assert.match(promptText(result), /at least three other people/);
  for (let index = 0; index < 7; index++)
    assert.match(promptText(result), new RegExp(`Day ${index}:`));
  assert.ok(result.inputTokens <= 6144);
});

test('reply and minimum queries retrieve comment and at-least wording beyond early chunks', async () => {
  const course = snapshot();
  course.modules[0].items = [
    page(
      'discussion',
      'Weekly discussion',
      [
        ...Array.from(
          { length: 22 },
          (_, index) => `Activity ${index}: ${'Read the chapter before class. '.repeat(10)}`,
        ),
        'Participation requirement: make comments on at least three other people’s posts.',
      ].join('\n\n'),
    ),
  ];
  course.modules = [course.modules[0]];
  const result = await build(
    input({ snapshot: course, text: 'What minimum number of classmates must I reply to?' }),
  );
  assert.match(promptText(result), /at least three other people/);
  assert.ok(result.inputTokens <= 6144);
});

test('historical citation labels cannot bind to the new turn references and saved messages stay unchanged', async () => {
  const state = chat();
  state.threads[0].messages = [
    message('u', 'Explain limits.'),
    message('a', 'Limits were discussed [S91, S92] and [M93].', {
      role: 'assistant',
      status: 'complete',
    }),
  ];
  state.threads.push({
    id: 'prior',
    title: 'Limits',
    updatedAt: 3,
    messages: [
      message('old', 'Limits appeared [S94] and [M95].', { role: 'assistant', status: 'complete' }),
    ],
  });
  const original = structuredClone(state);
  const result = await build(input({ chat: state, text: 'Remind me about limits.' }));
  assert.doesNotMatch(promptText(result), /\[(?:S9[124]|M9[35])(?:[,\]\s])/);
  assert.match(promptText(result), /historical reference/i);
  assert.match(result.messages[0].content, /historical.*(?:current|evidence)/i);
  assert.deepEqual(state, original);
});

test('short followups retrieve the recent user topic and its historical source title instead of unrelated early pages', async () => {
  const course = snapshot();
  course.modules[0].items = [
    ...Array.from({ length: 18 }, (_, index) =>
      page(`noise-${index}`, 'General course notes', 'General reading assignments. '.repeat(12)),
    ),
    page(
      'target',
      'Celestial navigation',
      'SEXTANT_TARGET: sailors measure the angle above the horizon.',
    ),
  ];
  course.modules = [course.modules[0]];
  const state = chat();
  state.threads[0].messages = [
    message('u', 'Explain celestial navigation.'),
    message('a', 'We discussed the method [S1].', {
      role: 'assistant',
      status: 'complete',
      sourceRefs: [
        {
          id: 'S1',
          courseId: '101',
          moduleId: '1',
          itemId: 'target',
          title: 'Celestial navigation',
          url: sourceUrl('target'),
        },
      ],
    }),
  ];
  const result = await build(
    input({ snapshot: course, chat: state, text: 'Could you give an example?' }),
  );
  assert.match(result.messages[0].content, /SEXTANT_TARGET/);
  assert.equal(result.sourceRefs[0].itemId, 'target');
  assert.ok(result.inputTokens <= 6144);
});

test('exact item scope admits metadata-only items and rejects sections, mismatched modules, and unresolved current scope', async () => {
  const result = await build(
    input({ scope: { kind: 'item', moduleId: '1', itemId: '13' }, text: 'What is due?' }),
  );
  assert.match(promptText(result), /Limits homework/);
  assert.doesNotMatch(
    promptText(result),
    /LEFT_LIMIT_EVIDENCE|DERIVATIVE_EVIDENCE|INTEGRAL_EVIDENCE/,
  );
  assert.ok(result.sourceRefs.every((ref) => ref.itemId === '13' && ref.moduleId === '1'));
  for (const scope of [
    { kind: 'item', moduleId: '1', itemId: '11' },
    { kind: 'item', moduleId: '2', itemId: '13' },
    { kind: 'current' },
  ])
    await assert.rejects(() => build(input({ scope })), /scope|source|item|current/i);
});

test('a new-chat followup can retrieve the latest eligible prior conversation source without reusing its citation id', async () => {
  const course = snapshot();
  course.modules[0].items = [
    ...Array.from({ length: 18 }, (_, index) =>
      page(`noise-${index}`, 'General course notes', 'General reading assignments. '.repeat(12)),
    ),
    page(
      'target',
      'Celestial navigation',
      'SEXTANT_PRIOR_TARGET: measure the angle above the horizon.',
    ),
  ];
  course.modules = [course.modules[0]];
  const state = chat();
  state.threads.push({
    id: 'prior',
    title: 'Earlier lesson',
    updatedAt: 5,
    messages: [
      message('u', 'How does that instrument work?'),
      message('a', 'We discussed its use [S81].', {
        role: 'assistant',
        status: 'complete',
        sourceRefs: [
          {
            id: 'S81',
            courseId: '101',
            moduleId: '1',
            itemId: 'target',
            title: 'Celestial navigation',
            url: sourceUrl('target'),
          },
        ],
      }),
    ],
  });
  const result = await build(
    input({ snapshot: course, chat: state, text: 'Can you explain that again?' }),
  );
  assert.equal(result.sourceRefs[0].itemId, 'target');
  assert.match(result.messages[0].content, /SEXTANT_PRIOR_TARGET/);
  assert.doesNotMatch(promptText(result), /\[S81\]/);
});

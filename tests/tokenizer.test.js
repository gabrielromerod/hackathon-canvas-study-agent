import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGroundedPrompt } from '../src/chat/grounding.js';
const { createTokenizer, loadTokenizer } = await import('../src/chat/tokenizer.js').catch(
  (error) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/src/chat/tokenizer.js'))
      return {};
    throw error;
  },
);
const [json, config, template] = await Promise.all([
  readFile(new URL('../vendor/gemma-e2b/tokenizer.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../vendor/gemma-e2b/tokenizer_config.json', import.meta.url), 'utf8').then(
    JSON.parse,
  ),
  readFile(new URL('../vendor/gemma-e2b/chat_template.jinja', import.meta.url), 'utf8'),
]);
let adapter;
function tokenizer() {
  assert.equal(
    typeof createTokenizer,
    'function',
    'The matching Gemma tokenizer adapter must be implemented',
  );
  return (adapter ??= createTokenizer(json, config, template));
}
const messages = () => [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Hello' },
];
function assets({ fail = false } = {}) {
  const calls = [];
  let failing = fail;
  const fetch = async (url) => {
    calls.push(url);
    if (failing && url.endsWith('tokenizer_config.json')) return { ok: false, status: 404 };
    if (url.endsWith('tokenizer.json')) return { ok: true, json: async () => json };
    if (url.endsWith('tokenizer_config.json')) return { ok: true, json: async () => config };
    if (url.endsWith('chat_template.jinja')) return { ok: true, text: async () => template };
    throw new Error(`Unexpected asset request: ${url}`);
  };
  return {
    fetch,
    calls,
    recover: () => {
      failing = false;
    },
  };
}

test('counts pinned Gemma text tokens synchronously without adding BOS or a guessed ratio', () => {
  const count = tokenizer();
  assert.equal(count.countText(''), 0);
  assert.equal(count.countText('Hello'), 1);
  assert.equal(count.countText('Hello world!'), 3);
  assert.equal(count.countText('こんにちは 🌍'), 3);
  assert.equal(count.countText('<bos>'), 1);
  assert.equal(count.countText('<|turn>model\n'), 3);
  assert.equal(typeof count.countText('Hello'), 'number');
});

test('renders the pinned chat template with one literal BOS and the model generation prefix', () => {
  // Hand-checked pinned IDs: [2,105,2364,107,9259,106,107,105,4368,107].
  assert.equal(tokenizer().countMessages([{ role: 'user', content: 'Hello' }]), 10);
  // System + user adds precisely the system turn (8 tokens), not a second BOS.
  assert.equal(tokenizer().countMessages(messages()), 18);
  assert.equal(tokenizer().countMessages(messages()), 18);
});

test('counts the complete builder list once while runtime sends its final user separately', () => {
  const full = messages();
  const preface = full.slice(0, -1);
  const question = full.at(-1).content;
  assert.equal(tokenizer().countMessages([...preface, { role: 'user', content: question }]), 18);
  assert.equal(tokenizer().countMessages([...full, { role: 'user', content: question }]), 24);
  assert.equal(tokenizer().countMessages(preface), 12);
});

test('matches Gemma assistant framing, trims text and removes historical thinking channels', () => {
  const full = [
    { role: 'system', content: '  Be brief.  ' },
    { role: 'user', content: 'Earlier?' },
    { role: 'assistant', content: '<|channel>thought\nsecret<channel|> Visible answer.' },
    { role: 'user', content: 'Now?' },
  ];
  // Actual rendered model turns omit "secret" and have 34 pinned tokens.
  assert.equal(tokenizer().countMessages(full), 34);
  full[2].content = 'Visible answer.';
  assert.equal(tokenizer().countMessages(full), 34);
});

test('disables thinking and always asks the template for a generation prompt', () => {
  const custom = createTokenizer(
    json,
    config,
    '{{ bos_token }}{% if enable_thinking %}FAIL{% else %}Hello{% endif %}{% if add_generation_prompt %} world!{% endif %}',
  );
  assert.equal(
    custom.countMessages([{ role: 'user', content: 'Ignored by this test template' }]),
    4,
  );
});

test('rejects unsupported message data rather than returning a misleading token estimate', () => {
  const count = tokenizer();
  for (const value of [
    null,
    [],
    [{ role: 'tool', content: 'Tool data' }],
    [{ role: 'user', content: [{ type: 'image' }] }],
    [{ role: 'user', content: 42 }],
    [
      { role: 'user', content: 'Hello' },
      { role: 'system', content: 'Late system' },
    ],
  ]) {
    assert.throws(() => count.countMessages(value), /message|text|role|system/i);
  }
  assert.throws(() => count.countText(null), /text|string/i);
});

test('loads the three local assets once and shares concurrent loads for the same fetch and base', async () => {
  assert.equal(typeof loadTokenizer, 'function', 'The local tokenizer loader must be implemented');
  const fixture = assets();
  const base = 'chrome-extension://study-agent/tokenizer/';
  const [first, second] = await Promise.all([
    loadTokenizer(fixture.fetch, base),
    loadTokenizer(fixture.fetch, base),
  ]);
  assert.equal(first, second);
  assert.equal(await loadTokenizer(fixture.fetch, base), first);
  assert.deepEqual(
    fixture.calls.sort(),
    [`${base}chat_template.jinja`, `${base}tokenizer.json`, `${base}tokenizer_config.json`].sort(),
  );
  assert.equal(first.countMessages(messages()), 18);
});

test('failed asset loads are explicit and retryable without poisoning the loader cache', async () => {
  assert.equal(typeof loadTokenizer, 'function');
  const fixture = assets({ fail: true });
  const base = 'chrome-extension://study-agent/tokenizer/';
  await assert.rejects(loadTokenizer(fixture.fetch, base), /404|tokenizer_config/i);
  fixture.recover();
  assert.equal((await loadTokenizer(fixture.fetch, base)).countText('Hello world!'), 3);
});

test('tokenizer caches are isolated by asset base and fetch implementation', async () => {
  assert.equal(typeof loadTokenizer, 'function');
  const first = assets(),
    second = assets();
  const a = await loadTokenizer(first.fetch, 'chrome-extension://a/tokenizer/');
  const b = await loadTokenizer(first.fetch, 'chrome-extension://b/tokenizer/');
  const c = await loadTokenizer(second.fetch, 'chrome-extension://a/tokenizer/');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(first.calls.length, 6);
  assert.equal(second.calls.length, 3);
});

test('real pinned tokenization keeps a large grounded course prompt within 6144 model tokens', () => {
  const count = tokenizer();
  const result = buildGroundedPrompt({
    snapshot: {
      courseId: '101',
      courseTitle: 'Calculus',
      modules: [
        {
          id: '1',
          title: 'Derivatives',
          items: [
            {
              id: '2',
              type: 'Page',
              title: 'Derivative definition',
              url: 'https://msjc.instructure.com/courses/101/pages/derivative',
              content: {
                status: 'loaded',
                format: 'markdown',
                markdown: 'A derivative describes instantaneous rate of change. '.repeat(1200),
              },
            },
          ],
        },
      ],
    },
    chat: { courseId: '101', threads: [{ id: 'current', messages: [] }] },
    threadId: 'current',
    scope: { kind: 'course' },
    text: 'Explain the derivative definition.',
    tokenizer: count,
  });
  assert.equal(result.inputTokens, count.countMessages(result.messages));
  assert.ok(result.inputTokens <= 6144);
  assert.ok(result.sourceRefs.length > 0);
  assert.deepEqual(result.messages.at(-1), {
    role: 'user',
    content: 'Explain the derivative definition.',
  });
});

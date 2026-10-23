import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScope, scopeChoices, scopeKey, findScope } from '../src/chat/scope.js';
import { openRepository } from '../src/storage/repository.js';

test('current scope persists a mode rather than a frozen source selection', () => {
  assert.deepEqual(
    normalizeScope({ kind: 'current', label: 'An old page', moduleId: '1', itemId: '11' }),
    { kind: 'current', label: 'This tab' },
  );
  assert.notEqual(scopeKey({ kind: 'current' }), scopeKey({ kind: 'course' }));
});

test('exact non-Page items can be normalized without widening to a section or module', () => {
  assert.deepEqual(normalizeScope({ kind: 'item', moduleId: 1, itemId: 12, label: 'Homework' }), {
    kind: 'item',
    moduleId: '1',
    itemId: '12',
    label: 'Homework',
  });
  assert.throws(() => normalizeScope({ kind: 'item', itemId: '12' }), /scope/i);
});

test('scope choices include This tab and preserve existing module, section and Page choices', () => {
  const choices = scopeChoices({
    modules: [
      {
        id: '1',
        title: 'Week 1',
        items: [
          { id: '10', type: 'Section', title: 'Lectures' },
          { id: '11', type: 'Page', title: 'Lecture' },
          { id: '12', type: 'Assignment', title: 'Homework' },
        ],
      },
    ],
  });
  assert.equal(findScope(choices, { kind: 'current' }).label, 'This tab');
  assert.equal(findScope(choices, { kind: 'module', moduleId: '1' }).label, 'Week 1');
  assert.equal(
    findScope(choices, { kind: 'section', moduleId: '1', sectionId: '10' }).label,
    'Lectures',
  );
  assert.equal(findScope(choices, { kind: 'page', moduleId: '1', itemId: '11' }).label, 'Lecture');
  assert.equal(findScope(choices, { kind: 'item', moduleId: '1', itemId: '12' }), null);
});

test('repository round-trips current mode and snapshots it on a user message without altering old scopes', async (t) => {
  const repository = await openRepository(`current-scope-${crypto.randomUUID()}`);
  t.after(() => repository.close());
  const initial = await repository.getChatState('101');
  const id = initial.activeThreadId;
  await repository.setScope('101', id, {
    kind: 'page',
    moduleId: '1',
    itemId: '11',
    label: 'Lecture',
  });
  const old = await repository.appendMessage('101', 'Existing page question', 'old', id);
  assert.equal(old.threads[0].messages[0].scope.kind, 'page');
  await repository.setScope('101', id, { kind: 'current' });
  await repository.appendMessage('101', 'Explain this tab', 'new', id);
  const saved = await repository.getChatState('101');
  assert.deepEqual(saved.threads[0].scope, { kind: 'current', label: 'This tab' });
  assert.deepEqual(saved.threads[0].messages[1].scope, { kind: 'current', label: 'This tab' });
  assert.equal(saved.threads[0].messages[0].scope.kind, 'page');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedDemoModel, demoSnapshot } from '../demo/fixture.js';

test('portfolio demo can only load cached weights and cannot remove the installed model', async () => {
  const calls = [];
  const model = cachedDemoModel({ rpc: async (...args) => calls.push(args) });
  await model.rpc('setup', { cachedOnly: false }, 'turn');
  assert.deepEqual(calls[0], ['setup', { cachedOnly: true }, 'turn']);
  await assert.rejects(model.rpc('remove'), /disabled/i);
});
test('public demo sources use synthetic identifiers and complete authored Markdown', () => {
  const snapshot = demoSnapshot();
  assert.equal(snapshot.courseId, '900001');
  assert.match(snapshot.courseTitle, /Demo/);
  for (const module of snapshot.modules)
    for (const item of module.items) {
      assert.match(item.url, /^https:\/\/msjc\.instructure\.com\/courses\/900001\//);
      if (item.type === 'Page') {
        assert.equal(item.content.status, 'loaded');
        assert.match(item.content.markdown, /# /);
      }
    }
  snapshot.courseTitle = 'mutated';
  assert.notEqual(demoSnapshot().courseTitle, 'mutated');
});

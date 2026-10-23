import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixtures/native-panel-harness.js';
test('settings is a top icon and keeps course context and the composer out of configuration', async (t) => {
  const { root } = await setup(t);
  const settings = root.querySelector('#settings-toggle');
  assert.ok(settings);
  settings.click();
  assert.equal(root.querySelector('#model-view').hidden, false);
  assert.equal(root.querySelector('#course-name').hidden, true);
  assert.equal(root.querySelector('.context-row').hidden, true);
  assert.equal(root.querySelector('.composer-footer').hidden, true);
  assert.ok(root.querySelector('#model-view #install-speech'));
  assert.ok(root.querySelector('#model-view #dictation-status'));
  assert.ok(root.querySelector('#sources-view #connection-status'));
  root.querySelector('#model-back').click();
  assert.equal(root.querySelector('.composer-footer').hidden, false);
  assert.equal(root.querySelector('#course-name').hidden, false);
});

test('opening Settings starts at its heading instead of inheriting chat scroll', async (t) => {
  const { root } = await setup(t);
  root.querySelector('#panel-content').scrollTop = 500;
  root.querySelector('#settings-toggle').click();
  assert.equal(root.querySelector('#panel-content').scrollTop, 0);
});

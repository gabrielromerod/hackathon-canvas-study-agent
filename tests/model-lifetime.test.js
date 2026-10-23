import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelLifetime } from '../src/ai/lifetime.js';
function setup() {
  let timer,
    removed = 0,
    unloaded = 0;
  const life = createModelLifetime({
    setTimeout: (fn, ms) => {
      assert.equal(ms, 300000);
      timer = fn;
      return 1;
    },
    clearTimeout: () => {
      timer = null;
    },
    unload: async () => {
      unloaded++;
    },
  });
  return {
    life,
    get timer() {
      return timer;
    },
    get unloaded() {
      return unloaded;
    },
    get removed() {
      return removed;
    },
  };
}
test('unloads only after five minutes with no panels and never removes cached weights', async () => {
  const s = setup();
  s.life.update({ panels: 1, phase: 'ready' });
  assert.equal(s.timer, undefined);
  s.life.update({ panels: 0 });
  assert.equal(typeof s.timer, 'function');
  await s.timer();
  assert.equal(s.unloaded, 1);
  assert.equal(s.removed, 0);
});
test('reopening cancels unload and an in-flight model download is retained', () => {
  const s = setup();
  s.life.update({ panels: 0, phase: 'downloading' });
  assert.equal(s.timer, undefined);
  s.life.update({ phase: 'ready' });
  assert.equal(typeof s.timer, 'function');
  s.life.update({ panels: 1 });
  assert.equal(s.timer, null);
});

test('cancelled or failed readiness releases allocated memory after panels close', async () => {
  for (const phase of ['idle', 'error']) {
    const s = setup();
    s.life.update({ panels: 1, phase: 'loading', resident: true });
    s.life.update({ phase });
    s.life.update({ panels: 0 });
    assert.equal(typeof s.timer, 'function');
    await s.timer();
    assert.equal(s.unloaded, 1);
  }
});

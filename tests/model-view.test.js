import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { createModelView } from '../src/panel/model-view.js';
const html = await readFile('public/sidepanel.html', 'utf8');
test('a previously downloaded model loads once on reopening without a download action', async (t) => {
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  let loaded = false;
  const calls = [];
  const view = createModelView(
    dom.window.document,
    async (method) => {
      calls.push(method);
      if (method === 'ai:setup') {
        loaded = true;
        return { text: 'Ready', status: 'complete' };
      }
      return { phase: loaded ? 'ready' : 'idle', cached: true, resources: { compatible: true } };
    },
    () => {},
    () => {},
  );
  await view.connect();
  assert.equal(view.state.phase, 'ready');
  assert.equal(calls.filter((method) => method === 'ai:setup').length, 1);
  assert.equal(calls.includes('download'), false);
});

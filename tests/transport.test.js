import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport } from '../src/panel/transport.js';

function signal() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(value) {
      for (const listener of [...listeners]) listener(value);
    },
  };
}

function setup(options = { autoReconnect: false }) {
  const sent = [];
  const events = [];
  const connectionOptions = [];
  const ports = [];
  let disconnects = 0;
  const makePort = () => ({
    sent: [],
    onMessage: signal(),
    onDisconnect: signal(),
    postMessage(message) {
      sent.push(message);
      this.sent.push(message);
    },
    disconnect() {
      disconnects++;
      this.onDisconnect.emit();
    },
  });
  const api = {
    runtime: {
      connect(options) {
        connectionOptions.push(options);
        const port = makePort();
        ports.push(port);
        return port;
      },
    },
  };
  const transport = createTransport(api, (...event) => events.push(event), options);
  return {
    transport,
    port: ports[0],
    ports,
    api,
    sent,
    events,
    connectionOptions,
    get disconnects() {
      return disconnects;
    },
  };
}

test('uses one persistent named port and correlates out-of-order responses with requests', async () => {
  const { transport, port, sent, connectionOptions } = setup();
  const first = transport.rpc('getCourse', { courseId: '101' });
  const second = transport.rpc('getChatState');
  assert.deepEqual(connectionOptions, [{ name: 'study-agent' }]);
  assert.notEqual(sent[0].id, sent[1].id);
  assert.deepEqual(sent[0], { id: sent[0].id, method: 'getCourse', payload: { courseId: '101' } });
  assert.deepEqual(sent[1], { id: sent[1].id, method: 'getChatState', payload: {} });
  port.onMessage.emit({ id: sent[1].id, data: { activeThreadId: 'second' } });
  port.onMessage.emit({ id: sent[0].id, data: { courseId: '101' } });
  assert.deepEqual(await first, { courseId: '101' });
  assert.deepEqual(await second, { activeThreadId: 'second' });
  transport.close();
});

function fakeClock() {
  let now = 0;
  let sequence = 0;
  const timers = new Map();
  const add = (callback, delay, repeat) => {
    const id = ++sequence;
    timers.set(id, { callback, delay, due: now + delay, repeat });
    return id;
  };
  return {
    setInterval: (callback, delay) => add(callback, delay, true),
    clearInterval: (id) => timers.delete(id),
    setTimeout: (callback, delay) => add(callback, delay, false),
    clearTimeout: (id) => timers.delete(id),
    get activeTimers() {
      return timers.size;
    },
    async tick(duration) {
      const end = now + duration;
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= end)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        const [id, timer] = next;
        now = timer.due;
        if (timer.repeat) timer.due += timer.delay;
        else timers.delete(id);
        timer.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
      now = end;
    },
  };
}

async function subscribe(context) {
  const subscribed = context.transport.rpc('subscribe', { windowId: 7 });
  context.port.onMessage.emit({
    id: context.sent.at(-1).id,
    data: { windowId: 7, courseId: '101' },
  });
  await subscribed;
}

test('sends heartbeat messages every twenty seconds and stops timers when the panel closes', async () => {
  const clock = fakeClock();
  const context = setup(clock);
  await clock.tick(19_999);
  assert.deepEqual(context.sent, []);
  await clock.tick(1);
  assert.equal(context.sent[0].method, 'ping');
  context.port.onMessage.emit({ id: context.sent[0].id, data: true });
  await clock.tick(20_000);
  assert.equal(context.sent[1].method, 'ping');
  context.transport.close();
  assert.equal(clock.activeTimers, 0);
  await clock.tick(60_000);
  assert.equal(context.sent.length, 2);
  assert.deepEqual(context.events, []);
});

test('reconnects once, restores the successful window subscription, and never replays pending writes', async () => {
  const clock = fakeClock();
  const context = setup(clock);
  await subscribe(context);
  const write = context.transport.rpc('appendMessage', {
    text: 'save once',
    messageId: 'message-1',
  });
  const failedWrite = assert.rejects(write, /Connection to local storage lost/);
  context.port.onDisconnect.emit();
  await failedWrite;
  assert.equal(context.ports.length, 2);
  assert.deepEqual(context.events, [['reconnecting', 'Reconnecting to local storage…']]);
  const replacement = context.ports[1];
  assert.deepEqual(
    replacement.sent.map(({ method, payload }) => ({ method, payload })),
    [{ method: 'subscribe', payload: { windowId: 7 } }],
  );
  assert.notEqual(replacement.sent[0].id, context.port.sent[0].id);
  await assert.rejects(context.transport.rpc('newChat', { courseId: '101' }), /reconnecting/i);
  context.port.onMessage.emit({ event: 'context', data: { courseId: 'stale' } });
  replacement.onMessage.emit({
    id: replacement.sent[0].id,
    data: { windowId: 7, courseId: '102' },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(context.events.at(-1), ['context', { windowId: 7, courseId: '102' }]);
  await clock.tick(20_000);
  assert.equal(replacement.sent.at(-1).method, 'ping');
  replacement.onDisconnect.emit();
  assert.equal(context.ports.length, 2, 'a second disconnect must not start a retry loop');
  assert.deepEqual(context.events.at(-1), [
    'error',
    'Connection to local storage lost. Reopen the sidebar to reconnect.',
  ]);
  assert.equal(clock.activeTimers, 0);
});

test('ends a silent reconnect after ten seconds and clears every timer', async () => {
  const clock = fakeClock();
  const context = setup(clock);
  await subscribe(context);
  context.port.onDisconnect.emit();
  await clock.tick(10_000);
  assert.deepEqual(context.events.at(-1), [
    'error',
    'Connection to local storage lost. Reopen the sidebar to reconnect.',
  ]);
  assert.equal(clock.activeTimers, 0);
  await clock.tick(60_000);
  assert.equal(context.ports.length, 2);
  await assert.rejects(context.transport.rpc('after-timeout'), /closed|lost/i);
});

test('reports an error when reconnect creation fails and does not try again', async () => {
  const clock = fakeClock();
  const context = setup(clock);
  await subscribe(context);
  context.api.runtime.connect = () => {
    throw new Error('Extension is unavailable');
  };
  context.port.onDisconnect.emit();
  assert.deepEqual(context.events, [
    ['reconnecting', 'Reconnecting to local storage…'],
    ['error', 'Connection to local storage lost. Reopen the sidebar to reconnect.'],
  ]);
  assert.equal(clock.activeTimers, 0);
  await clock.tick(60_000);
  assert.equal(context.ports.length, 1);
});

test('closing during resubscription rejects its request and suppresses reconnect errors', async () => {
  const clock = fakeClock();
  const context = setup(clock);
  await subscribe(context);
  context.port.onDisconnect.emit();
  context.transport.close();
  await clock.tick(60_000);
  assert.deepEqual(context.events, [['reconnecting', 'Reconnecting to local storage…']]);
  assert.equal(clock.activeTimers, 0);
});

test('rejects worker errors and routes notifications separately from pending responses', async () => {
  const { transport, port, sent, events } = setup();
  const request = transport.rpc('appendMessage', { text: 'note' });
  const rejected = assert.rejects(request, /Storage quota exceeded/);
  port.onMessage.emit({ event: 'course', data: { courseId: '101' } });
  port.onMessage.emit({ id: 'unrecognized', data: 'ignored' });
  port.onMessage.emit({ id: sent[0].id, error: 'Storage quota exceeded' });
  await rejected;
  assert.deepEqual(events, [['course', { courseId: '101' }]]);
  port.onMessage.emit({ id: sent[0].id, data: 'duplicate reply is ignored' });
  transport.close();
});

test('rejects every pending request and reports connection loss exactly once on unexpected disconnect', async () => {
  const { transport, port, sent, events } = setup();
  const first = transport.rpc('first');
  const second = transport.rpc('second');
  const firstRejected = assert.rejects(first, /Connection to local storage lost/);
  const secondRejected = assert.rejects(second, /Connection to local storage lost/);
  port.onDisconnect.emit();
  await Promise.all([firstRejected, secondRejected]);
  assert.deepEqual(events, [
    ['error', 'Connection to local storage lost. Reopen the sidebar to reconnect.'],
  ]);
  await assert.rejects(transport.rpc('after-disconnect'), /closed|lost/i);
  assert.equal(sent.length, 2);
  port.onDisconnect.emit();
  port.onMessage.emit({ event: 'late', data: 'ignored' });
  assert.equal(events.length, 1);
});

test('explicit close rejects pending requests, disconnects once, and produces no connection-loss alarm', async () => {
  const context = setup();
  const { transport, port, events } = context;
  const pending = transport.rpc('pending');
  const rejected = assert.rejects(pending, /closed/i);
  transport.close();
  await rejected;
  transport.close();
  port.onDisconnect.emit();
  assert.equal(context.disconnects, 1);
  assert.deepEqual(events, []);
  await assert.rejects(transport.rpc('after-close'), /closed/i);
});

test('rejects a synchronous send failure without leaving an unresolved request', async () => {
  const { transport, port } = setup();
  port.postMessage = () => {
    throw new Error('Port cannot send');
  };
  await assert.rejects(transport.rpc('failing-send'), /Port cannot send/);
  transport.close();
});

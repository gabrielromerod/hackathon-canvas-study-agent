const CONNECTION_LOST = 'Connection to local storage lost. Reopen the sidebar to reconnect.';

export function createTransport(api, onEvent = () => {}, options = {}) {
  const scheduleInterval = options.setInterval ?? globalThis.setInterval;
  const cancelInterval = options.clearInterval ?? globalThis.clearInterval;
  const scheduleTimeout = options.setTimeout ?? globalThis.setTimeout;
  const cancelTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  const pending = new Map();
  let port = null;
  let detach = () => {};
  let nextId = 0;
  let closed = false;
  let reconnecting = false;
  let reconnectAttempted = false;
  let subscription = null;
  let heartbeat = null;
  let reconnectDeadline = null;

  function clearTimers() {
    if (heartbeat !== null) cancelInterval(heartbeat);
    if (reconnectDeadline !== null) cancelTimeout(reconnectDeadline);
    heartbeat = null;
    reconnectDeadline = null;
  }

  function rejectPending(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function releasePort() {
    const previous = port;
    detach();
    detach = () => {};
    port = null;
    try {
      previous?.disconnect();
    } catch {
      /* The old port may already be disconnected. */
    }
  }

  function finish(error) {
    closed = true;
    reconnecting = false;
    clearTimers();
    releasePort();
    rejectPending(error);
  }

  function reportFailure() {
    if (closed) return;
    finish(new Error(CONNECTION_LOST));
    onEvent('error', CONNECTION_LOST);
  }

  function receive(source, message) {
    if (closed || source !== port || !message) return;
    if (typeof message.event === 'string') {
      onEvent(message.event, message.data);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (Object.hasOwn(message, 'error')) {
      request.reject(new Error(message.error));
    } else {
      if (request.method === 'subscribe') subscription = { windowId: request.payload.windowId };
      request.resolve(message.data);
    }
  }

  function send(method, payload = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method, payload });
      try {
        port.postMessage({ id, method, payload });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  function startHeartbeat() {
    heartbeat = scheduleInterval(() => {
      const source = port;
      // A live message resets Chrome's service-worker idle timer; an open port alone does not.
      void send('ping').catch(() => disconnected(source));
    }, 20_000);
    heartbeat?.unref?.();
  }

  function connect() {
    const current = api.runtime.connect({ name: 'study-agent' });
    port = current;
    const onMessage = (message) => receive(current, message);
    const onDisconnect = () => {
      // Reading lastError acknowledges Chrome's optional disconnect diagnostic.
      void api.runtime.lastError;
      disconnected(current);
    };
    current.onMessage.addListener(onMessage);
    current.onDisconnect.addListener(onDisconnect);
    detach = () => {
      current.onMessage.removeListener(onMessage);
      current.onDisconnect.removeListener(onDisconnect);
    };
  }

  function disconnected(source) {
    if (closed || source !== port) return;
    clearTimers();
    releasePort();
    rejectPending(new Error(CONNECTION_LOST));
    if (options.autoReconnect === false || reconnectAttempted) {
      reportFailure();
      return;
    }

    reconnectAttempted = true;
    reconnecting = true;
    onEvent('reconnecting', 'Reconnecting to local storage…');
    if (closed) return;
    try {
      connect();
    } catch {
      reportFailure();
      return;
    }
    if (!subscription) {
      reconnecting = false;
      startHeartbeat();
      return;
    }

    reconnectDeadline = scheduleTimeout(reportFailure, 10_000);
    reconnectDeadline?.unref?.();
    void send('subscribe', subscription)
      .then((context) => {
        if (closed) return;
        cancelTimeout(reconnectDeadline);
        reconnectDeadline = null;
        reconnecting = false;
        startHeartbeat();
        onEvent('context', context);
      })
      .catch(reportFailure);
  }

  connect();
  startHeartbeat();

  return {
    rpc(method, payload = {}) {
      if (closed) return Promise.reject(new Error('Sidebar connection is closed.'));
      if (reconnecting) return Promise.reject(new Error('Sidebar connection is reconnecting.'));
      return send(method, payload);
    },

    close() {
      if (closed) return;
      finish(new Error('Sidebar connection is closed.'));
    },
  };
}

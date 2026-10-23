import { fetchCurrentPlacement } from '../canvas/current-placement.js';
import { createTurnCoordinator } from '../ai/turns.js';
import { createPromptPreparer } from '../chat/prepare.js';
import { loadTokenizer } from '../chat/tokenizer.js';
const ORIGIN = 'https://msjc.instructure.com';
export function courseContext(tab = {}) {
  let courseId = null;
  try {
    const url = new URL(tab.url);
    if (url.origin === ORIGIN)
      courseId = url.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1] || null;
  } catch {
    /* Restricted tabs expose no URL. */
  }
  return {
    courseId,
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    url: courseId ? tab.url : null,
  };
}

// One worker is the writer for every panel. Import leases also serialize windows.
export function createBackgroundHub(api, repository, { model, prepare } = {}) {
  const database = Promise.resolve(repository);
  const sessions = new Set();
  const imports = new Map();
  let writes = Promise.resolve();
  const serialize = (action) => {
    const result = writes.then(action);
    writes = result.catch(() => {});
    return result;
  };
  const broadcast = (event, data, courseId) => {
    for (const session of sessions)
      if (
        !session.closed &&
        (courseId == null ||
          session.context?.courseId === courseId ||
          session.viewCourseId === courseId)
      )
        session.send({ event, data });
  };
  const turns = model
    ? database.then((repository) =>
        createTurnCoordinator({
          repository,
          model,
          broadcast,
          prepare:
            prepare ||
            createPromptPreparer({
              repository,
              getTokenizer: () => loadTokenizer(globalThis.fetch, api.runtime.getURL('tokenizer/')),
            }),
        }),
      )
    : null;
  const panelCount = () => {
    if (model) void model.rpc('panels', { count: sessions.size }).catch(() => {});
  };
  function release(session, courseId, generation) {
    for (const [id, lease] of imports)
      if (
        lease.owner === session &&
        (!courseId || courseId === id) &&
        (generation == null || generation === lease.generation)
      ) {
        imports.delete(id);
        broadcast('importReleased', { courseId: id }, id);
      }
  }
  async function resolveContext(session) {
    const revision = ++session.contextRevision;
    const [tab] = await api.tabs.query({ active: true, windowId: session.windowId });
    if (session.closed || revision !== session.contextRevision) return null;
    const context = { ...courseContext(tab), windowId: session.windowId };
    if (
      context.courseId &&
      api.scripting &&
      /\/(assignments|quizzes|discussion_topics|external_tools)\/\d+(?:[/?#]|$)/.test(context.url)
    ) {
      try {
        const results = await api.scripting.executeScript({
          target: { tabId: context.tabId },
          func: fetchCurrentPlacement,
          args: [{ courseId: context.courseId, url: context.url }],
        });
        const result = results?.find((entry) => entry.frameId === 0)?.result;
        if (result?.moduleItemId) context.moduleItemId = result.moduleItemId;
      } catch {
        /* Unavailable placement remains explicit in This tab; never widen context. */
      }
      if (session.closed || revision !== session.contextRevision) return null;
    }

    if (
      !session.context ||
      session.context.courseId !== context.courseId ||
      session.context.tabId !== context.tabId ||
      session.context.url !== context.url
    ) {
      session.sourceRevision++;
      if (turns) await (await turns).cancel(session);
      release(session);
    }
    session.context = context;
    if (context.courseId)
      await serialize(async () => {
        if (!session.closed && revision === session.contextRevision)
          await (await database).setLastCourse(session.windowId, context.courseId);
      });
    return !session.closed && revision === session.contextRevision ? context : null;
  }
  async function updateWindow(windowId) {
    await Promise.all(
      [...sessions]
        .filter((s) => s.windowId === windowId && !s.closed)
        .map(async (session) => {
          try {
            const context = await resolveContext(session);
            if (context && !session.closed) session.send({ event: 'context', data: context });
          } catch (error) {
            session.send({ event: 'error', data: error.message });
          }
        }),
    );
  }
  const hub = {
    modelEvent(event, data, id) {
      if (event === 'chunk') {
        if (turns) void turns.then((coordinator) => coordinator.event(event, data, id));
        return;
      }
      const { sample, ...safe } = data;
      for (const session of sessions)
        if (!session.closed) session.send({ event: 'modelStatus', data: safe });
    },
    createSession(send) {
      const session = {
        send,
        context: null,
        windowId: null,
        viewCourseId: null,
        closed: false,
        contextRevision: 0,
        sourceRevision: 0,
      };
      sessions.add(session);
      panelCount();
      return session;
    },
    async disconnect(session) {
      session.closed = true;
      sessions.delete(session);
      panelCount();
      release(session);
      if (turns) await (await turns).cancel(session);
    },
    updateWindow,
    async request(session, method, payload = {}) {
      if (method === 'ping') return true;
      if (method.startsWith('ai:')) {
        if (!model) throw new Error('Local AI runtime is not available in this environment.');
        const action = method.slice(3);
        if (!['status', 'setup', 'cancel', 'unload', 'remove'].includes(action))
          throw new Error('Unknown model action.');
        if (action === 'cancel' && turns) await (await turns).cancel(null);
        return model.rpc(action, payload);
      }
      if (method === 'subscribe') {
        session.windowId = payload.windowId;
        return (
          (await resolveContext(session)) ||
          session.context || { ...courseContext(), windowId: session.windowId }
        );
      }
      const courseId = payload.courseId;
      if (courseId != null && !/^\d+$/.test(String(courseId)))
        throw new Error('Invalid course identifier.');
      const repo = await database;
      if (method === 'getLastCourse') return repo.getLastCourse(session.windowId);
      if (method === 'getCourse') {
        session.viewCourseId = courseId;
        return repo.getCourse(courseId);
      }
      if (method === 'getChatState')
        return serialize(async () => {
          const chat = await repo.getChatState(courseId);
          return turns && (await turns).active?.courseId !== courseId
            ? repo.recoverInterruptedTurns(courseId)
            : chat;
        });
      if (method === 'sendTurn' || method === 'retryTurn') {
        if (!turns) throw new Error('Set up the local model to generate replies.');
        if (session.closed || ![session.context?.courseId, session.viewCourseId].includes(courseId))
          throw new Error('The course view changed.');
        const sourceRevision = session.sourceRevision;
        const status = await model.rpc('status');
        if (
          session.closed ||
          sourceRevision !== session.sourceRevision ||
          ![session.context?.courseId, session.viewCourseId].includes(courseId)
        )
          throw new Error('The course view changed or closed.');
        if (status.phase !== 'ready')
          throw new Error('The local model is not ready. Open Local AI to load it.');
        return (await turns).start(session, {
          ...payload,
          context: { ...session.context },
          retry: method === 'retryTurn',
        });
      }
      if (method === 'stopTurn')
        return turns ? (await turns).cancel(null, { courseId, threadId: payload.threadId }) : false;
      if (turns && ['newChat', 'selectThread', 'setScope'].includes(method))
        await (
          await turns
        ).cancel(null, {
          courseId,
          ...(method === 'setScope' ? { threadId: payload.threadId } : {}),
        });
      return serialize(async () => {
        if (method === 'claimImport') {
          if (session.closed || session.context?.courseId !== courseId)
            throw new Error('Open this course in Canvas to read its content.');
          const lease = imports.get(courseId);
          if (lease) return { acquired: false, generation: lease.generation };
          const sourceRevision = session.sourceRevision;
          const generation = await repo.beginImport(courseId);
          if (
            session.closed ||
            session.context?.courseId !== courseId ||
            sourceRevision !== session.sourceRevision
          )
            return { acquired: false, generation };
          imports.set(courseId, { owner: session, generation });
          broadcast('importStarted', { courseId }, courseId);
          return { acquired: true, generation };
        }
        if (method === 'saveSnapshot') {
          const lease = imports.get(courseId);
          if (session.closed || lease?.owner !== session || lease.generation !== payload.generation)
            return false;
          const saved = await repo.saveSnapshot(courseId, payload.generation, payload.snapshot);
          if (saved)
            broadcast('course', { courseId, record: await repo.getCourse(courseId) }, courseId);
          return saved;
        }
        if (method === 'releaseImport') {
          release(session, courseId, payload.generation);
          return true;
        }
        if (method === 'setSelection') {
          await repo.setSelection(courseId, payload.selection);
          return true;
        }
        let chat;
        if (method === 'appendMessage')
          chat = await repo.appendMessage(
            courseId,
            payload.text,
            payload.messageId,
            payload.threadId,
          );
        else if (method === 'newChat') chat = await repo.newChat(courseId);
        else if (method === 'selectThread')
          chat = await repo.selectThread(courseId, payload.threadId);
        else if (method === 'setScope')
          chat = await repo.setScope(courseId, payload.threadId, payload.scope);
        else if (method === 'setDraft') {
          await repo.setDraft(courseId, payload.threadId, payload.text);
          return true;
        } else throw new Error(`Unknown panel action: ${method}`);
        broadcast('chat', { courseId, chat }, courseId);
        return chat;
      });
    },
  };
  api.runtime.onConnect.addListener((port) => {
    if (port.name !== 'study-agent') return;
    const session = hub.createSession((value) => {
      try {
        port.postMessage(value);
      } catch {
        hub.disconnect(session);
      }
    });
    port.onMessage.addListener((message) => {
      hub
        .request(session, message.method, message.payload)
        .then((data) => {
          if (!session.closed) port.postMessage({ id: message.id, data });
        })
        .catch((error) => {
          if (!session.closed)
            port.postMessage({
              id: message.id,
              error: error.message || 'Local storage is unavailable.',
            });
        });
    });
    port.onDisconnect.addListener(() => hub.disconnect(session));
  });
  api.tabs.onActivated.addListener(({ windowId }) => {
    void updateWindow(windowId);
  });
  api.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (tab.active && (change.url || change.status === 'complete')) void updateWindow(tab.windowId);
  });
  api.tabs.onRemoved.addListener((_tabId, info) => {
    if (!info.isWindowClosing) void updateWindow(info.windowId);
  });
  return hub;
}

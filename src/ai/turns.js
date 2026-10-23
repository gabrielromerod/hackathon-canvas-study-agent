import { E2B } from './models.js';

// A single profile-wide lease stays held until the worker has actually stopped.
// Persistence tokens independently fence delayed chunks after cancellation/retry.
export function createTurnCoordinator({
  repository,
  model,
  prepare,
  broadcast,
  now = () => Date.now(),
}) {
  let current = null,
    lastRun = Promise.resolve();
  const publish = (courseId, chat) => broadcast('chat', { courseId, chat }, courseId);
  const busy = () =>
    broadcast('generation', {
      busy: Boolean(current),
      courseId: current?.courseId,
      threadId: current?.threadId,
    });
  const checkpoint = (run) => {
    const text = run.text,
      sequence = ++run.sequence;
    run.writes = run.writes.then(async () => {
      if (run.terminal) return;
      const result = await repository.checkpointTurn(run.courseId, {
        threadId: run.threadId,
        ...run.token,
        sequence,
        text,
      });
      if (result.saved) publish(run.courseId, result.chat);
    });
    return run.writes;
  };
  const finish = async (run, status, error) => {
    if (run.terminal) return;
    await run.writes;
    if (run.terminal) return;
    const result = await repository.finishTurn(run.courseId, {
      threadId: run.threadId,
      ...run.token,
      sequence: ++run.sequence,
      text: run.text,
      status,
      ...(error ? { error } : {}),
    });
    run.terminal = true;
    if (result.saved) publish(run.courseId, result.chat);
  };
  async function execute(run, prompt) {
    try {
      const result = await model.rpc(
        'generate',
        {
          messages: prompt.messages.slice(0, -1),
          text: prompt.messages.at(-1).content,
          maxOutputTokens: 1024,
        },
        run.requestId,
      );
      if (!run.cancelled) run.text = result.text;
      await finish(run, run.cancelled || result.status === 'stopped' ? 'cancelled' : 'complete');
    } catch (error) {
      try {
        await finish(run, run.cancelled ? 'cancelled' : 'error', error.message);
      } catch (storageError) {
        broadcast('error', `Could not save the local reply: ${storageError.message}`, run.courseId);
      }
    } finally {
      if (current === run) {
        current = null;
        busy();
      }
    }
  }
  return {
    get active() {
      return current;
    },
    settled() {
      return lastRun;
    },
    async start(owner, payload) {
      if (current)
        throw new Error('The local model is busy in this or another window. Stop it or wait.');
      const run = {
        owner,
        ...payload,
        requestId: crypto.randomUUID(),
        sourceRevision: owner.sourceRevision,
        cancelled: false,
        terminal: false,
        text: '',
        sequence: 0,
        writes: Promise.resolve(),
        lastCheckpoint: 0,
      };
      current = run;
      busy();
      const departed = () =>
        run.cancelled || owner.closed || owner.sourceRevision !== run.sourceRevision;
      try {
        const prompt = await prepare(payload);
        if (departed())
          throw new Error('The conversation changed or closed before generation started.');
        const result = payload.retry
          ? await repository.retryTurn(payload.courseId, {
              ...payload,
              sourceRefs: prompt.sourceRefs,
              memoryRefs: prompt.memoryRefs,
            })
          : await repository.beginTurn(payload.courseId, {
              ...payload,
              modelId: E2B.id,
              scope: prompt.scope,
              sourceRefs: prompt.sourceRefs,
              memoryRefs: prompt.memoryRefs,
            });
        if (!result.started) {
          current = null;
          busy();
          return result;
        }
        run.token = result.token;
        publish(run.courseId, result.chat);
        if (departed()) {
          run.cancelled = true;
          await finish(run, 'cancelled');
          current = null;
          busy();
          return { ...result, started: false };
        }
        lastRun = execute(run, prompt);
        return result;
      } catch (error) {
        if (current === run) {
          current = null;
          busy();
        }
        throw error;
      }
    },
    event(event, data, id) {
      const run = current;
      if (event !== 'chunk' || !run?.token || run.requestId !== id || run.cancelled || run.terminal)
        return;
      run.text = data.text;
      if (now() - run.lastCheckpoint >= 250) {
        run.lastCheckpoint = now();
        checkpoint(run).catch(async (error) => {
          broadcast('error', `Could not save the local reply: ${error.message}`, run.courseId);
          run.cancelled = true;
          await model.rpc('cancel').catch(() => {});
        });
      }
    },
    async cancel(owner, { courseId, threadId } = {}) {
      const run = current;
      if (
        !run ||
        (owner && run.owner !== owner) ||
        (courseId && run.courseId !== courseId) ||
        (threadId && run.threadId !== threadId)
      )
        return false;
      run.cancelled = true;
      if (run.token) {
        await model.rpc('cancel');
        await finish(run, 'cancelled');
      }
      return true;
    },
  };
}

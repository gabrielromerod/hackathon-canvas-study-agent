import { resolveCurrentScope } from '../canvas/current-context.js';
import { buildGroundedPrompt } from './grounding.js';
export function createPromptPreparer({ repository, getTokenizer }) {
  return async (payload) => {
    const repo = await repository;
    const [{ snapshot }, saved] = await Promise.all([
      repo.getCourse(payload.courseId),
      repo.getChatState(payload.courseId),
    ]);
    if (!snapshot) throw new Error('Read this course’s sources before asking a question.');
    const chat = { ...structuredClone(saved), courseId: payload.courseId };
    const thread = chat.threads.find((thread) => thread.id === payload.threadId);
    if (!thread) throw new Error('This conversation is unavailable.');
    let text = payload.text,
      scope = thread.scope;
    if (payload.retry) {
      const user = thread.messages.findLast(
        (message) => message.turnId === payload.turnId && message.role === 'user',
      );
      const assistant = thread.messages.findLast(
        (message) => message.turnId === payload.turnId && message.role === 'assistant',
      );
      if (
        !user ||
        !assistant ||
        assistant.attempt !== payload.expectedAttempt ||
        !['cancelled', 'error'].includes(assistant.status)
      )
        throw new Error('This retry is no longer available.');
      text = user.text;
      scope = user.scope;
      thread.messages = thread.messages.filter((message) => message.turnId !== payload.turnId);
    }
    if (scope?.kind === 'current') {
      const current = resolveCurrentScope(snapshot, payload.context);
      if (!current.available) throw new Error(current.reason);
      scope = current.scope;
    }
    return buildGroundedPrompt({
      snapshot,
      chat,
      threadId: payload.threadId,
      scope,
      text,
      tokenizer: await getTokenizer(),
    });
  };
}

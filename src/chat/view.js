import { node } from '../panel/dom.js';
import { renderAssistant } from './assistant.js';
export const activeThread = (chat) =>
  chat?.threads.find((thread) => thread.id === chat.activeThreadId);
export function renderMessages(root, chat, options = {}) {
  const messages = activeThread(chat)?.messages || [];
  const list = root.querySelector('#messages');
  list.replaceChildren();
  root.querySelector('#welcome').hidden = messages.length > 0;
  const latest = messages.findLast((message) => message.role === 'assistant');
  for (const message of messages) {
    if (message.role === 'assistant') {
      list.append(
        renderAssistant(root, message, {
          ...options,
          retryable: message === latest && !activeThread(chat)?.activeTurn,
        }),
      );
      continue;
    }
    const bubble = node(root, 'p', message.text, 'user-message');
    const time = node(
      root,
      'time',
      new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      'message-time',
    );
    time.dateTime = new Date(message.createdAt).toISOString();
    bubble.append(time);
    list.append(bubble);
  }
}
export function renderHistory(root, chat, onSelect) {
  const list = root.querySelector('#history-list');
  list.replaceChildren();
  const threads = [...(chat?.threads || [])]
    .filter((thread) => thread.messages.length)
    .sort((a, b) => Number(new Date(b.updatedAt)) - Number(new Date(a.updatedAt)));
  for (const thread of threads) {
    const item = node(root, 'button', null, 'history-item');
    item.type = 'button';
    item.setAttribute('aria-current', String(thread.id === chat.activeThreadId));
    item.append(
      node(root, 'span', thread.title, 'history-title'),
      node(
        root,
        'span',
        new Date(thread.updatedAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }),
        'history-date',
      ),
    );
    item.addEventListener('click', () => onSelect(thread.id));
    list.append(item);
  }
  if (!threads.length)
    list.append(node(root, 'p', 'Your saved conversations will appear here.', 'empty-note'));
}

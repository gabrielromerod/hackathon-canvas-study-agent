import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { node } from '../panel/dom.js';
import { validatedSourceURL, validatedSourceLink } from './source-links.js';
const safeSource = (ref) => validatedSourceURL(ref.url, ref.courseId);
export function renderAssistant(
  root,
  message,
  { onSelect = () => {}, onRetry = () => {}, retryable = false } = {},
) {
  const container = node(root, 'article', null, 'assistant-message');
  const body = node(root, 'div', null, 'assistant-body');
  const purifier = createDOMPurify(root.defaultView);
  body.innerHTML = purifier.sanitize(
    marked.parse(message.text || '', { breaks: true, async: false }),
    {
      FORBID_TAGS: ['img', 'svg', 'video', 'audio', 'iframe', 'form', 'input', 'button', 'style'],
      FORBID_ATTR: ['style'],
    },
  );
  const sources = new Map(
    (message.sourceRefs || []).filter((ref) => safeSource(ref)).map((ref) => [ref.id, ref]),
  );
  const suppliedLinks = new Map();
  for (const ref of sources.values()) {
    const sourceURL = safeSource(ref);
    if (!suppliedLinks.has(sourceURL))
      suppliedLinks.set(sourceURL, { title: ref.title, url: sourceURL });
    for (const link of ref.links || []) {
      const url = validatedSourceLink(link.url, sourceURL, ref.courseId);
      if (url && !suppliedLinks.has(url)) suppliedLinks.set(url, { title: link.title || url, url });
    }
  }
  // Keep only exact destinations independently supplied by retrieved evidence.
  for (const link of body.querySelectorAll('a')) {
    if (!suppliedLinks.has(link.href)) link.replaceWith(...link.childNodes);
    else {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
  const memories = new Map((message.memoryRefs || []).map((ref) => [ref.id, ref]));
  const walker = root.createTreeWalker(body, root.defaultView.NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const text of texts) {
    if (text.parentElement.closest('code,pre,a')) continue;
    const pattern = /\[((?:[SM]\d+)(?:\s*,\s*[SM]\d+)*)\]/g,
      fragment = root.createDocumentFragment();
    let offset = 0,
      match;
    while ((match = pattern.exec(text.textContent))) {
      fragment.append(text.textContent.slice(offset, match.index));
      for (const identifier of match[1].split(/\s*,\s*/)) {
        const label = `[${identifier}]`;
        const ref = sources.get(identifier) || memories.get(identifier);
        if (!ref) fragment.append(label);
        else if (sources.has(identifier)) {
          const link = node(root, 'a', label, 'citation');
          link.href = safeSource(ref);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.title = ref.title;
          fragment.append(link);
        } else {
          const button = node(root, 'button', label, 'memory-citation');
          button.type = 'button';
          button.title = `Earlier chat: ${ref.title}`;
          button.addEventListener('click', () => onSelect(ref.threadId));
          fragment.append(button);
        }
        fragment.append(' ');
      }
      offset = pattern.lastIndex;
    }
    fragment.append(text.textContent.slice(offset));
    text.replaceWith(fragment);
  }
  container.append(body);
  if (message.status !== 'complete')
    container.append(
      node(
        root,
        'p',
        message.error ||
          {
            streaming: 'Writing on this device…',
            cancelled: 'Stopped · Partial reply',
            error: 'Reply failed',
          }[message.status] ||
          'Saved reply',
        'reply-status',
      ),
    );
  const sourceLink = (ref) => {
    const link = node(root, 'a', ref.title || ref.url);
    link.href = ref.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  };
  const listedLinks = [...suppliedLinks.values()];
  if (listedLinks.length) {
    const visible = node(root, 'nav', null, 'reply-source-links');
    visible.setAttribute('aria-label', 'Sources');
    for (const ref of listedLinks.slice(0, 2)) {
      const paragraph = node(root, 'p');
      paragraph.append(sourceLink(ref));
      visible.append(paragraph);
    }
    container.append(visible);
  }
  if (listedLinks.length > 2 || memories.size) {
    const details = node(root, 'details', null, 'reply-references');
    details.append(node(root, 'summary', 'More references'));
    for (const ref of listedLinks.slice(2)) details.append(sourceLink(ref));
    for (const ref of memories.values()) {
      const button = node(root, 'button', `${ref.id} · Earlier chat: ${ref.title}`);
      button.type = 'button';
      button.addEventListener('click', () => onSelect(ref.threadId));
      details.append(button);
    }
    container.append(details);
  }
  if (retryable && ['error', 'cancelled'].includes(message.status)) {
    const retry = node(root, 'button', 'Retry', 'retry-answer secondary-button');
    retry.type = 'button';
    retry.addEventListener('click', () => onRetry(message));
    container.append(retry);
  }
  return container;
}

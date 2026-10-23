import { Marked } from 'marked';
import katex from 'katex';

function mathAtStart(source) {
  if (!source.startsWith('$')) return null;
  const delimiter = source.startsWith('$$') ? '$$' : '$';
  let depth = 0;
  for (let index = delimiter.length; index < source.length; index++) {
    if (source[index] === '\\') {
      index++;
      continue;
    }
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth = Math.max(0, depth - 1);
    if (!depth && source.startsWith(delimiter, index)) {
      const tex = source.slice(delimiter.length, index);
      if (!tex.trim()) return null;
      return { raw: source.slice(0, index + delimiter.length), tex, display: delimiter === '$$' };
    }
  }
  return null;
}

// Capture math before Markdown can consume LaTeX backslashes. Placeholders carry
// no HTML and belong only to this render; escaped dollars and code stay literal.
export function parseMathMarkdown(markdown) {
  const expressions = new Map();
  const nonce = crypto.randomUUID();
  const parser = new Marked({
    breaks: true,
    async: false,
    extensions: [
      {
        name: 'studyMath',
        level: 'inline',
        start: (source) => source.indexOf('$'),
        tokenizer(source) {
          const math = mathAtStart(source);
          return math ? { type: 'studyMath', ...math } : undefined;
        },
        renderer(token) {
          const key = `\uE000${nonce}:${expressions.size}\uE001`;
          expressions.set(key, token);
          return key;
        },
      },
    ],
  });
  return { html: parser.parse(markdown), expressions };
}

export function renderMath(body, expressions) {
  const root = body.ownerDocument;
  const walker = root.createTreeWalker(body, root.defaultView.NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) texts.push(walker.currentNode);
  for (const text of texts) {
    const fragment = root.createDocumentFragment();
    const pattern = /\uE000[0-9a-f-]+:\d+\uE001/g;
    let match,
      offset = 0;
    while ((match = pattern.exec(text.textContent))) {
      const math = expressions.get(match[0]);
      if (!math) continue;
      fragment.append(text.textContent.slice(offset, match.index));
      if (text.parentElement.closest('code,pre,a')) fragment.append(math.raw);
      else {
        const rendered = root.createElement('span');
        rendered.innerHTML = katex.renderToString(math.tex, {
          displayMode: math.display,
          trust: false,
          throwOnError: false,
          strict: 'ignore',
          maxExpand: 100,
          maxSize: 20,
          macros: {},
        });
        fragment.append(rendered);
      }
      offset = pattern.lastIndex;
    }
    if (offset) {
      fragment.append(text.textContent.slice(offset));
      text.replaceWith(fragment);
    }
  }
}

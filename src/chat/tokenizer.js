import { Tokenizer } from '@huggingface/tokenizers';
import { Template } from '@huggingface/jinja';

const loads = new WeakMap();

// Counts the complete prompt exactly as the pinned Gemma template formats it.
// The runtime receives messages.slice(0, -1) as its preface and sends the final
// user message separately. Counting both here includes that user exactly once.
export function createTokenizer(json, config, template) {
  if (!json || typeof json !== 'object' || !config || typeof config !== 'object') {
    throw new Error('Tokenizer JSON and configuration are required.');
  }
  if (typeof config.bos_token !== 'string' || typeof template !== 'string' || !template.trim()) {
    throw new Error('The pinned tokenizer BOS token and chat template are required.');
  }
  const encoder = new Tokenizer(json, config);
  const compiled = new Template(template);
  const countText = (text) => {
    if (typeof text !== 'string') throw new Error('Tokenizer input must be a text string.');
    // BOS/turn/generation tokens already come from the Jinja template.
    return encoder.encode(text, { add_special_tokens: false }).ids.length;
  };
  return {
    countText,
    countMessages(messages) {
      if (!Array.isArray(messages) || !messages.length)
        throw new Error('At least one text message is required.');
      for (const [index, message] of messages.entries()) {
        if (
          !message ||
          !['system', 'developer', 'user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string'
        ) {
          throw new Error(
            'Only system, developer, user and assistant text messages can be counted.',
          );
        }
        if (index > 0 && ['system', 'developer'].includes(message.role))
          throw new Error('A system message must be the first message.');
      }
      const rendered = compiled.render({
        ...config,
        messages,
        bos_token: config.bos_token,
        tools: [],
        enable_thinking: false,
        add_generation_prompt: true,
      });
      return countText(rendered);
    },
  };
}

// The packaged asset base is supplied by the extension. Concurrent consumers
// share one parsed vocabulary; failed loads are removed so a retry can recover.
export async function loadTokenizer(fetch, baseURL) {
  if (typeof fetch !== 'function') throw new Error('A tokenizer asset fetch function is required.');
  const base = new URL(String(baseURL).replace(/\/?$/, '/')).href;
  let cache = loads.get(fetch);
  if (!cache) {
    cache = new Map();
    loads.set(fetch, cache);
  }
  if (!cache.has(base)) {
    const pending = (async () => {
      const read = async (name, kind) => {
        const response = await fetch(new URL(name, base).href);
        if (!response.ok) throw new Error(`Could not load ${name}: HTTP ${response.status}.`);
        return kind === 'json' ? response.json() : response.text();
      };
      const [json, config, template] = await Promise.all([
        read('tokenizer.json', 'json'),
        read('tokenizer_config.json', 'json'),
        read('chat_template.jinja', 'text'),
      ]);
      return createTokenizer(json, config, template);
    })();
    cache.set(base, pending);
    pending.catch(() => {
      if (cache.get(base) === pending) cache.delete(base);
    });
  }
  return cache.get(base);
}

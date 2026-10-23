import { marked } from 'marked';

const CANVAS_ORIGIN = 'https://msjc.instructure.com';
const inCourse = (url, courseId) =>
  /^\d+$/.test(String(courseId)) &&
  (url.pathname === `/courses/${courseId}` || url.pathname.startsWith(`/courses/${courseId}/`));

export function validatedSourceURL(value, courseId) {
  try {
    const url = new URL(value);
    return url.origin === CANVAS_ORIGIN && !url.username && !url.password && inCourse(url, courseId)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function validatedSourceLink(value, baseURL, courseId) {
  const base = validatedSourceURL(baseURL, courseId);
  if (!base) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (
      (url.hostname === 'instructure.com' || url.hostname.endsWith('.instructure.com')) &&
      (url.origin !== CANVAS_ORIGIN || !inCourse(url, courseId))
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

// Only Markdown link tokens from the retrieved source can authorize destinations.
// Images and raw HTML do not become answer links or trigger any network request.
export function extractSourceLinks(markdown, baseURL, courseId) {
  if (typeof markdown !== 'string' || !validatedSourceURL(baseURL, courseId)) return [];
  const links = new Map();
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type !== 'link') return;
    const url = validatedSourceLink(token.href, baseURL, courseId);
    if (url && !links.has(url)) links.set(url, { title: token.text || url, url });
  });
  return [...links.values()];
}

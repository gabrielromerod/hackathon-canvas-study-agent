export function node(root, tag, text, className) {
  const value = root.createElement(tag);
  if (text != null) value.textContent = text;
  if (className) value.className = className;
  return value;
}
export function webLink(root, label, value, className) {
  let url;
  try {
    url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
  } catch {
    return node(root, 'span', label, className);
  }
  const link = node(root, 'a', label, className);
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

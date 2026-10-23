import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

// Parse locally into an inert document. Never insert lesson HTML into the popup.
export function htmlToMarkdown(html, pageUrl, Parser = DOMParser) {
  const doc = new Parser().parseFromString(html, 'text/html');
  const warnings = [];
  const safeUrl = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value, pageUrl);
      return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const dataUri = (type, source) =>
    `data:${type},${encodeURIComponent(source).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  const linkNode = (label, href) => {
    const a = doc.createElement('a');
    a.textContent = label;
    if (href) a.setAttribute('href', href);
    return a;
  };

  // Preserve formula sources before a generic image rule can discard them.
  for (const image of doc.querySelectorAll('img[data-equation-content]')) {
    const formula = doc.createElement('span');
    formula.setAttribute('data-formula', 'inline');
    formula.textContent = image.getAttribute('data-equation-content');
    image.replaceWith(formula);
  }
  for (const math of doc.querySelectorAll('math')) {
    const latex =
      math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ||
      math.getAttribute('alttext');
    if (latex) {
      const formula = doc.createElement('span');
      formula.setAttribute(
        'data-formula',
        math.getAttribute('display') === 'block' ? 'block' : 'inline',
      );
      formula.textContent = latex;
      math.replaceWith(formula);
    } else {
      const label = `MathML formula: ${math.textContent.trim() || 'source'}`;
      math.replaceWith(linkNode(label, dataUri('application/mathml+xml', math.outerHTML)));
      warnings.push(
        'MathML without LaTeX was retained as a source data link; its text alone may not express the full formula.',
      );
    }
  }
  for (const svg of doc.querySelectorAll('svg')) {
    for (const script of svg.querySelectorAll('script')) script.remove();
    const image = doc.createElement('img');
    image.alt =
      svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || 'Inline graphic';
    image.setAttribute('src', dataUri('image/svg+xml', svg.outerHTML));
    svg.replaceWith(image);
  }
  for (const node of doc.querySelectorAll('script, style, noscript, template')) node.remove();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    // Only our generated MathML data link is allowed as a non-web link.
    const normalized = href.startsWith('data:application/mathml+xml,') ? href : safeUrl(href);
    if (normalized) a.setAttribute('href', normalized);
    else a.removeAttribute('href');
  }
  for (const image of doc.querySelectorAll('img')) {
    const src = image.getAttribute('src');
    const normalized = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/i.test(src || '')
      ? src
      : safeUrl(src);
    if (normalized) image.setAttribute('src', normalized);
    else image.replaceWith(doc.createTextNode(image.getAttribute('alt') || 'Image unavailable'));
  }
  for (const media of doc.querySelectorAll('iframe, video, audio, object, embed')) {
    const replacement = doc.createElement('div');
    const label =
      media.getAttribute('title') ||
      media.getAttribute('aria-label') ||
      (media.tagName === 'IFRAME' ? 'Embedded resource' : media.tagName.toLowerCase());
    const sources = [
      media.getAttribute('src') || media.getAttribute('data'),
      ...Array.from(media.querySelectorAll('source, track'), (source) =>
        source.getAttribute('src'),
      ),
    ];
    const urls = [...new Set(sources.map(safeUrl).filter(Boolean))];
    for (const url of urls) {
      const p = doc.createElement('p');
      p.append(linkNode(label, url));
      replacement.append(p);
    }
    const poster = safeUrl(media.getAttribute('poster'));
    if (poster) {
      const image = doc.createElement('img');
      image.alt = `${label} poster`;
      image.src = poster;
      replacement.append(image);
    }
    // Fallback descriptions or transcript links inside media are meaningful too.
    for (const source of media.querySelectorAll('source, track')) source.remove();
    if (media.textContent.trim()) {
      const p = doc.createElement('p');
      p.append(...Array.from(media.childNodes));
      replacement.append(p);
    }
    if (!urls.length) {
      replacement.append(doc.createTextNode(`${label} (no accessible source URL)`));
      warnings.push('An embedded resource has no accessible source URL.');
    }
    media.replaceWith(replacement);
  }

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  service.use(gfm);
  service.addRule('formulas', {
    filter: (node) => node.hasAttribute('data-formula'),
    replacement: (_content, node) =>
      node.getAttribute('data-formula') === 'block'
        ? `\n\n$$\n${node.textContent}\n$$\n\n`
        : `$${node.textContent}$`,
  });
  service.addRule('subscript', { filter: ['sub'], replacement: (content) => `_{${content}}` });
  service.addRule('superscript', { filter: ['sup'], replacement: (content) => `^{${content}}` });
  service.addRule('allTables', {
    filter: ['table'],
    replacement: (_content, node) => {
      const rows = Array.from(node.rows || []);
      if (!rows.length) return '';
      const values = rows.map(() => []);
      rows.forEach((row, rowIndex) => {
        let column = 0;
        for (const cell of row.cells) {
          while (values[rowIndex][column] !== undefined) column++;
          const value = service.turndown(cell).trim().replace(/\n+/g, ' / ').replace(/\|/g, '\\|');
          const rowSpan = Math.min(cell.rowSpan || rows.length - rowIndex, rows.length - rowIndex);
          const colSpan = cell.colSpan || 1;
          for (let dr = 0; dr < rowSpan; dr++) {
            for (let dc = 0; dc < colSpan; dc++) {
              values[rowIndex + dr][column + dc] = dc
                ? ''
                : dr
                  ? `${value} (continued)`
                  : value +
                    (rowSpan > 1 || colSpan > 1 ? ` [rowspan ${rowSpan}, colspan ${colSpan}]` : '');
            }
          }
          column += colSpan;
        }
      });
      const width = Math.max(...values.map((row) => row.length));
      const hasHeader = rows[0].querySelector('th') !== null;
      const heading = hasHeader
        ? values.shift()
        : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
      const rowText = (cells) =>
        `| ${Array.from({ length: width }, (_, i) => cells[i] || '').join(' | ')} |`;
      const caption = node.caption ? service.turndown(node.caption).trim() : '';
      return `\n\n${caption ? `${caption}\n\n` : ''}${rowText(heading)}\n${rowText(Array(width).fill('---'))}\n${values.map(rowText).join('\n')}\n\n`;
    },
  });
  const markdown = service.turndown(doc.body).trim();
  return { markdown, warnings: [...new Set(warnings)] };
}

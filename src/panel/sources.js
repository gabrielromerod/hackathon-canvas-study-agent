import { pageContentSummary } from '../course/content-loader.js';
import { fileAccessSummary, isFileItem } from '../course/file-loader.js';
import { node, webLink } from './dom.js';

const dueLabel = (value) =>
  /^\d{4}-\d{2}-\d{2}T/.test(value || '') && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : value;

export function renderSources(root, state, filter, onSelect) {
  const list = root.querySelector('#source-list');
  const expanded = new Set(
    [...list.querySelectorAll('details[open][data-key]')].map((value) => value.dataset.key),
  );
  const focused = root.activeElement?.dataset.focusId;
  list.replaceChildren();
  const warnings = root.querySelector('#source-warnings');
  warnings.replaceChildren();
  const snapshot = state.snapshot;
  if (!snapshot) {
    list.append(
      node(
        root,
        'p',
        state.busy
          ? 'Loading your course materials…'
          : 'Open an MSJC Canvas course to connect your sources.',
        'empty-note',
      ),
    );
    root.querySelector('#source-summary').textContent = '';
    warnings.hidden = true;
    return;
  }
  const pages = pageContentSummary(snapshot),
    files = fileAccessSummary(snapshot);
  root.querySelector('#source-summary').textContent =
    `${snapshot.modules.length} modules · ${pages.loaded}/${pages.total} pages · ${files.available}/${files.total} files available${pages.failed + files.failed ? ` · ${pages.failed + files.failed} read errors` : ''}${pages.locked + files.locked ? ` · ${pages.locked + files.locked} locked` : ''}`;
  for (const warning of snapshot.warnings || []) warnings.append(node(root, 'p', warning));
  warnings.hidden = !warnings.childElementCount;
  let visible = 0;
  for (const module of snapshot.modules) {
    const items = module.items.filter((item) => filter !== 'files' || isFileItem(item));
    if (filter === 'files' && !items.length) continue;
    visible++;
    const details = node(root, 'details', null, 'module');
    details.dataset.key = `module-${module.id}`;
    details.open = expanded.has(details.dataset.key) || state.selection?.moduleId === module.id;
    const heading = node(root, 'summary', module.title);
    heading.dataset.focusId = details.dataset.key;
    heading.append(
      node(
        root,
        'span',
        `${items.filter((item) => item.type !== 'Section').length} materials`,
        'module-count',
      ),
    );
    details.append(heading);
    const ul = node(root, 'ul');
    for (const item of items) {
      const li = node(root, 'li', null, item.type === 'Section' ? 'section' : '');
      li.append(webLink(root, item.title, item.url, 'item-title'));
      if (item.type !== 'Section') {
        li.append(
          node(
            root,
            'span',
            [
              item.type,
              item.dueDate ? `Due ${dueLabel(item.dueDate)}` : null,
              item.points != null ? `${item.points} pts` : null,
              item.locked ? 'Locked' : null,
            ]
              .filter(Boolean)
              .join(' · '),
            'meta',
          ),
        );
        if (item.content?.markdown !== undefined) {
          const preview = node(root, 'details', null, 'page-content');
          preview.dataset.key = `page-${item.id}`;
          preview.open =
            expanded.has(preview.dataset.key) || state.selection?.selectedItemId === item.id;
          const summary = node(root, 'summary', 'Markdown preview');
          summary.dataset.focusId = preview.dataset.key;
          summary.addEventListener('click', () =>
            onSelect({ moduleId: module.id, selectedItemId: item.id, filter }),
          );
          preview.append(
            summary,
            node(root, 'pre', item.content.markdown || '(Empty page)', 'markdown-preview'),
          );
          for (const warning of item.content.warnings || [])
            preview.append(node(root, 'p', warning, 'content-warning'));
          li.append(preview);
        }
        if (isFileItem(item) && item.content?.status === 'available') {
          const file = item.content.file;
          li.append(webLink(root, `Download ${file.name}`, file.downloadUrl, 'file-download'));
          li.append(
            node(
              root,
              'span',
              [
                file.mimeType,
                file.size != null ? `${Number(file.size).toLocaleString()} bytes` : null,
              ]
                .filter(Boolean)
                .join(' · '),
              'meta',
            ),
          );
        }
        if (['error', 'locked'].includes(item.content?.status))
          li.append(
            node(
              root,
              'p',
              item.content.error || 'This material is unavailable.',
              'content-warning',
            ),
          );
      }
      ul.append(li);
    }
    details.append(ul);
    if (!items.length)
      details.append(node(root, 'p', 'No available items in this module.', 'empty-note'));
    list.append(details);
  }
  if (!visible)
    list.append(
      node(
        root,
        'p',
        filter === 'files'
          ? 'No files are linked in these modules.'
          : 'No modules are currently available.',
        'empty-note',
      ),
    );
  if (focused)
    [...list.querySelectorAll('[data-focus-id]')]
      .find((element) => element.dataset.focusId === focused)
      ?.focus();
}

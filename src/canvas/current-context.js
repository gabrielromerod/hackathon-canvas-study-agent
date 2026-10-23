import { normalizeScope } from '../chat/scope.js';

const ORIGIN = 'https://msjc.instructure.com';
const unavailable = (reason) => ({ scope: null, currentSource: null, available: false, reason });
const decoded = (value) => {
  try {
    return decodeURIComponent(value).normalize('NFC');
  } catch {
    return value;
  }
};
const pathKey = (url) =>
  decoded(url.pathname.replace(/^\/api\/v1(?=\/courses\/)/, '')).replace(/\/+$/, '');

// Resolves only cached identifiers against the fresh tab context. It performs no
// requests, keeps no current selection, and never guesses a source by its title.
export function resolveCurrentScope(snapshot, context) {
  const courseId = String(snapshot?.courseId ?? '');
  if (!/^\d+$/.test(courseId) || String(context?.courseId ?? '') !== courseId)
    return unavailable('This tab is not connected to this Canvas course.');
  if (!Number.isInteger(context?.tabId) || context.tabId < 0)
    return unavailable('The current Canvas tab is closed or unavailable.');
  let current;
  try {
    current = new URL(context.url);
  } catch {
    return unavailable('The current tab URL is unavailable.');
  }
  const ownCourseUrl = (value) => {
    try {
      const url = new URL(value, ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password) return null;
      const rawCourse = url.pathname.match(/^\/(?:api\/v1\/)?courses\/(\d+)(?:\/|$)/)?.[1];
      if (rawCourse !== courseId) return null;
      const route = pathKey(url);
      return route === `/courses/${courseId}` || route.startsWith(`/courses/${courseId}/`)
        ? url
        : null;
    } catch {
      return null;
    }
  };
  if (!ownCourseUrl(current.href))
    return unavailable(
      'This tab is outside this Canvas course. External page bodies cannot be read.',
    );
  if (!Array.isArray(snapshot.modules))
    return unavailable('Read this course before using This tab.');
  const currentPath = pathKey(current);
  const canonical = (url) => {
    const value = new URL(url.href);
    value.pathname = pathKey(value);
    value.search = '';
    value.hash = '';
    const file = value.pathname.match(/^(\/courses\/\d+\/files\/\d+)(?:\/|$)/);
    if (file) value.pathname = file[1];
    return value.href;
  };
  const entries = [];
  for (const module of snapshot.modules) {
    let section = null;
    for (const item of module.items || []) {
      if (item.type === 'Section') section = item;
      entries.push({ module, item, section });
    }
  }
  const knownUrls = (entry) =>
    [
      entry.item.content?.sourceUrl,
      entry.item.pageUrl,
      entry.item.page_url,
      entry.item.url,
      entry.item.content?.file?.sourceUrl,
    ]
      .filter((value) => typeof value === 'string' && /^(?:https?:\/\/|\/)/.test(value))
      .map(ownCourseUrl)
      .filter(Boolean);
  const finish = (entry) => {
    const { module, item, section } = entry;
    const scope = normalizeScope(
      item.type === 'Section'
        ? { kind: 'section', moduleId: module.id, sectionId: item.id, label: item.title }
        : {
            kind: item.type === 'Page' ? 'page' : 'item',
            moduleId: module.id,
            itemId: item.id,
            label: item.title,
          },
    );
    const urls = knownUrls(entry);
    const preferred =
      urls.find((url) => !/\/modules\/(?:items\/|\d+\/items\/)/.test(pathKey(url))) ||
      urls[0] ||
      current;
    const locked = item.locked || item.content?.status === 'locked';
    const reason = locked
      ? 'This source is locked in Canvas; only its metadata is available.'
      : item.type === 'Page'
        ? item.content?.status === 'loaded'
          ? ''
          : 'This Page body has not been read yet.'
        : item.type === 'Section'
          ? ''
          : 'Only this Canvas item’s metadata is available; its body and embedded external content have not been read.';
    return {
      scope,
      currentSource: {
        title: String(item.title || context.title || 'Untitled source'),
        url: canonical(preferred),
        moduleId: String(module.id),
        itemId: String(item.id),
        sectionId: section ? String(section.id) : null,
        type: item.type,
      },
      available: true,
      reason,
    };
  };
  const hintedId = context.moduleItemId ?? current.searchParams.get('module_item_id');
  if (hintedId != null) {
    const hinted = entries.find((entry) => String(entry.item.id) === String(hintedId));
    if (hinted) return finish(hinted);
    return unavailable(
      'The current Canvas module item is not present in the saved course. Refresh the course sources.',
    );
  }
  const routeItem = currentPath.match(
    new RegExp(`^/courses/${courseId}/modules/(?:items/(\\d+)|(\\d+)/items/(\\d+))$`),
  );
  if (routeItem) {
    const itemId = routeItem[1] || routeItem[3];
    const entry = entries.find(
      (value) =>
        String(value.item.id) === itemId &&
        (!routeItem[2] || String(value.module.id) === routeItem[2]),
    );
    return entry
      ? finish(entry)
      : unavailable('The current Canvas module item is not present in the saved course.');
  }
  const page = currentPath.match(new RegExp(`^/courses/${courseId}/pages/(.+)$`));
  const assignment = currentPath.match(
    new RegExp(`^/courses/${courseId}/assignments/(\\d+)(?:/|$)`),
  );
  const file = currentPath.match(new RegExp(`^/courses/${courseId}/files/(\\d+)(?:/|$)`));
  const match = entries.find((entry) => {
    const { item } = entry;
    if (page && item.type === 'Page') {
      if (
        [item.pageSlug, item.pageUrl, item.page_url].some(
          (value) =>
            typeof value === 'string' &&
            !/^(?:https?:\/\/|\/)/.test(value) &&
            decoded(value) === page[1],
        )
      )
        return true;
    }
    if (
      assignment &&
      ['Assignment', 'External Tool'].includes(item.type) &&
      String(item.assignmentId ?? item.contentId ?? item.content_id ?? '') === assignment[1]
    )
      return true;
    if (
      file &&
      ['Attachment', 'File'].includes(item.type) &&
      String(item.fileId ?? item.content?.file?.id ?? item.contentId ?? item.content_id ?? '') ===
        file[1]
    )
      return true;
    return knownUrls(entry).some((url) => {
      const key = pathKey(url);
      if (key === currentPath) return true;
      if (file)
        return key.match(new RegExp(`^/courses/${courseId}/files/(\\d+)(?:/|$)`))?.[1] === file[1];
      if (assignment)
        return (
          key.match(new RegExp(`^/courses/${courseId}/assignments/(\\d+)(?:/|$)`))?.[1] ===
          assignment[1]
        );
      return false;
    });
  });
  if (match) return finish(match);
  const moduleId =
    currentPath.match(new RegExp(`^/courses/${courseId}/modules/(\\d+)$`))?.[1] ||
    (currentPath === `/courses/${courseId}/modules`
      ? current.searchParams.get('module_id') || current.hash.match(/^#context_module_(\d+)$/)?.[1]
      : null);
  if (moduleId) {
    const module = snapshot.modules.find((value) => String(value.id) === moduleId);
    if (module)
      return {
        scope: normalizeScope({ kind: 'module', moduleId, label: module.title }),
        currentSource: {
          title: String(module.title || `Module ${moduleId}`),
          url: canonical(current),
          moduleId,
          itemId: null,
          sectionId: null,
          type: 'Module',
        },
        available: true,
        reason: '',
      };
  }
  return unavailable(
    'This tab does not identify a saved course source. Open a module item or choose a specific scope.',
  );
}

export function pageContentSummary(snapshot) {
  const pages = snapshot.modules
    .flatMap((module) => module.items)
    .filter((item) => item.type === 'Page');
  const summary = { total: pages.length, loaded: 0, failed: 0, locked: 0, pending: 0 };
  for (const page of pages) {
    const state = page.content?.status || (page.locked ? 'locked' : 'not_loaded');
    const key = { loaded: 'loaded', error: 'failed', locked: 'locked' }[state] || 'pending';
    summary[key] += 1;
  }
  return summary;
}

export async function loadPageContents(
  snapshot,
  readPage,
  convert,
  onProgress = () => {},
  options = {},
) {
  const { shouldContinue = () => true, onItem = () => {} } = options;
  if (!shouldContinue()) return snapshot;
  const jobs = [];
  for (const module of snapshot.modules) {
    for (const item of module.items.filter((item) => item.type === 'Page')) {
      if (['loaded', 'locked'].includes(item.content?.status)) continue;
      jobs.push({ module, item });
    }
  }
  const cache = new Map();
  const report = () => {
    snapshot.contentSummary = pageContentSummary(snapshot);
    onProgress(snapshot.contentSummary);
  };
  let next = 0;
  report();
  async function worker() {
    while (shouldContinue() && next < jobs.length) {
      const { module, item } = jobs[next++];
      if (item.locked) {
        item.content = { status: 'locked', error: 'This item is locked in Canvas.' };
        await onItem(module.id, item);
        if (!shouldContinue()) return;
        report();
        continue;
      }
      const key = item.pageId
        ? `page:${item.pageId}`
        : item.pageSlug
          ? `slug:${item.pageSlug}`
          : `item:${module.id}:${item.id}`;
      if (!cache.has(key)) {
        cache.set(
          key,
          (async () => {
            try {
              const result = await readPage({
                courseId: snapshot.courseId,
                moduleId: module.id,
                itemId: item.id,
                pageId: item.pageId ?? null,
                ...(item.pageSlug ? { pageSlug: item.pageSlug } : {}),
              });
              if (result.status !== 'loaded')
                return {
                  status: result.status === 'locked' ? 'locked' : 'error',
                  error: result.error || 'Page content unavailable.',
                };
              const { markdown, warnings } = convert(result.html, result.sourceUrl);
              return {
                status: 'loaded',
                format: 'markdown',
                markdown,
                sourceUrl: result.sourceUrl,
                pageId: result.pageId ?? null,
                title: result.title || item.title,
                updatedAt: result.updatedAt ?? null,
                ...(warnings.length ? { warnings } : {}),
              };
            } catch (error) {
              return { status: 'error', error: error.message || 'Page content could not be read.' };
            }
          })(),
        );
      }
      const content = await cache.get(key);
      if (!shouldContinue()) return;
      item.content = { ...content };
      await onItem(module.id, item);
      if (!shouldContinue()) return;
      report();
    }
  }
  await Promise.all([worker(), worker()]);
  return snapshot;
}

// Self-contained so Chrome can serialize this function into the active tab.
export function extractModules(root = document, pageUrl = location.href) {
  const page = new URL(pageUrl);
  const course = page.pathname.match(/^\/courses\/(\d+)\/modules\/?$/);
  if (page.origin !== 'https://msjc.instructure.com' || !course) {
    throw new Error('Open the MSJC Canvas Modules page for your course, then try again.');
  }
  const container = root.querySelector('#context_modules');
  if (!container) {
    throw new Error(
      'Canvas modules have not loaded. Sign in, wait for the Modules page to finish loading, then try again.',
    );
  }
  const clean = (value) => value?.replace(/\s+/g, ' ').trim() || null;
  const text = (element, selector) => clean(element.querySelector(selector)?.textContent);
  const safeUrl = (href) => {
    if (!href) return null;
    try {
      const url = new URL(href, page);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const warnings = [];
  const modules = Array.from(container.querySelectorAll('.context_module'))
    .filter((module) => /^context_module_\d+$/.test(module.id))
    .map((module) => {
      const id = module.id.replace('context_module_', '');
      const title =
        text(module, 'h2') || clean(module.getAttribute('aria-label')) || `Module ${id}`;
      const week = title.match(/\bweek\s+(\d+)\b/i);
      const items = Array.from(module.querySelectorAll('.context_module_item'))
        .filter((item) => /^context_module_item_\d+$/.test(item.id))
        .map((item) => {
          const link = item.querySelector('.item_name a');
          const typeLabel = clean(item.querySelector('.type_icon')?.getAttribute('title'));
          const type = typeLabel === 'Context Module Sub Header' ? 'Section' : typeLabel || 'Item';
          const pointsText = text(item, '.points_possible_display');
          const points = pointsText?.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
          return {
            id: item.id.replace('context_module_item_', ''),
            title: clean(link?.textContent) || text(item, '.item_name .title') || 'Untitled item',
            type,
            url: safeUrl(link?.getAttribute('href')),
            dueDate: text(item, '.due_date_display'),
            points: points ? Number(points[0]) : null,
            locked: type !== 'Section' && (!link || item.classList.contains('locked')),
            ...(type === 'Page'
              ? {
                  pageId: item.className.match(/(?:^|\s)WikiPage_(\d+)(?:\s|$)/)?.[1] || null,
                  content: { status: 'not_loaded' },
                }
              : {}),
            ...(['Attachment', 'File'].includes(type)
              ? {
                  fileId: item.className.match(/(?:^|\s)Attachment_(\d+)(?:\s|$)/)?.[1] || null,
                  content: { status: 'not_loaded' },
                }
              : {}),
          };
        });
      if (!items.length)
        warnings.push(
          `“${title}” has no loaded items. It may be empty, locked, or require expanding in Canvas before reading again.`,
        );
      return { id, title, week: week ? Number(week[1]) : null, items };
    });
  if (!modules.length) warnings.push('No modules are currently available on this page.');
  return {
    schemaVersion: 2,
    courseId: course[1],
    courseTitle:
      text(root, '#breadcrumbs a') ||
      clean(root.title?.replace(/^Course Modules:\s*/i, '')) ||
      `Course ${course[1]}`,
    sourceUrl: page.href,
    extractedAt: new Date().toISOString(),
    modules,
    itemCount: modules.reduce((sum, module) => sum + module.items.length, 0),
    warnings,
  };
}

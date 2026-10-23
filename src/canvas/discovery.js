// Serialized into the active Canvas tab: keep every helper inside this function.
export async function discoverCourse({ courseId }) {
  const origin = 'https://msjc.instructure.com';
  const activeCourse = location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
  courseId = String(courseId);
  if (!/^\d+$/.test(courseId) || location.origin !== origin || activeCourse !== courseId) {
    throw new Error('Open a page in this MSJC Canvas course, then try again.');
  }
  const prefix = `${origin}/api/v1/courses/${courseId}`;
  const get = async (url) => {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Canvas returned HTTP ${response.status}. Sign in or check course access, then retry.`,
      );
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Canvas did not return course data. Please sign in again and retry.');
    }
    return { data: await response.json(), link: response.headers.get('link') || '' };
  };
  const list = async (firstUrl) => {
    const endpoint = new URL(firstUrl).pathname;
    const visited = new Set();
    const entries = [];
    let next = firstUrl;
    while (next) {
      const url = new URL(next);
      // Pagination may only continue the current list within this exact course.
      if (
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.hash ||
        url.pathname !== endpoint ||
        !url.pathname.startsWith(`/api/v1/courses/${courseId}/`)
      ) {
        throw new Error('Canvas returned an unsafe course pagination link.');
      }
      if (visited.has(url.href)) throw new Error('Canvas returned a repeated pagination link.');
      visited.add(url.href);
      const { data, link } = await get(url.href);
      if (!Array.isArray(data)) throw new Error('Canvas did not return a module list.');
      entries.push(...data);
      next = null;
      for (const match of link.matchAll(/<([^>]+)>([^,]*)/g)) {
        const relation = match[2].match(/;\s*rel\s*=\s*(?:"([^"]*)"|([^;\s]+))/i);
        if ((relation?.[1] || relation?.[2] || '').split(/\s+/).includes('next')) {
          next = new URL(match[1], url).href;
          break;
        }
      }
    }
    return entries;
  };
  const byPosition = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0);
  const identifier = (value) => {
    if (!/^\d+$/.test(String(value)))
      throw new Error('Canvas returned an invalid module identifier.');
    return String(value);
  };
  const safeUrl = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value, origin);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  };
  const course = (await get(prefix)).data;
  if (!course || typeof course !== 'object' || Array.isArray(course))
    throw new Error('Canvas did not return course metadata.');
  const rawModules = await list(
    `${prefix}/modules?include[]=items&include[]=content_details&per_page=100`,
  );
  const warnings = [];
  const modules = [];
  const types = {
    SubHeader: 'Section',
    File: 'Attachment',
    Discussion: 'Discussion Topic',
    ExternalUrl: 'External Url',
    ExternalTool: 'External Tool',
  };
  for (const module of rawModules.sort(byPosition)) {
    const id = identifier(module.id);
    const title = module.name || `Module ${id}`;
    let rawItems = module.items;
    if (
      !Array.isArray(rawItems) ||
      (module.items_count != null && rawItems.length < Number(module.items_count))
    ) {
      rawItems = await list(`${prefix}/modules/${id}/items?include[]=content_details&per_page=100`);
    }
    const items = rawItems.sort(byPosition).map((item) => {
      const type = types[item.type] || item.type || 'Item';
      const details = item.content_details || {};
      const points = details.points_possible;
      return {
        id: identifier(item.id),
        title: item.title || 'Untitled item',
        type,
        url: type === 'Section' ? null : safeUrl(item.html_url || item.external_url),
        dueDate: details.due_at || null,
        points: points != null && Number.isFinite(Number(points)) ? Number(points) : null,
        locked:
          type !== 'Section' &&
          Boolean(
            module.state === 'locked' ||
            module.locked_for_user ||
            details.locked_for_user ||
            item.locked_for_user,
          ),
        ...(type === 'Page'
          ? {
              pageId: null,
              ...(typeof item.page_url === 'string' && item.page_url
                ? { pageSlug: item.page_url }
                : {}),
              content: { status: 'not_loaded' },
            }
          : {}),
        ...(type === 'Attachment'
          ? {
              fileId: item.content_id == null ? null : identifier(item.content_id),
              content: { status: 'not_loaded' },
            }
          : {}),
      };
    });
    if (!items.length)
      warnings.push(`“${title}” has no available items. It may be empty or locked in Canvas.`);
    if (module.items_count != null && items.length < Number(module.items_count))
      warnings.push(`“${title}” has fewer accessible items than Canvas reports.`);
    const week = title.match(/\bweek\s+(\d+)\b/i);
    modules.push({ id, title, week: week ? Number(week[1]) : null, items });
  }
  if (!modules.length) warnings.push('No modules are currently available in this course.');
  return {
    schemaVersion: 2,
    courseId,
    courseTitle: course.name || course.course_code || `Course ${courseId}`,
    sourceUrl: `${origin}/courses/${courseId}/modules`,
    extractedAt: new Date().toISOString(),
    modules,
    itemCount: modules.reduce((sum, module) => sum + module.items.length, 0),
    warnings,
  };
}

// Serialized by chrome.scripting: keep all helpers inside this function.
export async function fetchPageContent(request) {
  try {
    const origin = 'https://msjc.instructure.com';
    const activeCourse = location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
    if (location.origin !== origin || activeCourse !== String(request.courseId)) {
      throw new Error('Keep this MSJC Canvas course tab open while reading pages.');
    }
    for (const key of ['courseId', 'moduleId', 'itemId']) {
      if (!/^\d+$/.test(String(request[key]))) throw new Error('Invalid Canvas page identifier.');
    }
    const prefix = `${origin}/api/v1/courses/${request.courseId}`;
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
          `Canvas returned HTTP ${response.status}. Sign in or check page access, then retry.`,
        );
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Canvas did not return page data. Please sign in again and retry.');
      }
      return response.json();
    };
    let endpoint;
    if (request.pageId != null) {
      if (!/^\d+$/.test(String(request.pageId))) throw new Error('Invalid Canvas page identifier.');
      endpoint = `${prefix}/pages/page_id:${request.pageId}`;
    } else if (request.pageSlug != null) {
      if (typeof request.pageSlug !== 'string' || !request.pageSlug.trim())
        throw new Error('Invalid Canvas page slug.');
      endpoint = `${prefix}/pages/${encodeURIComponent(request.pageSlug)}`;
    } else {
      const item = await get(`${prefix}/modules/${request.moduleId}/items/${request.itemId}`);
      if (item.type !== 'Page' || typeof item.page_url !== 'string' || !item.page_url) {
        throw new Error('This module item does not identify a Canvas Page.');
      }
      endpoint = `${prefix}/pages/${encodeURIComponent(item.page_url)}`;
    }
    const page = await get(endpoint);
    if (page.locked_for_user)
      return { status: 'locked', error: page.lock_explanation || 'Canvas has locked this page.' };
    if (typeof page.body !== 'string')
      throw new Error('Canvas did not include a page body. It may be unavailable.');
    // Return only the fields the converter needs; raw HTML is never exported.
    return {
      status: 'loaded',
      html: page.body,
      pageId: page.page_id ?? null,
      title: page.title || '',
      sourceUrl: page.html_url || endpoint,
      updatedAt: page.updated_at || null,
    };
  } catch (error) {
    return {
      status: 'error',
      error:
        error.name === 'TimeoutError'
          ? 'Canvas page request timed out. Please retry.'
          : error.message || 'Could not retrieve this page.',
    };
  }
}

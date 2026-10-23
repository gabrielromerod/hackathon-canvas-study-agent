// Runs in the Canvas tab; all helpers must survive executeScript serialization.
export async function fetchFileMetadata(request) {
  try {
    const origin = 'https://msjc.instructure.com';
    const activeCourse = location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
    if (location.origin !== origin || activeCourse !== String(request.courseId))
      throw new Error('Keep this Canvas course tab open while reading file access.');
    for (const key of ['courseId', 'moduleId', 'itemId'])
      if (!/^\d+$/.test(String(request[key]))) throw new Error('Invalid Canvas file identifier.');
    const prefix = `${origin}/api/v1/courses/${request.courseId}`;
    const getJson = async (url) => {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Canvas file request returned HTTP ${response.status}.`);
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error('Sign in to Canvas again before reading file access.');
      return response.json();
    };
    let fileId = request.fileId;
    if (fileId == null) {
      const item = await getJson(`${prefix}/modules/${request.moduleId}/items/${request.itemId}`);
      if (item.type !== 'File') throw new Error('This item is not a Canvas file.');
      fileId = item.content_id;
    }
    if (!/^\d+$/.test(String(fileId))) throw new Error('Invalid Canvas file identifier.');
    const file = await getJson(`${prefix}/files/${fileId}`);
    // Hidden files can still be downloaded through a module link. Canvas reports access locks separately.
    if (file.locked_for_user)
      return {
        status: 'locked',
        format: 'file',
        error: file.lock_explanation || 'Canvas has locked this file.',
      };
    const sourceUrl = `${origin}/courses/${request.courseId}/files/${fileId}`;
    // Canvas redirects this authenticated link to storage when the user downloads.
    // Never export expiring signed storage URLs or fetch the binary for conversion.
    return {
      status: 'available',
      format: 'file',
      file: {
        id: String(fileId),
        name: file.display_name || file.filename || `File ${fileId}`,
        mimeType: file['content-type'] || null,
        size: file.size ?? null,
        sourceUrl,
        downloadUrl: `${sourceUrl}/download?download_frd=1`,
        requiresCanvasLogin: true,
        updatedAt: file.updated_at || null,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      format: 'file',
      error:
        error.name === 'TimeoutError'
          ? 'File metadata request timed out. Please retry.'
          : error.message || 'Could not read this file’s access information.',
    };
  }
}

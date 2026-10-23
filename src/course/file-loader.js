export const isFileItem = (item) => ['Attachment', 'File'].includes(item.type);
export function fileAccessSummary(snapshot) {
  const files = snapshot.modules.flatMap((module) => module.items).filter(isFileItem);
  const summary = { total: files.length, available: 0, failed: 0, locked: 0, pending: 0 };
  for (const file of files) {
    const state = file.content?.status || (file.locked ? 'locked' : 'not_loaded');
    summary[{ available: 'available', error: 'failed', locked: 'locked' }[state] || 'pending']++;
  }
  return summary;
}

export async function loadFileMetadata(snapshot, readFile, onProgress = () => {}, options = {}) {
  const { shouldContinue = () => true, onItem = () => {} } = options;
  if (!shouldContinue()) return snapshot;
  const cache = new Map();
  const report = () => {
    snapshot.fileSummary = fileAccessSummary(snapshot);
    onProgress(snapshot.fileSummary);
  };
  report();
  for (const module of snapshot.modules)
    for (const item of module.items.filter(isFileItem)) {
      if (!shouldContinue()) return snapshot;
      if (item.locked && item.content?.status !== 'locked') {
        item.content = { status: 'locked', format: 'file', error: 'This Canvas file is locked.' };
        await onItem(module.id, item);
        if (!shouldContinue()) return snapshot;
        report();
      }
      if (['available', 'locked'].includes(item.content?.status)) continue;
      const key = item.fileId || `${module.id}:${item.id}`;
      if (!cache.has(key)) {
        try {
          const content = await readFile({
            courseId: snapshot.courseId,
            moduleId: module.id,
            itemId: item.id,
            fileId: item.fileId ?? null,
          });
          cache.set(
            key,
            ['available', 'locked', 'error'].includes(content?.status)
              ? content
              : { status: 'error', format: 'file', error: 'Canvas returned no file metadata.' },
          );
        } catch (error) {
          cache.set(key, {
            status: 'error',
            format: 'file',
            error: error.message || 'File access check failed.',
          });
        }
      }
      if (!shouldContinue()) return snapshot;
      item.content = { ...cache.get(key) };
      await onItem(module.id, item);
      if (!shouldContinue()) return snapshot;
      report();
    }
  report();
  return snapshot;
}

import { discoverCourse } from './discovery.js';
import { extractModules } from './extractor.js';
import { fetchPageContent } from './page-reader.js';
import { fetchFileMetadata } from './file-reader.js';

export function createCanvasSource(api) {
  const validateContext = (context) => {
    if (!Number.isInteger(context?.tabId) || context.tabId < 0)
      throw new Error('The original Canvas tab is no longer available.');
    if (!/^\d+$/.test(String(context.courseId))) throw new Error('No Canvas course is selected.');
  };
  const inject = async (context, func, args) => {
    validateContext(context);
    const results = await api.scripting.executeScript({
      target: { tabId: context.tabId },
      func,
      args,
    });
    const frame = results?.find((entry) => entry.frameId === 0) || results?.[0];
    if (frame?.error) throw new Error(frame.error.message || String(frame.error));
    if (!frame?.result || typeof frame.result !== 'object')
      throw new Error('Canvas returned no usable data from the original tab.');
    return frame.result;
  };
  const validateSnapshot = (context, snapshot) => {
    if (snapshot.error) throw new Error(snapshot.error);
    if (
      snapshot.schemaVersion !== 2 ||
      String(snapshot.courseId) !== String(context.courseId) ||
      typeof snapshot.courseTitle !== 'string' ||
      !Array.isArray(snapshot.modules) ||
      !snapshot.modules.every((module) => module && Array.isArray(module.items))
    ) {
      throw new Error('Canvas returned invalid course discovery data.');
    }
    return snapshot;
  };
  const modulesContext = (context) => {
    try {
      const url = new URL(context.url);
      return (
        url.origin === 'https://msjc.instructure.com' &&
        [`/courses/${context.courseId}/modules`, `/courses/${context.courseId}/modules/`].includes(
          url.pathname,
        )
      );
    } catch {
      return false;
    }
  };
  const read = async (context, request, func, kind) => {
    validateContext(context);
    if (request.courseId != null && String(request.courseId) !== String(context.courseId))
      throw new Error('This read belongs to another Canvas course.');
    const result = await inject(context, func, [
      { ...request, courseId: String(context.courseId) },
    ]);
    const success = kind === 'page' ? 'loaded' : 'available';
    if (
      ![success, 'locked', 'error'].includes(result.status) ||
      (result.status === 'loaded' && typeof result.html !== 'string') ||
      (result.status === 'available' && (!result.file || typeof result.file !== 'object'))
    ) {
      throw new Error(`Canvas returned invalid ${kind} data.`);
    }
    return result;
  };
  return {
    async discover(context) {
      validateContext(context);
      try {
        return validateSnapshot(
          context,
          await inject(context, discoverCourse, [{ courseId: String(context.courseId) }]),
        );
      } catch (error) {
        if (!modulesContext(context))
          throw new Error(
            `Could not discover this Canvas course: ${error.message || 'Course data is unavailable.'}`,
          );
        try {
          return validateSnapshot(context, await inject(context, extractModules, []));
        } catch (fallbackError) {
          throw new Error(
            `Could not discover this Canvas course: ${error.message || 'Canvas API unavailable.'} Modules page fallback: ${fallbackError.message || 'Modules are unavailable.'}`,
          );
        }
      }
    },
    readPage: (context, request) => read(context, request, fetchPageContent, 'page'),
    readFile: (context, request) => read(context, request, fetchFileMetadata, 'file'),
  };
}

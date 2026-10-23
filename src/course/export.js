import { pageContentSummary } from './content-loader.js';
import { fileAccessSummary, isFileItem } from './file-loader.js';

export function createCourseExport(snapshot) {
  const modules = snapshot.modules.map((module) => {
    let section = null;
    const sections = [];
    const lessons = [];
    for (const [index, item] of module.items.entries()) {
      if (item.type === 'Section') {
        section = { id: item.id, title: item.title };
        sections.push({ ...section, position: index + 1 });
        continue;
      }
      const content =
        item.type === 'Page'
          ? {
              format: 'markdown',
              ...(item.content || { status: item.locked ? 'locked' : 'not_loaded' }),
            }
          : isFileItem(item)
            ? {
                format: 'file',
                ...(item.content || { status: item.locked ? 'locked' : 'not_loaded' }),
              }
            : {
                status: item.locked ? 'locked' : 'link_only',
                format: 'link',
                url: item.url || null,
              };
      lessons.push({
        id: item.id,
        title: item.title,
        type: item.type,
        position: index + 1,
        section: section ? { ...section } : null,
        url: item.url || null,
        dueDate: item.dueDate ?? null,
        points: item.points ?? null,
        locked: Boolean(item.locked),
        ...(item.pageId != null ? { pageId: String(item.pageId) } : {}),
        ...(item.fileId != null ? { fileId: String(item.fileId) } : {}),
        content,
      });
    }
    return { id: module.id, title: module.title, week: module.week, sections, lessons };
  });
  return {
    schemaVersion: 3,
    course: {
      id: String(snapshot.courseId),
      title: snapshot.courseTitle,
      url: `https://msjc.instructure.com/courses/${snapshot.courseId}`,
      modulesUrl: snapshot.sourceUrl,
      modules,
    },
    extractedAt: snapshot.extractedAt,
    summary: {
      moduleCount: modules.length,
      lessonCount: modules.reduce((sum, module) => sum + module.lessons.length, 0),
      sectionCount: modules.reduce((sum, module) => sum + module.sections.length, 0),
      pages: pageContentSummary(snapshot),
      files: fileAccessSummary(snapshot),
    },
    warnings: snapshot.warnings || [],
  };
}

export const serializeCourseExport = (snapshot) =>
  JSON.stringify(createCourseExport(snapshot), null, 2) + '\n';

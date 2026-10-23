// Conversation context is independent from the reader's browsing selection.
export function normalizeScope(value = { kind: 'course' }) {
  if (value?.kind === 'course') return { kind: 'course' };
  if (value?.kind === 'current') return { kind: 'current', label: 'This tab' };
  const fields = {
    module: ['moduleId'],
    section: ['moduleId', 'sectionId'],
    page: ['moduleId', 'itemId'],
    item: ['moduleId', 'itemId'],
  }[value?.kind];
  if (!fields || fields.some((field) => !String(value[field] ?? '').trim()))
    throw new Error('Invalid conversation scope.');
  return {
    kind: value.kind,
    ...Object.fromEntries(fields.map((field) => [field, String(value[field])])),
    label: String(value.label || 'Selected source'),
  };
}

export function scopeKey(scope = { kind: 'course' }) {
  return [scope.kind, scope.moduleId, scope.sectionId, scope.itemId].join(':');
}

export function scopeChoices(snapshot) {
  const course = {
    scope: { kind: 'course' },
    label: 'Entire course',
    children: [{ scope: normalizeScope({ kind: 'current' }), label: 'This tab', children: [] }],
  };
  for (const module of snapshot?.modules || []) {
    const group = {
      scope: normalizeScope({ kind: 'module', moduleId: module.id, label: module.title }),
      label: module.title,
      children: [],
    };
    let parent = group;
    for (const item of module.items) {
      if (item.type === 'Section') {
        parent = {
          scope: normalizeScope({
            kind: 'section',
            moduleId: module.id,
            sectionId: item.id,
            label: item.title,
          }),
          label: item.title,
          children: [],
        };
        group.children.push(parent);
      } else if (item.type === 'Page') {
        parent.children.push({
          scope: normalizeScope({
            kind: 'page',
            moduleId: module.id,
            itemId: item.id,
            label: item.title,
          }),
          label: item.title,
          children: [],
        });
      }
    }
    course.children.push(group);
  }
  return course;
}

export function findScope(choice, scope) {
  if (scopeKey(choice.scope) === scopeKey(scope)) return choice;
  for (const child of choice.children) {
    const found = findScope(child, scope);
    if (found) return found;
  }
  return null;
}

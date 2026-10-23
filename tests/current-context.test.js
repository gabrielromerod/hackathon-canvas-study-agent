import test from 'node:test';
import assert from 'node:assert/strict';
const { resolveCurrentScope } = await import('../src/canvas/current-context.js').catch((error) => {
  if (
    error.code === 'ERR_MODULE_NOT_FOUND' &&
    error.url?.endsWith('/src/canvas/current-context.js')
  )
    return {};
  throw error;
});
const origin = 'https://msjc.instructure.com';
const course = () => ({
  courseId: '101',
  modules: [
    {
      id: '1',
      title: 'Week 1',
      items: [
        { id: '10', type: 'Section', title: 'Limits' },
        {
          id: '11',
          type: 'Page',
          title: 'Left limits',
          pageSlug: 'left-limits',
          url: `${origin}/courses/101/modules/items/11`,
          content: { status: 'loaded', sourceUrl: `${origin}/courses/101/pages/left-limits` },
        },
        {
          id: '12',
          type: 'Assignment',
          title: 'MyOpenMath homework',
          url: `${origin}/courses/101/assignments/501?module_item_id=12`,
          dueDate: '2026-10-25T12:00:00Z',
          points: 8,
        },
        {
          id: '13',
          type: 'Attachment',
          title: 'Review.pdf',
          fileId: '33',
          content: {
            status: 'available',
            file: { id: '33', sourceUrl: `${origin}/courses/101/files/33` },
          },
        },
        { id: '14', type: 'Section', title: 'Derivatives' },
        {
          id: '15',
          type: 'Page',
          title: 'Derivative definition',
          pageUrl: `${origin}/api/v1/courses/101/pages/derivative-definition`,
          content: { status: 'not_loaded' },
        },
        {
          id: '16',
          type: 'External Tool',
          title: 'Embedded practice',
          url: `${origin}/courses/101/modules/items/16`,
        },
      ],
    },
    {
      id: '2',
      title: 'Week 2',
      items: [
        {
          id: '21',
          type: 'Page',
          title: 'Unicode lecture',
          pageSlug: 'café notes',
          content: { status: 'loaded' },
        },
      ],
    },
  ],
});
const context = (path) => ({
  courseId: '101',
  tabId: 7,
  title: 'Canvas course',
  url: `${origin}${path}`,
});
function resolve(snapshot, current) {
  assert.equal(
    typeof resolveCurrentScope,
    'function',
    'Current-tab scope resolver must be implemented',
  );
  return resolveCurrentScope(snapshot, current);
}

test('current Page URLs resolve an exact page scope and source metadata', () => {
  const result = resolve(
    course(),
    context('/courses/101/pages/left-limits?module_item_id=11#heading'),
  );
  assert.equal(result.available, true);
  assert.deepEqual(result.scope, {
    kind: 'page',
    moduleId: '1',
    itemId: '11',
    label: 'Left limits',
  });
  assert.equal(result.currentSource.title, 'Left limits');
  assert.equal(result.currentSource.type, 'Page');
  assert.equal(result.currentSource.itemId, '11');
  assert.equal(result.currentSource.moduleId, '1');
  assert.equal(result.currentSource.url, `${origin}/courses/101/pages/left-limits`);
  assert.equal(result.reason, '');
});

test('known page URLs and page slugs normalize API prefixes, Unicode, queries and trailing slashes', () => {
  const snapshot = course();
  for (const path of [
    '/courses/101/pages/derivative-definition/',
    '/courses/101/pages/caf%C3%A9%20notes?x=1',
  ]) {
    const result = resolve(snapshot, context(path));
    assert.equal(result.available, true);
    assert.equal(result.scope.kind, 'page');
  }
  assert.match(
    resolve(snapshot, context('/courses/101/pages/derivative-definition')).reason,
    /not.*(?:read|loaded)|unavailable/i,
  );
});

test('Pages can match a content source URL or item URL when the slug was not cached', () => {
  for (const field of ['url', 'pageUrl']) {
    const snapshot = course();
    snapshot.modules[0].items[1] = {
      id: '11',
      type: 'Page',
      title: 'URL-only page',
      [field]: `${origin}/courses/101/pages/url-only`,
    };
    assert.equal(resolve(snapshot, context('/courses/101/pages/url-only')).scope.itemId, '11');
  }
  const snapshot = course();
  delete snapshot.modules[0].items[1].pageSlug;
  assert.equal(resolve(snapshot, context('/courses/101/pages/left-limits')).scope.itemId, '11');
});

test('module-item redirects identify the same cached item and preserve its section membership', () => {
  for (const path of [
    '/courses/101/modules/items/15?x=1',
    '/courses/101/modules/1/items/15',
    '/courses/101/modules?module_item_id=15',
  ]) {
    const result = resolve(course(), context(path));
    assert.equal(result.available, true);
    assert.equal(result.scope.kind, 'page');
    assert.equal(result.scope.itemId, '15');
    assert.equal(result.currentSource.sectionId, '14');
  }
});

test('a placement query picks the visible module when a Page is linked more than once', () => {
  const snapshot = course();
  snapshot.modules[1].items.push({ ...snapshot.modules[0].items[1], id: '22' });
  const result = resolve(snapshot, context('/courses/101/pages/left-limits?module_item_id=22'));
  assert.equal(result.scope.moduleId, '2');
  assert.equal(result.scope.itemId, '22');
});

test('assignments and embedded external tools stay item-scoped with explicit body limitations', () => {
  for (const [path, itemId] of [
    ['/courses/101/assignments/501', '12'],
    ['/courses/101/modules/items/16', '16'],
  ]) {
    const result = resolve(course(), context(path));
    assert.equal(result.available, true);
    assert.equal(result.scope.kind, 'item');
    assert.equal(result.scope.itemId, itemId);
    assert.match(result.reason, /metadata|body|content.*(?:unavailable|not.*read)/i);
    assert.equal(new URL(result.currentSource.url).origin, origin);
  }
  const assignment = resolve(course(), context('/courses/101/assignments/501'));
  assert.equal(assignment.currentSource.title, 'MyOpenMath homework');
});

test('assignment IDs can use known content metadata without guessing from tab titles', () => {
  const snapshot = course();
  snapshot.modules[0].items[2] = {
    id: '12',
    type: 'Assignment',
    title: 'MyOpenMath homework',
    contentId: '501',
    url: `${origin}/courses/101/modules/items/12`,
  };
  assert.equal(resolve(snapshot, context('/courses/101/assignments/501')).scope.itemId, '12');
  const unknown = resolve(snapshot, {
    ...context('/courses/101/assignments/999'),
    title: 'MyOpenMath homework',
  });
  assert.equal(unknown.available, false);
  assert.equal(unknown.scope, null);
});

test('Canvas Files routes match file IDs while remaining metadata-only', () => {
  for (const suffix of ['', '/preview', '/download?download_frd=1']) {
    const result = resolve(course(), context(`/courses/101/files/33${suffix}`));
    assert.equal(result.available, true);
    assert.equal(result.scope.kind, 'item');
    assert.equal(result.scope.itemId, '13');
    assert.equal(result.currentSource.url, `${origin}/courses/101/files/33`);
    assert.match(result.reason, /metadata|body|content.*(?:unavailable|not.*read)/i);
  }
});

test('explicit module and section links resolve their own bounds without widening to the course', () => {
  for (const path of [
    '/courses/101/modules/1',
    '/courses/101/modules#context_module_1',
    '/courses/101/modules?module_id=1',
  ]) {
    const result = resolve(course(), context(path));
    assert.equal(result.available, true);
    assert.equal(result.scope.kind, 'module');
    assert.equal(result.scope.moduleId, '1');
  }
  const section = resolve(course(), context('/courses/101/modules/items/14'));
  assert.equal(section.scope.kind, 'section');
  assert.equal(section.scope.sectionId, '14');
});

test('missing or unidentifiable current sources are unavailable instead of selecting the entire course', () => {
  for (const path of [
    '/courses/101',
    '/courses/101/modules',
    '/courses/101/pages/missing',
    '/courses/101/modules/items/999',
    '/courses/101/modules/999',
  ]) {
    const result = resolve(course(), context(path));
    assert.equal(result.available, false);
    assert.equal(result.scope, null);
    assert.equal(result.currentSource, null);
    assert.ok(result.reason);
  }
});

test('rejects other courses, host lookalikes, invalid URLs and closed tab contexts', () => {
  for (const current of [
    { ...context('/courses/102/pages/left-limits'), courseId: '102' },
    context('/courses/102/pages/left-limits'),
    context('/courses/1010/pages/left-limits'),
    {
      ...context('/courses/101/pages/left-limits'),
      url: 'https://msjc.instructure.com.evil.test/courses/101/pages/left-limits',
    },
    {
      ...context('/courses/101/pages/left-limits'),
      url: 'http://msjc.instructure.com/courses/101/pages/left-limits',
    },
    { ...context('/courses/101/pages/left-limits'), url: 'not a URL' },
    { ...context('/courses/101/pages/left-limits'), tabId: null },
    { courseId: null, tabId: 7, url: null },
  ]) {
    const result = resolve(course(), current);
    assert.equal(result.available, false);
    assert.equal(result.scope, null);
    assert.equal(result.currentSource, null);
  }
});

test('external MyOpenMath tabs are unsupported and never read external bodies or match by title', () => {
  const result = resolve(course(), {
    ...context('/courses/101/assignments/501'),
    url: 'https://www.myopenmath.com/assess2/?cid=1',
    title: 'MyOpenMath homework',
  });
  assert.equal(result.available, false);
  assert.equal(result.scope, null);
  assert.match(result.reason, /external|Canvas|outside/i);
});

test('each resolution uses the latest context rather than retaining a frozen current source', () => {
  const snapshot = course();
  const first = resolve(snapshot, context('/courses/101/pages/left-limits'));
  const next = resolve(snapshot, context('/courses/101/pages/derivative-definition'));
  const left = resolve(snapshot, { courseId: null, tabId: null, url: null });
  assert.equal(first.scope.itemId, '11');
  assert.equal(next.scope.itemId, '15');
  assert.equal(left.scope, null);
});

test('fresh moduleItemId hints resolve older cached assignments after Canvas sequence lookup', () => {
  const snapshot = course();
  snapshot.modules[0].items[2].url = `${origin}/courses/101/modules/items/12`;
  const result = resolve(snapshot, {
    ...context('/courses/101/assignments/501'),
    moduleItemId: '12',
  });
  assert.equal(result.scope.kind, 'item');
  assert.equal(result.scope.itemId, '12');
  assert.equal(result.currentSource.title, 'MyOpenMath homework');
  assert.equal(result.currentSource.url, `${origin}/courses/101/modules/items/12`);
  const foreign = resolve(snapshot, {
    ...context('/courses/102/assignments/501'),
    moduleItemId: '12',
  });
  assert.equal(foreign.available, false);
  const stale = resolve(snapshot, {
    ...context('/courses/101/assignments/501'),
    moduleItemId: '999',
  });
  assert.equal(stale.available, false);
});

test('encoded course delimiters cannot masquerade as the current course route', () => {
  for (const path of ['/courses/101%2Fpages/left-limits', '/courses/%31%30%31/pages/left-limits']) {
    const result = resolve(course(), context(path));
    assert.equal(result.available, false);
    assert.equal(result.scope, null);
  }
});

test('resolution leaves frozen cached sources and the fresh context unchanged', () => {
  const snapshot = course(),
    current = context('/courses/101/pages/left-limits');
  const before = structuredClone({ snapshot, current });
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(snapshot);
  freeze(current);
  assert.equal(resolve(snapshot, current).scope.itemId, '11');
  assert.deepEqual({ snapshot, current }, before);
});

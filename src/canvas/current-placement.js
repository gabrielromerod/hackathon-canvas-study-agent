// Serialized into the connected Canvas tab. Keep all helpers inside the function.
export async function fetchCurrentPlacement({ courseId, url }) {
  const origin = 'https://msjc.instructure.com';
  courseId = String(courseId);
  let expected;
  try {
    expected = new URL(url).href;
  } catch {
    throw new Error('The current Canvas tab URL is invalid.');
  }
  const assertCurrent = () => {
    const actual = new URL(location.href);
    const actualCourse = actual.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];
    if (
      !/^\d+$/.test(courseId) ||
      actual.origin !== origin ||
      actual.username ||
      actual.password ||
      actualCourse !== courseId ||
      actual.href !== expected
    ) {
      throw new Error(
        'The Canvas tab or course changed before its current module placement could be read.',
      );
    }
    return actual;
  };
  const numericId = (value) =>
    (typeof value === 'string' && /^\d+$/.test(value)) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  const actual = assertCurrent();
  const queryId = actual.searchParams.get('module_item_id');
  if (queryId !== null) return { moduleItemId: numericId(queryId) ? String(queryId) : null };
  const routeItem = actual.pathname.match(/^\/courses\/\d+\/modules\/items\/(\d+)\/?$/)?.[1];
  if (routeItem) return { moduleItemId: routeItem };
  const asset = actual.pathname.match(
    /^\/courses\/\d+\/(assignments|quizzes|discussion_topics|external_tools)\/(\d+)\/?$/,
  );
  if (!asset) return { moduleItemId: null };
  const types = {
    assignments: 'Assignment',
    quizzes: 'Quiz',
    discussion_topics: 'Discussion',
    external_tools: 'ExternalTool',
  };
  const endpoint = `${origin}/api/v1/courses/${courseId}/module_item_sequence?asset_type=${types[asset[1]]}&asset_id=${asset[2]}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    credentials: 'same-origin',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  assertCurrent();
  if (!response.ok) throw new Error(`Canvas placement lookup returned HTTP ${response.status}.`);
  if (!response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Canvas did not return JSON placement data. Please sign in again.');
  const data = await response.json();
  assertCurrent();
  const candidates = Array.isArray(data?.items)
    ? data.items.map((item) => item?.current?.id).filter(numericId)
    : [];
  return { moduleItemId: candidates.length === 1 ? String(candidates[0]) : null };
}

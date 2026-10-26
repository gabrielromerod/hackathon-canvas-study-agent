const origin = 'https://msjc.instructure.com/courses/900001';
const page = (id, slug, title, markdown) => ({
  id,
  type: 'Page',
  title,
  pageSlug: slug,
  url: `${origin}/pages/${slug}`,
  content: { status: 'loaded', format: 'markdown', markdown, sourceUrl: `${origin}/pages/${slug}` },
});
export function demoSnapshot() {
  return {
    schemaVersion: 2,
    courseId: '900001',
    courseTitle: 'Calculus I · Demo course',
    sourceUrl: `${origin}/modules`,
    extractedAt: '2026-10-26T16:00:00Z',
    warnings: [],
    itemCount: 4,
    modules: [
      {
        id: '101',
        title: 'Week 1 · Functions & graphs',
        week: 1,
        items: [
          page(
            '1001',
            'rational-functions',
            'Understanding rational functions',
            '# Understanding rational functions\n\nA rational function is a ratio of two polynomials: f(x) = P(x) / Q(x), where Q(x) is not zero.\n\n## Start with an example\n\nf(x) = (x + 1) / (x - 2). At x = 3, the output is 4. At x = 2, the denominator is zero, so the function is undefined. Its domain excludes 2.\n\n## Check your understanding\n\nFor g(x) = 5 / (x - 3), identify the excluded input and evaluate g(4).\n\n## Read further\n\n[OpenStax · Basic classes of functions](https://openstax.org/books/calculus-volume-1/pages/1-2-basic-classes-of-functions)\n\nThis is original synthetic course content created for the public product demonstration.',
          ),
          page(
            '1002',
            'study-checklist',
            'Week 1 study checklist',
            '# Week 1 study checklist\n\n1. Read Understanding rational functions.\n2. Find the input values that make a denominator zero.\n3. Evaluate two rational functions at valid inputs.\n4. Explain your answer in your own words.\n\nThis synthetic practice activity has no grades or deadlines.',
          ),
        ],
      },
      {
        id: '102',
        title: 'Week 2 · Limits & continuity',
        week: 2,
        items: [
          page(
            '2001',
            'introduction-to-limits',
            'A first look at limits',
            '# A first look at limits\n\nA limit describes the value a function approaches as its input gets close to a particular number.\n\n## Example\n\nFor f(x) = x + 2, as x approaches 3, f(x) approaches 5. We can evaluate nearby inputs such as 2.9 and 3.1 to see the trend.\n\n## A useful distinction\n\nThe value a function approaches does not always equal its value at that input. Compare values from the left and right before deciding whether a two-sided limit exists.\n\nThis is original synthetic course content created for the public product demonstration.',
          ),
          page(
            '2002',
            'review-notes',
            'Connecting functions and limits',
            '# Connecting functions and limits\n\nReview the domain of a rational function before evaluating a limit. An excluded input does not by itself tell you whether the limit exists.\n\n## Study prompt\n\nExplain the difference between evaluating a function and describing what its values approach.\n\nOriginal synthetic example; no private course material.',
          ),
        ],
      },
    ],
  };
}
export function cachedDemoModel(bridge) {
  return {
    async rpc(method, payload = {}, id) {
      if (method === 'remove')
        throw new Error('Removing downloaded models is disabled in the portfolio demo.');
      return bridge.rpc(
        method,
        method === 'setup' ? { ...payload, cachedOnly: true } : payload,
        id,
      );
    },
  };
}

// Development-only layout demo. Uses synthetic data and explicitly mocked replies; no model runs.
import { initializePanel } from '../../src/panel/app.js';
import { openRepository } from '../../src/storage/repository.js';
import { createBackgroundHub } from '../../src/background/hub.js';
const saved = await fetch('/course.json').then((response) => response.json());
const courseId = saved.course.id;
const snapshot = {
  schemaVersion: 2,
  courseId,
  courseTitle: saved.course.title,
  sourceUrl: saved.course.modulesUrl,
  extractedAt: saved.extractedAt,
  warnings: saved.warnings,
  itemCount: saved.summary.lessonCount + saved.summary.sectionCount,
  modules: saved.course.modules.map((module) => ({
    id: module.id,
    title: module.title,
    week: module.week,
    items: [
      ...module.lessons,
      ...module.sections.map((section) => ({ ...section, type: 'Section' })),
    ].sort((a, b) => a.position - b.position),
  })),
};
const event = () => ({ addListener() {} });
const api = {
  windows: { getCurrent: async () => ({ id: 1 }) },
  sidePanel: {
    close: async () => {
      document.querySelector('#connection-status').textContent =
        'Use the browser to close this local preview.';
    },
  },
  runtime: { onConnect: event() },
  tabs: {
    query: async () => [
      { id: 7, windowId: 1, url: `https://msjc.instructure.com/courses/${courseId}/pages/lecture` },
    ],
    onActivated: event(),
    onUpdated: event(),
    onRemoved: event(),
  },
};
const repository = await openRepository(
  `canvas-study-agent-layout-demo-${location.search}-${crypto.randomUUID()}`,
);
const generation = await repository.beginImport(courseId);
await repository.saveSnapshot(courseId, generation, snapshot);
const mode = new URLSearchParams(location.search).get('mode') || 'empty';
if (mode === 'assistant') {
  const { activeThreadId: threadId } = await repository.getChatState(courseId);
  const { token } = await repository.beginTurn(courseId, {
    threadId,
    turnId: 'demo-turn',
    userMessageId: 'demo-user',
    assistantMessageId: 'demo-assistant',
    text: 'Explain the example with a wide table, long code, and course citations.',
    modelId: 'layout-demo-no-model',
    sourceRefs: [
      {
        id: 'S1',
        courseId,
        moduleId: '1',
        itemId: '11',
        title: 'Example course source for layout testing',
        url: `https://msjc.instructure.com/courses/${courseId}/modules/items/11`,
      },
    ],
    memoryRefs: [
      {
        id: 'M1',
        courseId,
        threadId,
        messageIds: ['demo-user'],
        title: 'Example earlier discussion',
      },
    ],
  });
  const longLine = 'veryLongFunctionArgument_'.repeat(18);
  await repository.finishTurn(courseId, {
    threadId,
    ...token,
    sequence: 1,
    status: 'complete',
    text:
      '**LAYOUT DEMO — mock assistant text. No model inference.**\n\n## Functions and graphs\n\nA function maps each input to one output. This is synthetic layout content with a valid course citation [S1] and a prior-chat reference [M1].\n\n```javascript\nconst sample = processExample(' +
      longLine +
      ');\nconsole.log(sample);\n```\n\n| Example function with a long descriptive heading | Domain | Range | Observation for layout testing |\n| --- | --- | --- | --- |\n| Polynomial x² + 1 | All real numbers | [1, infinity) | A long table cell should stay inside the assistant response without widening the sidebar. |\n| Rational 1/x | All nonzero real numbers | All nonzero real numbers | ' +
      'long_unbroken_table_value_'.repeat(9) +
      ' |\n\n### Check your understanding\n\nCompare the example with the original source [S1]. The composer stays available while this response scrolls. These examples test layout only.',
  });
}
const model = {
  rpc: async (method) => {
    if (method === 'status')
      return { phase: 'idle', cached: false, modelId: 'layout-demo-no-model' };
    if (method === 'panels' || method === 'cancel' || method === 'unload') return true;
    throw new Error('Layout demo only: model inference and downloads are disabled.');
  },
};
const hub = createBackgroundHub(api, Promise.resolve(repository), { model });
let app;
const session = hub.createSession((message) => app?.receive(message.event, message.data));
const source = {
  discover: async () => structuredClone(snapshot),
  readPage: async () => {
    throw new Error('Preview uses saved Markdown.');
  },
  readFile: async () => {
    throw new Error('Preview uses saved file metadata.');
  },
};
app = await initializePanel(api, document, {
  source,
  transport: {
    rpc: (method, payload) => hub.request(session, method, payload),
    close: () => hub.disconnect(session),
  },
});

function reportLayout() {
  const footer = document.querySelector('.composer-footer').getBoundingClientRect();
  parent.postMessage(
    {
      type: 'study-agent-layout',
      mode,
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.getBoundingClientRect().width,
      footerBottom: Math.round(footer.bottom),
    },
    location.origin,
  );
}
window.addEventListener('resize', reportLayout);
requestAnimationFrame(reportLayout);

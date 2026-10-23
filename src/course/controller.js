import { loadPageContents, pageContentSummary } from './content-loader.js';
import { loadFileMetadata, fileAccessSummary } from './file-loader.js';
import { serializeCourseExport } from './export.js';

const needsRead = (snapshot) =>
  !snapshot ||
  pageContentSummary(snapshot).pending +
    pageContentSummary(snapshot).failed +
    fileAccessSummary(snapshot).pending +
    fileAccessSummary(snapshot).failed >
    0;
export function createReaderController({ rpc, source, convert, onChange = () => {} }) {
  const state = {
    context: null,
    courseId: null,
    snapshot: null,
    chat: null,
    selection: null,
    connected: false,
    busy: false,
    phase: 'idle',
    error: '',
    updatedAt: null,
  };
  let revision = 0;
  let job = null;
  let disposed = false;
  const emit = () => {
    if (!disposed) onChange(state);
  };
  function cancel() {
    if (job) job.cancelled = true;
    job = null;
    state.busy = false;
  }
  const controller = {
    state,
    async connect(context) {
      if (disposed) return;
      const same =
        context.courseId &&
        context.courseId === state.courseId &&
        context.tabId === state.context?.tabId;
      state.context = context;
      state.connected = Boolean(context.courseId);
      if (same) {
        emit();
        return;
      }
      const token = ++revision;
      cancel();
      state.error = '';
      if (!context.courseId && state.courseId) {
        state.phase = 'disconnected';
        emit();
        return;
      }
      const courseId = context.courseId || (await rpc('getLastCourse', {}));
      if (token !== revision || disposed) return;
      if (!courseId) {
        state.phase = 'idle';
        emit();
        return;
      }
      state.courseId = courseId;
      state.snapshot = null;
      state.chat = null;
      state.selection = null;
      state.phase = 'connecting';
      emit();
      try {
        const [record, chat] = await Promise.all([
          rpc('getCourse', { courseId }),
          rpc('getChatState', { courseId }),
        ]);
        if (token !== revision || disposed) return;
        state.snapshot = record.snapshot;
        state.updatedAt = record.updatedAt;
        state.selection = record.selection;
        state.chat = chat;
        state.phase = state.connected ? 'ready' : 'disconnected';
        emit();
        if (state.connected && needsRead(state.snapshot)) void controller.read().catch(() => {});
      } catch (error) {
        if (token === revision) {
          state.error = error.message;
          state.phase = 'error';
          emit();
        }
      }
    },
    read({ refresh = false } = {}) {
      if (job) return job.promise;
      if (!state.connected || disposed)
        return Promise.reject(new Error('Open this course in Canvas to read its content.'));
      const task = {
        cancelled: false,
        token: revision,
        courseId: state.courseId,
        context: { ...state.context },
      };
      const current = () =>
        !disposed && !task.cancelled && task.token === revision && state.connected;
      job = task;
      state.busy = true;
      state.phase = 'reading';
      state.error = '';
      emit();
      task.promise = (async () => {
        let claim;
        try {
          claim = await rpc('claimImport', { courseId: task.courseId });
          if (!current()) return;
          if (!claim.acquired) {
            state.phase = 'another-window';
            return;
          }
          let snapshot = state.snapshot;
          if (!snapshot || refresh) {
            state.phase = 'discovering';
            emit();
            snapshot = await source.discover(task.context);
            if (!current()) return;
          }
          snapshot = structuredClone(snapshot);
          state.snapshot = snapshot;
          state.phase = 'reading';
          emit();
          const save = async () => {
            if (!current()) return;
            const accepted = await rpc('saveSnapshot', {
              courseId: task.courseId,
              generation: claim.generation,
              snapshot,
            });
            if (!accepted) {
              task.cancelled = true;
              throw new Error('Course reading was superseded. Please retry.');
            }
            if (current()) {
              state.updatedAt = new Date().toISOString();
              emit();
            }
          };
          await save();
          await loadPageContents(
            snapshot,
            (request) => source.readPage(task.context, request),
            convert,
            emit,
            { shouldContinue: current, onItem: save },
          );
          if (!current()) return;
          await loadFileMetadata(
            snapshot,
            (request) => source.readFile(task.context, request),
            emit,
            { shouldContinue: current, onItem: save },
          );
          if (current()) {
            await save();
            state.phase = 'ready';
          }
        } catch (error) {
          if (current()) {
            state.error = error.message;
            state.phase = 'error';
          }
          throw error;
        } finally {
          if (claim?.acquired)
            await rpc('releaseImport', {
              courseId: task.courseId,
              generation: claim.generation,
            }).catch(() => {});
          if (job === task) {
            job = null;
            state.busy = state.phase === 'another-window';
            emit();
          }
        }
      })();
      return task.promise;
    },
    async whenIdle() {
      while (job) await job.promise;
    },
    async exportCourse() {
      const token = revision;
      if (state.phase === 'another-window')
        throw new Error(
          'Course reading is still running in another window. Please wait before exporting.',
        );
      if (job) await job.promise;
      if (state.phase === 'another-window')
        throw new Error(
          'Course reading is still running in another window. Please wait before exporting.',
        );
      if (token !== revision || disposed)
        throw new Error('Course changed or reader closed. Export cancelled.');
      if (state.connected && needsRead(state.snapshot) && state.phase !== 'another-window')
        await controller.read();
      if (token !== revision || disposed)
        throw new Error('Course changed or reader closed. Export cancelled.');
      if (!state.snapshot) throw new Error('No course content is available to export yet.');
      return serializeCourseExport(state.snapshot);
    },
    receive(event, data) {
      if (data?.courseId !== state.courseId || disposed) return;
      if (event === 'chat') {
        state.chat = data.chat;
        emit();
      }
      if (event === 'course' && !job) {
        state.snapshot = data.record.snapshot;
        state.updatedAt = data.record.updatedAt;
        emit();
      }
      if (event === 'importStarted' && !job) {
        state.busy = true;
        state.phase = 'another-window';
        emit();
      }
      if (event === 'importReleased' && !job) {
        state.busy = false;
        state.phase = state.connected ? 'ready' : 'disconnected';
        emit();
      }
    },
    dispose() {
      disposed = true;
      revision++;
      cancel();
    },
  };
  return controller;
}

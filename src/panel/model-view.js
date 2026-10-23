export function createModelView(root, rpc, onState, report) {
  let state = { phase: 'idle', cached: false },
    disposed = false;
  const render = () => {
    if (disposed) return;
    const busy = ['downloading', 'loading', 'generating'].includes(state.phase);
    root.querySelector('#model-toggle').textContent =
      `Local AI · ${state.phase === 'ready' ? 'Ready' : state.phase === 'idle' ? 'Set up' : state.phase}`;
    root.querySelector('#model-status').textContent =
      state.phase === 'downloading'
        ? `Downloading ${((state.bytes || 0) / 1e9).toFixed(2)} / ${((state.total || 2008432640) / 1e9).toFixed(2)} GB`
        : state.phase === 'ready'
          ? 'Ready · running on this device'
          : state.phase === 'loading'
            ? 'Loading cached model into GPU memory…'
            : state.phase === 'generating'
              ? 'Testing / generating locally…'
              : state.cached
                ? 'Model downloaded. Load it to start chatting.'
                : 'Download the model to enable local replies.';
    const resources = state.resources;
    root.querySelector('#model-resources').textContent = resources
      ? `${resources.reason}${resources.memoryGiB ? ` Approximate device RAM: ${resources.memoryGiB} GiB.` : ''}${resources.storageAvailable != null ? ` Browser storage available: ${(resources.storageAvailable / 1e9).toFixed(1)} GB.` : ''}`
      : '';
    const setup = root.querySelector('#model-setup');
    setup.textContent = state.cached ? 'Load & test cached E2B' : 'Download & test E2B';
    setup.disabled = busy || state.phase === 'ready' || resources?.compatible === false;
    root.querySelector('#model-cancel').hidden = !busy;
    root.querySelector('#model-unload').disabled =
      busy || !(state.resident || state.phase === 'ready');
    root.querySelector('#model-remove').disabled = busy || !state.cached;
    const progress = root.querySelector('#model-progress');
    progress.hidden = state.phase !== 'downloading';
    progress.value = (state.bytes || 0) / (state.total || 1);
    const error = root.querySelector('#model-error');
    error.textContent = state.error || '';
    error.hidden = !state.error;
    const sample = root.querySelector('#model-sample');
    sample.textContent = state.readinessReply || '';
    sample.hidden = !state.readinessReply;
    root.querySelector('#model-benchmark').textContent = state.benchmark
      ? `Last response: first text ${(state.benchmark.firstTokenMs / 1000).toFixed(1)}s · total ${(state.benchmark.durationMs / 1000).toFixed(1)}s. Model weight requests this runtime: ${state.weightDownloadRequests || 0}.`
      : '';
    onState(state);
  };
  for (const [id, method] of [
    ['model-setup', 'setup'],
    ['model-cancel', 'cancel'],
    ['model-unload', 'unload'],
    ['model-remove', 'remove'],
  ])
    root.querySelector(`#${id}`).addEventListener('click', async () => {
      try {
        if (method === 'setup') {
          state = { ...state, phase: 'loading', error: '' };
          render();
        }
        await rpc(`ai:${method}`, {});
      } catch (error) {
        state = { ...state, phase: 'error', error: error.message };
        render();
        report(error);
      }
    });
  return {
    receive(value) {
      state = { ...state, ...value };
      render();
    },
    async connect() {
      try {
        state = await rpc('ai:status', {});
        render();
        if (
          !disposed &&
          state.cached &&
          state.phase === 'idle' &&
          state.resources?.compatible !== false
        ) {
          state = { ...state, phase: 'loading' };
          render();
          try {
            await rpc('ai:setup', { cachedOnly: true });
          } catch (error) {
            if (!/busy/i.test(error.message)) throw error;
          }
          state = await rpc('ai:status', {});
          render();
        }
      } catch (error) {
        state = { ...state, error: error.message };
        render();
      }
    },
    dispose() {
      disposed = true;
    },
    get state() {
      return state;
    },
  };
}

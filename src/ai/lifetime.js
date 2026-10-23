// Timers live in the offscreen document; the service worker can sleep meanwhile.
export function createModelLifetime({
  unload,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
}) {
  let panels = 0,
    phase = 'idle',
    resident = false,
    timer = null;
  return {
    update(patch) {
      panels = patch.panels ?? panels;
      phase = patch.phase ?? phase;
      resident = patch.resident ?? (phase === 'ready' ? true : resident);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!panels && resident && !['downloading', 'loading', 'generating'].includes(phase))
        timer = setTimeout(async () => {
          timer = null;
          if (!panels && resident && !['downloading', 'loading', 'generating'].includes(phase))
            await unload();
        }, 300000);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

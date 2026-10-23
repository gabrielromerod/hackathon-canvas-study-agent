const LOCAL_OPTIONS = { langs: ['en-US'], processLocally: true };
const UNSUPPORTED =
  'On-device English dictation is not supported in this browser. You can keep typing.';

function recognitionError(value) {
  const code = value?.error ?? value?.name ?? value;
  if (['not-allowed', 'service-not-allowed', 'NotAllowedError', 'SecurityError'].includes(code)) {
    return 'Microphone permission was denied. Allow microphone access to use local dictation.';
  }
  if (code === 'audio-capture') return 'No microphone is available for local dictation.';
  if (code === 'no-speech') return 'No speech was detected. Try local dictation again.';
  if (code === 'language-not-supported')
    return 'Install the on-device English speech pack to use dictation.';
  return 'Local dictation could not start or continue. You can keep typing; no online recognition was used.';
}

function unavailableMessage(availability) {
  if (availability === 'downloadable')
    return 'Install the on-device English speech pack to use dictation.';
  if (availability === 'downloading')
    return 'The on-device English speech pack is downloading. Try again when it is ready.';
  return 'On-device English speech recognition is unavailable. You can keep typing.';
}

export function createDictation({
  SpeechRecognition = globalThis.SpeechRecognition,
  getDraft = () => '',
  onDraft = () => {},
  onStatus = () => {},
} = {}) {
  const supported =
    typeof SpeechRecognition === 'function' && typeof SpeechRecognition.available === 'function';
  const state = {
    available: supported ? 'unknown' : 'unsupported',
    listening: false,
    starting: false,
    installing: false,
    error: '',
  };
  let recognition = null;
  let revision = 0;
  let disposed = false;

  function update(values) {
    if (disposed) return;
    Object.assign(state, values);
    onStatus({ ...state });
  }

  function release(action) {
    const previous = recognition;
    recognition = null;
    if (!previous) return;
    previous.onstart = previous.onresult = previous.onerror = previous.onend = null;
    const stop = previous[action] ?? (action ? previous.abort : null);
    try {
      stop?.call(previous);
    } catch {
      /* Recognition may already have stopped. */
    }
  }

  function fail(error, token) {
    if (disposed || token !== revision) return false;
    revision++;
    release('abort');
    update({ listening: false, starting: false, installing: false, error });
    return false;
  }

  function stop() {
    if (disposed) return;
    revision++;
    release('stop');
    update({ listening: false, starting: false, installing: false });
  }

  return {
    get state() {
      return { ...state };
    },

    async check() {
      if (disposed || state.starting || state.listening || state.installing) return false;
      const token = ++revision;
      update({ starting: true, error: '' });
      if (!supported) return fail(UNSUPPORTED, token);
      try {
        const available = await SpeechRecognition.available({ ...LOCAL_OPTIONS, langs: ['en-US'] });
        if (disposed || token !== revision) return false;
        update({
          available,
          starting: false,
          listening: false,
          error: available === 'available' ? '' : unavailableMessage(available),
        });
        return available === 'available';
      } catch (error) {
        return fail(recognitionError(error), token);
      }
    },

    async start() {
      if (disposed || state.starting || state.listening || state.installing) return false;
      const token = ++revision;
      update({ starting: true, error: '' });
      if (!supported) return fail(UNSUPPORTED, token);
      try {
        const availability = await SpeechRecognition.available({
          ...LOCAL_OPTIONS,
          langs: ['en-US'],
        });
        if (disposed || token !== revision) return false;
        update({ available: availability });
        if (disposed || token !== revision) return false;
        if (availability !== 'available') return fail(unavailableMessage(availability), token);
        const current = new SpeechRecognition();
        recognition = current;
        if (!('processLocally' in current)) return fail(UNSUPPORTED, token);
        current.processLocally = true;
        if (current.processLocally !== true) return fail(UNSUPPORTED, token);
        current.lang = 'en-US';
        current.continuous = true;
        current.interimResults = false;
        const finalResults = new Set();
        const active = () => !disposed && token === revision && recognition === current;
        current.onstart = () => {
          if (active()) update({ starting: false, listening: true, error: '' });
        };
        current.onresult = (event) => {
          if (!active()) return;
          const transcripts = [];
          for (let index = event.resultIndex ?? 0; index < event.results.length; index++) {
            const result = event.results[index];
            if (!result.isFinal || finalResults.has(index)) continue;
            finalResults.add(index);
            const text = String(result[0]?.transcript ?? '').trim();
            if (text) transcripts.push(text);
          }
          if (!transcripts.length) return;
          const transcript = transcripts.join(' ');
          const draft = String(getDraft() ?? '');
          const separator = !draft || /\s$/.test(draft) || /^[,.;:!?)]/.test(transcript) ? '' : ' ';
          onDraft(draft + separator + transcript);
        };
        current.onerror = (event) => {
          if (!active()) return;
          fail(event.error === 'aborted' ? '' : recognitionError(event), token);
        };
        current.onend = () => {
          if (!active()) return;
          revision++;
          release();
          update({ listening: false, starting: false });
        };
        current.start();
        return active();
      } catch (error) {
        return fail(recognitionError(error), token);
      }
    },

    async install() {
      if (disposed || state.starting || state.listening || state.installing) return false;
      const token = ++revision;
      update({ installing: true, error: '' });
      if (!supported || typeof SpeechRecognition.install !== 'function')
        return fail(UNSUPPORTED, token);
      try {
        const installed = await SpeechRecognition.install({ langs: ['en-US'] });
        if (disposed || token !== revision) return false;
        if (!installed)
          return fail(
            'The on-device English speech pack could not be installed. Try again or keep typing.',
            token,
          );
        const availability = await SpeechRecognition.available({
          ...LOCAL_OPTIONS,
          langs: ['en-US'],
        });
        if (disposed || token !== revision) return false;
        update({
          available: availability,
          installing: false,
          error: availability === 'available' ? '' : unavailableMessage(availability),
        });
        return availability === 'available';
      } catch {
        return fail(
          'The on-device English speech pack could not be installed. Try again or keep typing.',
          token,
        );
      }
    },

    stop,

    dispose() {
      if (disposed) return;
      revision++;
      release('abort');
      update({ listening: false, starting: false, installing: false });
      disposed = true;
    },
  };
}

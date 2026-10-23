import test from 'node:test';
import assert from 'node:assert/strict';
import { createDictation } from '../src/panel/dictation.js';

function setup(availability = 'available') {
  let draft = 'Existing note. ',
    recognition,
    status;
  class Recognition {
    processLocally = false;
    static async available({ langs, processLocally }) {
      assert.deepEqual(langs, ['en-US']);
      assert.equal(processLocally, true);
      return availability;
    }
    static async install() {
      availability = 'available';
      return true;
    }
    constructor() {
      recognition = this;
    }
    start() {
      this.onstart?.();
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
  }
  const voice = createDictation({
    SpeechRecognition: Recognition,
    getDraft: () => draft,
    onDraft: (value) => {
      draft = value;
    },
    onStatus: (value) => {
      status = value;
    },
  });
  return {
    voice,
    get draft() {
      return draft;
    },
    get recognition() {
      return recognition;
    },
    get status() {
      return status;
    },
  };
}
test('dictation uses local English recognition and adds final text without replacing the draft', async () => {
  const state = setup();
  await state.voice.start();
  assert.equal(state.recognition.processLocally, true);
  assert.equal(state.recognition.lang, 'en-US');
  state.recognition.onresult({
    resultIndex: 0,
    results: [Object.assign([{ transcript: 'Please explain functions.' }], { isFinal: true })],
  });
  assert.equal(state.draft, 'Existing note. Please explain functions.');
  state.voice.stop();
  assert.equal(state.status.listening, false);
});
test('unavailable local recognition never starts online and language installation is explicit', async () => {
  const state = setup('downloadable');
  await state.voice.start();
  assert.equal(state.status.available, 'downloadable');
  assert.notEqual(state.status.listening, true);
  await state.voice.install();
  await state.voice.start();
  assert.equal(state.recognition.processLocally, true);
});
test('permission errors leave the draft intact and stop listening', async () => {
  const state = setup();
  await state.voice.start();
  state.recognition.onerror({ error: 'not-allowed' });
  assert.equal(state.draft, 'Existing note. ');
  assert.equal(state.status.listening, false);
  assert.match(state.status.error, /permission|denied|allow/i);
});
test('unsupported browsers retain typing with an explicit local recognition error', async () => {
  let state;
  const voice = createDictation({
    getDraft: () => '',
    onDraft: () => assert.fail('Typing must remain unchanged'),
    onStatus: (value) => {
      state = value;
    },
  });
  await voice.start();
  assert.match(state.error, /local|device|support/i);
  assert.equal(state.listening, false);
});

test('stop during the asynchronous availability check prevents a late microphone start', async () => {
  let resolveAvailability,
    starts = 0,
    instances = 0,
    status;
  class Recognition {
    processLocally = false;
    static available() {
      return new Promise((resolve) => {
        resolveAvailability = resolve;
      });
    }
    constructor() {
      instances++;
    }
    start() {
      starts++;
    }
  }
  const voice = createDictation({
    SpeechRecognition: Recognition,
    getDraft: () => '',
    onDraft: () => assert.fail('Stopped dictation cannot write'),
    onStatus: (value) => {
      status = value;
    },
  });
  const starting = voice.start();
  voice.stop();
  resolveAvailability('available');
  await starting;
  assert.equal(starts, 0);
  assert.equal(instances, 0);
  assert.equal(status.listening, false);
});

test('dispose cancels asynchronous startup and ignores every later start request', async () => {
  let resolveAvailability,
    instances = 0;
  class Recognition {
    processLocally = false;
    static available() {
      return new Promise((resolve) => {
        resolveAvailability = resolve;
      });
    }
    constructor() {
      instances++;
    }
    start() {
      assert.fail('Disposed dictation cannot start');
    }
  }
  const voice = createDictation({
    SpeechRecognition: Recognition,
    getDraft: () => '',
    onDraft: () => assert.fail('Disposed dictation cannot write'),
  });
  const starting = voice.start();
  voice.dispose();
  resolveAvailability('available');
  await starting;
  await voice.start();
  assert.equal(instances, 0);
});

test('local availability support and processLocally must exist before recognition can start', async () => {
  for (const variant of ['missing-availability', 'missing-local-switch']) {
    let starts = 0,
      status;
    class Recognition {
      start() {
        starts++;
      }
    }
    if (variant === 'missing-local-switch') Recognition.available = async () => 'available';
    const voice = createDictation({
      SpeechRecognition: Recognition,
      getDraft: () => '',
      onDraft: () => assert.fail('Unsupported local recognition cannot write'),
      onStatus: (value) => {
        status = value;
      },
    });
    await voice.start();
    assert.equal(starts, 0);
    assert.equal(status.listening, false);
    assert.match(status.error, /local|device|support/i);
    voice.dispose();
  }
});

test('only final transcripts append to the current editable draft, once per final result', async () => {
  let draft = 'Initial',
    recognition;
  class Recognition {
    processLocally = false;
    static async available() {
      return 'available';
    }
    constructor() {
      recognition = this;
    }
    start() {
      this.onstart?.();
    }
    abort() {}
  }
  const voice = createDictation({
    SpeechRecognition: Recognition,
    getDraft: () => draft,
    onDraft: (value) => {
      draft = value;
    },
  });
  await voice.start();
  const interim = Object.assign([{ transcript: 'unfinished' }], { isFinal: false });
  recognition.onresult({ resultIndex: 0, results: [interim] });
  assert.equal(draft, 'Initial');
  draft = 'Manually edited';
  const final = Object.assign([{ transcript: '  dictated sentence.  ' }], { isFinal: true });
  recognition.onresult({ resultIndex: 0, results: [final] });
  recognition.onresult({ resultIndex: 0, results: [final] });
  assert.equal(draft, 'Manually edited dictated sentence.');
  voice.dispose();
});

test('explicit installation requests the English pack and reports installation failure', async () => {
  let installs = 0,
    status;
  class Recognition {
    processLocally = false;
    static async available() {
      return 'downloadable';
    }
    static async install(options) {
      installs++;
      assert.deepEqual(options, { langs: ['en-US'] });
      return false;
    }
  }
  const voice = createDictation({
    SpeechRecognition: Recognition,
    getDraft: () => '',
    onDraft: () => {},
    onStatus: (value) => {
      status = value;
    },
  });
  await voice.start();
  assert.equal(installs, 0);
  await voice.install();
  assert.equal(installs, 1);
  assert.equal(status.listening, false);
  assert.match(status.error, /install|download/i);
  voice.dispose();
});

test('stopping and disposing release recognition and fence late final transcript callbacks', async () => {
  for (const action of ['stop', 'dispose']) {
    const context = setup();
    await context.voice.start();
    const recognition = context.recognition;
    const lateResult = recognition.onresult;
    let released = false;
    recognition.stop = recognition.abort = () => {
      released = true;
    };
    context.voice[action]();
    lateResult({
      resultIndex: 0,
      results: [Object.assign([{ transcript: 'Must not append' }], { isFinal: true })],
    });
    assert.equal(released, true);
    assert.equal(context.draft, 'Existing note. ');
    assert.equal(context.status.listening, false);
  }
});

test('a status listener can cancel startup before the local recognizer is constructed', async () => {
  let starts = 0,
    cancelled = false,
    voice;
  class Recognition {
    processLocally = false;
    static async available() {
      return 'available';
    }
    start() {
      starts++;
    }
    stop() {}
  }
  voice = createDictation({
    SpeechRecognition: Recognition,
    onStatus(status) {
      if (status.available === 'available' && !cancelled) {
        cancelled = true;
        voice.stop();
      }
    },
  });
  await voice.start();
  assert.equal(starts, 0);
  assert.equal(voice.state.listening, false);
  voice.dispose();
});

test('settings can check local availability without starting microphone capture', async () => {
  const state = setup('available');
  assert.equal(await state.voice.check(), true);
  assert.equal(state.recognition, undefined);
  assert.equal(state.status.available, 'available');
  assert.equal(state.status.listening, false);
});

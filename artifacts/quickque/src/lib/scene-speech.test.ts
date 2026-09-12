import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SceneSpeechError,
  createSceneSpeech,
  type SceneSpeechDependencies,
} from './scene-speech.ts';

type FakeUtterance = {
  text: string;
  voice: {
    voiceURI: string;
    name: string;
    lang: string;
    localService: boolean;
  } | null;
  rate: number;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

function browserHarness() {
  const localVoice = {
    voiceURI: 'com.apple.voice.alex',
    name: 'Alex',
    lang: 'en-US',
    localService: true,
  };
  const cloudVoice = {
    voiceURI: 'cloud.example.voice',
    name: 'Cloud',
    lang: 'en-US',
    localService: false,
  };
  const spoken: FakeUtterance[] = [];
  let cancellations = 0;
  const adapter = createSceneSpeech({
    isDesktop: () => false,
    browserSpeechSynthesis: {
      getVoices: () => [localVoice, cloudVoice],
      speak: utterance => spoken.push(utterance as FakeUtterance),
      cancel: () => {
        cancellations += 1;
      },
    },
    createBrowserUtterance: text => ({
      text,
      voice: null,
      rate: 1,
      onend: null,
      onerror: null,
    }),
  });
  return { adapter, localVoice, spoken, get cancellations() { return cancellations; } };
}

async function flushTransitions(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test('scene speech exposes only local browser system voices', async () => {
  const { adapter, localVoice } = browserHarness();
  assert.deepEqual(await adapter.listLocalVoices(), [{
    id: localVoice.voiceURI,
    name: localVoice.name,
    language: localVoice.lang,
    engine: 'system',
  }]);
});

test('delayed browser voices retain their EventTarget receiver and clean up listeners', async () => {
  let voices: ReturnType<NonNullable<SceneSpeechDependencies['browserSpeechSynthesis']>['getVoices']> = [];
  let removed = 0;
  class DelayedSynthesis extends EventTarget {
    getVoices() { return voices; }
    speak() {}
    cancel() {}
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
      super.removeEventListener(type, listener);
      removed += 1;
    }
  }
  const synthesis = new DelayedSynthesis();
  const adapter = createSceneSpeech({ isDesktop: () => false, browserSpeechSynthesis: synthesis });
  const pending = adapter.listLocalVoices();
  voices = [{ voiceURI: 'local.alex', name: 'Alex', lang: 'en-US', localService: true }];
  synthesis.dispatchEvent(new Event('voiceschanged'));
  assert.deepEqual(await pending, [{ id: 'local.alex', name: 'Alex', language: 'en-US', engine: 'system' }]);
  assert.equal(removed, 1);
  synthesis.dispatchEvent(new Event('voiceschanged'));
  assert.equal(removed, 1, 'the completed listener is detached');
});

test('scene speech rejects Turbo and missing system voices explicitly', async () => {
  const { adapter, localVoice, spoken } = browserHarness();
  const signal = new AbortController().signal;
  await assert.rejects(
    adapter.speak('Line', { engine: 'turbo', voiceId: 'any', rate: 1 }, signal),
    (error: unknown) =>
      error instanceof SceneSpeechError &&
      error.code === 'SCENE_SPEECH_TURBO_UNAVAILABLE',
  );
  await assert.rejects(
    adapter.speak('Line', { engine: 'system', voiceId: 'missing', rate: 1 }, signal),
    (error: unknown) =>
      error instanceof SceneSpeechError &&
      error.code === 'SCENE_SPEECH_VOICE_UNAVAILABLE',
  );
  await assert.rejects(
    adapter.speak(
      'Line',
      { engine: 'system', voiceId: localVoice.voiceURI, rate: 2.1 },
      signal,
    ),
    (error: unknown) =>
      error instanceof SceneSpeechError &&
      error.code === 'SCENE_SPEECH_RATE_INVALID',
  );
  assert.equal(spoken.length, 0);
});

test('cancellation rejects the old turn and its late completion cannot finish a new turn', async () => {
  const harness = browserHarness();
  const { adapter, localVoice, spoken } = harness;
  const firstAbort = new AbortController();
  const first = adapter.speak(
    'First line',
    { engine: 'system', voiceId: localVoice.voiceURI, rate: 1 },
    firstAbort.signal,
  );
  // Attach the rejection handler before aborting so this test also guards the
  // adapter's cancellation timing.
  const firstResult = first.catch(error => error);
  await flushTransitions();
  assert.equal(spoken.length, 1);

  firstAbort.abort();
  const firstError = await firstResult;
  assert.ok(firstError instanceof SceneSpeechError);
  assert.equal(firstError.code, 'SCENE_SPEECH_CANCELLED');

  const second = adapter.speak(
    'Second line',
    { engine: 'system', voiceId: localVoice.voiceURI, rate: 1 },
    new AbortController().signal,
  );
  await flushTransitions();
  assert.equal(spoken.length, 2);
  assert.equal(harness.cancellations, 1);

  // A platform callback from the cancelled utterance is deliberately stale.
  spoken[0].onend?.();
  let secondFinished = false;
  void second.then(() => {
    secondFinished = true;
  });
  await flushTransitions();
  assert.equal(secondFinished, false);

  spoken[1].onend?.();
  await second;
});

test('native request IDs are monotonic across independently-created adapters', async () => {
  const requestIds: number[] = [];
  const invoke: NonNullable<SceneSpeechDependencies['invoke']> = async <T>(
    command,
    args,
  ): Promise<T> => {
    if (command === 'scene_speech_next_request_id') {
      return (requestIds.length + 1) as T;
    }
    if (command === 'scene_speech_speak') {
      requestIds.push(args?.requestId as number);
    }
    return undefined as T;
  };
  const one = createSceneSpeech({ isDesktop: () => true, invoke });
  const two = createSceneSpeech({ isDesktop: () => true, invoke });
  await one.speak(
    'One',
    { engine: 'system', voiceId: 'com.apple.voice.one', rate: 1 },
    new AbortController().signal,
  );
  await two.speak(
    'Two',
    { engine: 'system', voiceId: 'com.apple.voice.two', rate: 1 },
    new AbortController().signal,
  );
  assert.equal(requestIds.length, 2);
  assert.ok(requestIds[1] > requestIds[0]);
});

test('native abort retains a stop barrier until the helper acknowledges termination', async () => {
  const stop = deferred<void>();
  const started = deferred<void>();
  let stopCalls = 0;
  const invoke: NonNullable<SceneSpeechDependencies['invoke']> = <T>(
    command,
  ): Promise<T> => {
    if (command === 'scene_speech_next_request_id') return Promise.resolve(1 as T);
    if (command === 'scene_speech_speak') return started.promise as Promise<T>;
    if (command === 'scene_speech_stop') {
      stopCalls += 1;
      return stop.promise as Promise<T>;
    }
    return Promise.resolve(undefined as T);
  };
  const adapter = createSceneSpeech({ isDesktop: () => true, invoke });
  const controller = new AbortController();
  const playback = adapter.speak(
    'Line',
    { engine: 'system', voiceId: 'com.apple.voice.alex', rate: 1 },
    controller.signal,
  );
  const playbackResult = playback.catch(error => error);
  await flushTransitions();

  controller.abort();
  const error = await playbackResult;
  assert.ok(error instanceof SceneSpeechError);
  let stopResolved = false;
  const stopBarrier = adapter.stop().then(() => {
    stopResolved = true;
  });
  await flushTransitions();
  assert.equal(stopCalls, 1);
  assert.equal(stopResolved, false);

  stop.resolve();
  await stopBarrier;
});

test('a native stop failure prevents later scene playback from starting', async () => {
  const started = deferred<void>();
  let starts = 0;
  const invoke: NonNullable<SceneSpeechDependencies['invoke']> = <T>(
    command,
  ): Promise<T> => {
    if (command === 'scene_speech_next_request_id') return Promise.resolve(1 as T);
    if (command === 'scene_speech_speak') {
      starts += 1;
      return started.promise as Promise<T>;
    }
    if (command === 'scene_speech_stop') {
      return Promise.reject(new Error('native kill failed')) as Promise<T>;
    }
    return Promise.resolve(undefined as T);
  };
  const adapter = createSceneSpeech({ isDesktop: () => true, invoke });
  const controller = new AbortController();
  const first = adapter.speak(
    'Line',
    { engine: 'system', voiceId: 'com.apple.voice.alex', rate: 1 },
    controller.signal,
  );
  const firstResult = first.catch(error => error);
  await flushTransitions();
  controller.abort();
  const firstError = await firstResult;
  assert.ok(firstError instanceof SceneSpeechError);
  await assert.rejects(
    adapter.stop(),
    (error: unknown) =>
      error instanceof SceneSpeechError &&
      error.code === 'SCENE_SPEECH_NATIVE_ERROR',
  );
  await assert.rejects(
    adapter.speak(
      'Later line',
      { engine: 'system', voiceId: 'com.apple.voice.alex', rate: 1 },
      new AbortController().signal,
    ),
    (error: unknown) =>
      error instanceof SceneSpeechError &&
      error.code === 'SCENE_SPEECH_NATIVE_ERROR',
  );
  assert.equal(starts, 1);
});
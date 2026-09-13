import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneSpeech, SceneSpeechError } from './scene-speech.ts';

test('browser builds expose no speech voices', async () => {
  const speech = createSceneSpeech({ isDesktop: () => false });
  assert.deepEqual(await speech.listLocalVoices(), []);
});

test('browser playback has an explicit desktop-only failure and no speech synthesis fallback', async () => {
  const speech = createSceneSpeech({ isDesktop: () => false });
  await assert.rejects(
    speech.speak('Line', { engine: 'turbo', voiceId: 'chatterbox-local:abc', rate: 1 }, new AbortController().signal),
    (error: unknown) => error instanceof SceneSpeechError && error.code === 'SCENE_SPEECH_DESKTOP_REQUIRED',
  );
});

test('legacy system requests are rejected before native playback', async () => {
  const calls: string[] = [];
  const speech = createSceneSpeech({
    isDesktop: () => true,
    invoke: async command => {
      calls.push(command);
      return command === 'scene_speech_next_request_id' ? 1 : undefined;
    },
  });
  await assert.rejects(
    speech.speak('Line', { engine: 'system', voiceId: 'com.apple.Alex', rate: 1 } as never, new AbortController().signal),
    (error: unknown) => error instanceof SceneSpeechError && error.code === 'SCENE_SPEECH_TURBO_UNAVAILABLE',
  );
  assert.deepEqual(calls, []);
});

test('native playback sends cloned voice identity and revision to Turbo', async () => {
  const requests: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const speech = createSceneSpeech({
    isDesktop: () => true,
    listen: async () => () => {},
    invoke: async (command, args) => {
      requests.push({ command, args });
      return command === 'scene_speech_next_request_id' ? 7 : undefined;
    },
  });
  await speech.speak('A local line.', {
    engine: 'turbo',
    voiceId: 'chatterbox-local:abc',
    voiceRevision: 3,
    rate: 1,
  }, new AbortController().signal);
  assert.equal(requests.at(-1)?.command, 'scene_speech_speak');
  assert.equal(requests.at(-1)?.args?.voiceId, 'chatterbox-local:abc');
  assert.equal(requests.at(-1)?.args?.voiceRevision, 3);
});

test('native progress is request-fenced and detached after cancellation', async () => {
  let progressListener: ((event: { payload: { requestId: number; charStart: number; charEnd: number } }) => void) | null = null;
  let resolveSpeak: () => void = () => {};
  const nativeSpeak = new Promise<void>(resolve => {
    resolveSpeak = resolve;
  });
  let removed = 0;
  const speech = createSceneSpeech({
    isDesktop: () => true,
    listen: async (_event, listener) => {
      progressListener = listener as typeof progressListener;
      return () => { removed += 1; };
    },
    invoke: async command => {
      if (command === 'scene_speech_next_request_id') return 9;
      if (command === 'scene_speech_speak') return nativeSpeak;
      return undefined;
    },
  });
  const controller = new AbortController();
  const progress: Array<{ charStart: number; charEnd: number }> = [];
  const playback = speech.speak(
    'First line',
    { engine: 'turbo', voiceId: 'chatterbox-local:abc', rate: 1 },
    controller.signal,
    value => progress.push(value),
  ).catch(error => error);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  progressListener?.({ payload: { requestId: 8, charStart: 0, charEnd: 5 } });
  progressListener?.({ payload: { requestId: 9, charStart: 0, charEnd: 5 } });
  assert.deepEqual(progress, [{ charStart: 0, charEnd: 5 }]);

  controller.abort();
  const error = await playback;
  assert.ok(error instanceof SceneSpeechError);
  assert.equal(error.code, 'SCENE_SPEECH_CANCELLED');
  progressListener?.({ payload: { requestId: 9, charStart: 6, charEnd: 10 } });
  assert.deepEqual(progress, [{ charStart: 0, charEnd: 5 }]);
  assert.equal(removed, 1);
  resolveSpeak();
});
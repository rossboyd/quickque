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
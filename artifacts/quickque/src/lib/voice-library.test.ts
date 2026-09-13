import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REFERENCE_SECONDS,
  MIN_REFERENCE_SECONDS,
  VoiceLibraryError,
  createVoiceLibrary,
  validateRecording,
  validateVoiceName,
} from './voice-library.ts';
import { migrateLegacyVoice, MISSING_CLONED_VOICE_PREFIX } from './actor-model.ts';

test('recording validation requires a complete 5–10 second sample', () => {
  const sample = (durationSeconds: number, complete = true) => ({
    wavData: new Uint8Array(),
    durationSeconds,
    sampleRate: 48_000,
    levelPeak: 0,
    complete,
  });
  assert.match(validateRecording(sample(2))!, /between/);
  assert.match(validateRecording(sample(MIN_REFERENCE_SECONDS, false))!, /finish/);
  assert.equal(validateRecording(sample(MAX_REFERENCE_SECONDS)), null);
});

test('voice names are bounded and trimmed', () => {
  assert.equal(validateVoiceName('  My voice  '), null);
  assert.ok(validateVoiceName('   '));
  assert.ok(validateVoiceName('x'.repeat(81)));
});

test('library captures mono PCM, tears down tracks, then calls native create with WAV bytes', async () => {
  const commands: string[] = [];
  let process: { onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null } | null = null;
  let stopped = 0;
  let closed = 0;
  const destination = { connect() {}, disconnect() {} };
  const library = createVoiceLibrary({
    isDesktop: () => true,
    invoke: async (command, args) => {
      commands.push(`${command}:${JSON.stringify(args ?? {})}`);
      if (command === 'voice_library_create') {
        return {
          id: 'a'.repeat(32), name: 'Me', revision: 1, durationSeconds: 5,
          sampleRate: 48_000, recordingSha256: 'hash', consentConfirmed: true,
          createdAt: 1, updatedAt: 1,
        };
      }
      return [];
    },
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped += 1; } }] } as unknown as MediaStream) },
    audioContextFactory: () => ({
      sampleRate: 48_000,
      destination,
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      createScriptProcessor: () => {
        const node = { onaudioprocess: null as ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null, connect() {}, disconnect() {} };
        process = node;
        return node;
      },
      createGain: () => ({ gain: { value: 0 }, connect() {}, disconnect() {} }),
      close: async () => { closed += 1; },
    }),
  });
  const session = await library.startRecording();
  assert.ok(session.stop);
  // A five-second 48 kHz chunk is valid mono PCM input.
  assert.ok(process);
  const chunk = new Float32Array(48_000 * 5);
  process!.onaudioprocess!({ inputBuffer: { getChannelData: () => chunk } });
  const result = await session.stop();
  assert.equal(result.sampleRate, 48_000);
  assert.equal(result.wavData[0], 0x52); // RIFF
  assert.equal(stopped, 1);
  assert.equal(closed, 1);
  await library.create({ name: 'Me', recording: result, consentConfirmed: true });
  assert.match(commands.at(-1)!, /voice_library_create/);
  assert.match(commands.at(-1)!, /recording/);

  const browserLibrary = createVoiceLibrary({ isDesktop: () => false });
  await assert.rejects(
    browserLibrary.list(),
    (error: unknown) =>
      error instanceof VoiceLibraryError &&
      error.code === 'VOICE_LIBRARY_DESKTOP_REQUIRED',
  );
});

test('legacy system assignments become explicit missing local references', () => {
  const migrated = migrateLegacyVoice({ engine: 'system', voiceId: 'com.apple.Alex', rate: 1 });
  assert.equal(migrated.engine, 'turbo');
  assert.equal(migrated.voiceId, `${MISSING_CLONED_VOICE_PREFIX}com.apple.Alex`);
  assert.equal(migrated.voiceRevision, 1);
});

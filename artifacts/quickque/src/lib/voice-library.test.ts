import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_REFERENCE_SECONDS,
  MIN_REFERENCE_SECONDS,
  MAX_VOICE_PROFILE_LENGTH,
  VoiceLibraryError,
  createVoiceLibrary,
  validateRecording,
  inspectVoiceWav,
  validateVoiceName,
  validateVoiceProfile,
} from './voice-library.ts';
import { migrateLegacyVoice, MISSING_CLONED_VOICE_PREFIX } from './actor-model.ts';

test('new recording validation requires a complete 12–20 second sample', () => {
  const sample = (durationSeconds: number, complete = true) => ({
    wavData: new Uint8Array(),
    durationSeconds,
    sampleRate: 48_000,
    levelPeak: .5,
    complete,
  });
  assert.match(validateRecording(sample(11.9))!, /at least/);
  assert.match(validateRecording(sample(MIN_REFERENCE_SECONDS, false))!, /finish/);
  assert.equal(validateRecording(sample(12)), null);
  assert.equal(validateRecording(sample(15)), null);
  assert.equal(validateRecording(sample(MAX_REFERENCE_SECONDS)), null);
  assert.ok(validateRecording(sample(20.1)));
});

test('voice names are bounded and trimmed', () => {
  assert.equal(validateVoiceName('  My voice  '), null);
  assert.ok(validateVoiceName('   '));
  assert.ok(validateVoiceName('x'.repeat(81)));
});

test('voice profile values are bounded after trimming', () => {
  assert.equal(validateVoiceProfile({ emotion: '  warm  ', gender: '', ageRange: 'adult' }), null);
  assert.match(validateVoiceProfile({ emotion: 'x'.repeat(MAX_VOICE_PROFILE_LENGTH + 1) })!, /40 characters/);
});

test('legacy native metadata without profile fields remains readable', async () => {
  const library = createVoiceLibrary({
    isDesktop: () => true,
    invoke: async () => [{
      id: 'a'.repeat(32), name: 'Legacy', revision: 1, durationSeconds: 6,
      sampleRate: 48_000, recordingSha256: 'hash', consentConfirmed: true,
      createdAt: 1, updatedAt: 1,
    }],
  });
  const [voice] = await library.list();
  assert.equal(voice.name, 'Legacy');
  assert.equal(voice.emotion, undefined);
  assert.equal(voice.gender, undefined);
  assert.equal(voice.ageRange, undefined);
});

test('voice profile updates use the native command and preserve the local id', async () => {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const library = createVoiceLibrary({
    isDesktop: () => true,
    invoke: async (command, args) => {
      calls.push({ command, args });
      return {
        id: 'a'.repeat(32), name: 'Me', revision: 4, durationSeconds: 6,
        sampleRate: 48_000, recordingSha256: 'hash', consentConfirmed: true,
        createdAt: 1, updatedAt: 2, emotion: 'warm', gender: 'neutral', ageRange: 'adult',
      };
    },
  });
  const voice = await library.updateProfile(`chatterbox-local:${'a'.repeat(32)}`, {
    emotion: '  warm ',
    gender: 'neutral',
    ageRange: 'adult',
  });
  assert.equal(voice.referenceId, `chatterbox-local:${'a'.repeat(32)}`);
  assert.deepEqual(calls, [{
    command: 'voice_library_update_profile',
    args: {
      voiceId: 'a'.repeat(32),
      emotion: '  warm ',
      gender: 'neutral',
      ageRange: 'adult',
    },
  }]);
});

test('voice profile validation prevents an invalid native update', async () => {
  let invoked = false;
  const library = createVoiceLibrary({
    isDesktop: () => true,
    invoke: async () => {
      invoked = true;
      return {};
    },
  });
  await assert.rejects(
    library.updateProfile('a'.repeat(32), { ageRange: 'x'.repeat(MAX_VOICE_PROFILE_LENGTH + 1) }),
    (error: unknown) => error instanceof VoiceLibraryError && error.code === 'VOICE_PROFILE_INVALID',
  );
  assert.equal(invoked, false);
});

test('library captures mono PCM, tears down tracks, then calls native create with WAV bytes', async () => {
  const commands: string[] = [];
  let process: { onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null } | null = null;
  let stopped = 0;
  let closed = 0;
  let resumed = 0;
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
      resume: async () => { resumed += 1; },
      close: async () => { closed += 1; },
    }),
  });
  const session = await library.startRecording();
  assert.ok(session.stop);
  assert.equal(resumed, 1);
  // A fifteen-second 48 kHz chunk is valid mono PCM input.
  assert.ok(process);
  const chunk = new Float32Array(48_000 * 15).fill(.25);
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

test('microphone preparation releases permission stream without beginning capture', async () => {
  let stopped = 0;
  let contexts = 0;
  const library = createVoiceLibrary({
    isDesktop: () => true,
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped++; } }] } as unknown as MediaStream) },
    audioContextFactory: () => {
      contexts++;
      throw new Error('capture must not begin');
    },
  });
  await library.requestMicrophonePermission();
  assert.equal(stopped, 1);
  assert.equal(contexts, 0);
});

test('legacy system assignments become explicit missing local references', () => {
  const migrated = migrateLegacyVoice({ engine: 'system', voiceId: 'com.apple.Alex', rate: 1 });
  assert.equal(migrated.engine, 'turbo');
  assert.equal(migrated.voiceId, `${MISSING_CLONED_VOICE_PREFIX}com.apple.Alex`);
  assert.equal(migrated.voiceRevision, 1);
});

test('voice preview reports playback failures instead of silently swallowing them', async () => {
  const revoked: string[] = [];
  const library = createVoiceLibrary({
    isDesktop: () => true,
    createObjectUrl: () => 'blob:sample',
    revokeObjectUrl: url => revoked.push(url),
    createAudioElement: () => ({ play: async () => { throw new Error('output unavailable'); }, pause() {}, onended: null }),
  });
  await assert.rejects(library.previewRecording({ wavData: sampleWav(), durationSeconds: 5, sampleRate: 48000, levelPeak: .5, complete: true }), /VOICE_PREVIEW_FAILED/);
  assert.deepEqual(revoked, ['blob:sample']);
});

function sampleWav(level = 8000) {
  const data = new Uint8Array(44 + 16000 * 6 * 2);
  const view = new DataView(data.buffer);
  const tag = (offset: number, value: string) => [...value].forEach((v, i) => view.setUint8(offset + i, v.charCodeAt(0)));
  tag(0, 'RIFF'); view.setUint32(4, data.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, data.length - 44, true);
  for (let i = 44; i < data.length; i += 2) view.setInt16(i, level, true);
  return data;
}

test('saved WAV inspection rejects silence and truncation and reports audio properties', () => {
  assert.equal(inspectVoiceWav(sampleWav()).durationSeconds, 6);
  assert.throws(() => inspectVoiceWav(sampleWav(0)), /VOICE_RECORDING_SILENT/);
  assert.throws(() => inspectVoiceWav(sampleWav().subarray(0, 100)), /VOICE_RECORDING_INVALID/);
  assert.match(validateRecording({ wavData: sampleWav(), durationSeconds: 11.9, sampleRate: 16000, levelPeak: .5, complete: true })!, /at least/);
});

test('saved voice verification reads back disk bytes and preserves integrity failures', async () => {
  const calls: string[] = [];
  const library = createVoiceLibrary({ isDesktop: () => true, invoke: async (command) => {
    calls.push(command); return Array.from(sampleWav()) as never;
  } });
  assert.equal((await library.verify('a'.repeat(32))).durationSeconds, 6);
  assert.deepEqual(calls, ['voice_library_read_recording']);
  const broken = createVoiceLibrary({ isDesktop: () => true, invoke: async () => { throw 'VOICE_RECORDING_INTEGRITY: checksum mismatch'; } });
  await assert.rejects(broken.verify('a'.repeat(32)), /VOICE_RECORDING_INTEGRITY/);
});

test('preview completion and cancellation release audio and do not start stale reads', async () => {
  let ended: (() => void) | null = null;
  let paused = 0; let revoked = 0; let plays = 0;
  let read: (bytes: number[]) => void = () => {};
  const library = createVoiceLibrary({ isDesktop: () => true,
    invoke: () => new Promise(resolve => { read = bytes => resolve(bytes as never); }),
    createObjectUrl: () => 'blob:sample', revokeObjectUrl: () => revoked++,
    createAudioElement: () => ({
      get onended() { return ended; }, set onended(value) { ended = value; },
      play: async () => { plays++; }, pause: () => { paused++; },
    }),
  });
  const pending = library.preview({ voiceId: 'a'.repeat(32) });
  await library.stopPreview(); read(Array.from(sampleWav())); await pending;
  assert.equal(plays, 0);
  const recording = { wavData: sampleWav(), durationSeconds: 6, sampleRate: 16000, levelPeak: .5, complete: true };
  const playback = library.previewRecording(recording);
  ended?.(); await playback;
  assert.equal(revoked, 1); assert.equal(paused, 1);
  const cancelled = library.previewRecording(recording);
  await library.stopPreview(); await cancelled;
  assert.equal(revoked, 2); assert.equal(paused, 2);
});

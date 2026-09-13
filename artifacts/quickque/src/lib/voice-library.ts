import { recordFlowDebug, recordAudioFailure } from './flow/diagnostics.ts';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { isDesktop as defaultIsDesktop } from './desktop.ts';

export const VOICE_RECORDING_PROMPT =
  'Today I speak clearly and naturally. Quickque uses this short rehearsal to learn the sound of my voice.';
export const MIN_REFERENCE_SECONDS = 5;
export const MAX_REFERENCE_SECONDS = 10;
export const MAX_VOICE_NAME_LENGTH = 80;
export const LOCAL_VOICE_PREFIX = 'chatterbox-local:';

/** The exact metadata returned by Rust voices.rs (audio is never metadata). */
export type VoiceMetadata = {
  id: string;
  name: string;
  revision: number;
  durationSeconds: number;
  sampleRate: number;
  recordingSha256: string;
  consentConfirmed: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ClonedVoice = VoiceMetadata & {
  /** Stable identifier sent to Turbo and stored in scripts. */
  referenceId: string;
  available: boolean;
};

export type VoiceRecording = {
  wavData: Uint8Array;
  durationSeconds: number;
  sampleRate: number;
  levelPeak: number;
  complete: boolean;
};

export type VoiceRecordingSession = {
  stop(): Promise<VoiceRecording>;
  cancel(): Promise<void>;
  currentLevel(): number;
};

type MediaStreamLike = {
  getTracks(): Array<{ stop(): void }>;
};
type AudioNodeLike = {
  connect(node: AudioNodeLike): void;
  disconnect(): void;
};
type AudioContextLike = {
  sampleRate: number;
  destination: AudioNodeLike;
  createMediaStreamSource(stream: MediaStreamLike): AudioNodeLike;
  createScriptProcessor(bufferSize: number, inputChannels: number, outputChannels: number): {
    onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null;
    connect(node: AudioNodeLike): void;
    disconnect(): void;
  };
  createGain(): AudioNodeLike & { gain: { value: number } };
  resume(): Promise<void>;
  close(): Promise<void>;
};
type AudioElementLike = {
  play(): Promise<void> | void;
  pause(): void;
  onended: (() => void) | null;
  onerror?: (() => void) | null;
};

export type VoiceLibraryDependencies = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  isDesktop?: () => boolean;
  mediaDevices?: { getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> };
  audioContextFactory?: () => AudioContextLike;
  createAudioElement?: (url: string) => AudioElementLike;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
};

export class VoiceLibraryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'VoiceLibraryError';
    this.code = code;
  }
}

function nativeError(error: unknown): VoiceLibraryError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] ?? 'VOICE_LIBRARY_NATIVE_ERROR';
  return new VoiceLibraryError(code, message.replace(/^[A-Z][A-Z0-9_]+:\s*/, ''));
}

function nativeId(id: string): string {
  return id.startsWith(LOCAL_VOICE_PREFIX) ? id.slice(LOCAL_VOICE_PREFIX.length) : id;
}

function normaliseVoice(voice: VoiceMetadata): ClonedVoice {
  return {
    ...voice,
    id: nativeId(voice.id),
    referenceId: `${LOCAL_VOICE_PREFIX}${nativeId(voice.id)}`,
    available: true,
  };
}

export function validateVoiceName(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Give this voice a name.';
  if (value.length > MAX_VOICE_NAME_LENGTH) return `Voice names must be ${MAX_VOICE_NAME_LENGTH} characters or fewer.`;
  return null;
}

export function validateRecording(recording: VoiceRecording): string | null {
  if (!recording.complete) return 'The recording did not finish. Please try again.';
  if (recording.sampleRate < 16_000 || recording.sampleRate > 48_000) return 'The microphone sample rate must be between 16 and 48 kHz.';
  if (!Number.isFinite(recording.durationSeconds) || recording.durationSeconds <= MIN_REFERENCE_SECONDS || recording.durationSeconds > MAX_REFERENCE_SECONDS) {
    return `Record a clean sample longer than ${MIN_REFERENCE_SECONDS} seconds and up to ${MAX_REFERENCE_SECONDS} seconds.`;
  }
  if (!Number.isFinite(recording.levelPeak) || recording.levelPeak < 0.001) return 'The sample is silent or too quiet. Check your microphone and record again.';
  return null;
}

export function inspectVoiceWav(bytes: Uint8Array) {
  const invalid = () => new VoiceLibraryError('VOICE_RECORDING_INVALID', 'The saved sample is not a complete mono PCM WAV recording.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw invalid();
  let sampleRate = 0; let pcm: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + size > bytes.length) throw invalid();
    if (tag(offset) === 'fmt ') {
      if (size < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 || view.getUint16(start + 14, true) !== 16) throw invalid();
      sampleRate = view.getUint32(start + 4, true);
    }
    if (tag(offset) === 'data') pcm = bytes.subarray(start, start + size);
    offset = start + size + size % 2;
  }
  if (sampleRate < 16000 || sampleRate > 48000 || !pcm?.length || pcm.length % 2) throw invalid();
  const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let levelPeak = 0;
  for (let i = 0; i < pcm.length; i += 2) levelPeak = Math.max(levelPeak, Math.abs(data.getInt16(i, true)) / 32768);
  const durationSeconds = pcm.length / (sampleRate * 2);
  // Five-second legacy recordings can still be listened to and replaced.
  if (durationSeconds < MIN_REFERENCE_SECONDS || durationSeconds > MAX_REFERENCE_SECONDS) throw invalid();
  if (levelPeak < 0.001) throw new VoiceLibraryError('VOICE_RECORDING_SILENT', 'The saved sample is silent or too quiet. Record a new sample with the correct microphone.');
  return { durationSeconds, sampleRate, levelPeak, bytes: bytes.length };
}

function encodeWav(samples: Float32Array[], sampleRate: number): { data: Uint8Array; peak: number; duration: number } {
  const length = samples.reduce((total, chunk) => total + chunk.length, 0);
  const data = new Uint8Array(44 + length * 2);
  const view = new DataView(data.buffer);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, length * 2, true);
  let cursor = 44; let peak = 0;
  for (const chunk of samples) for (const value of chunk) {
    const clamped = Math.max(-1, Math.min(1, value));
    peak = Math.max(peak, Math.abs(clamped));
    view.setInt16(cursor, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    cursor += 2;
  }
  return { data, peak, duration: length / sampleRate };
}

export function createVoiceLibrary(dependencies: VoiceLibraryDependencies = {}) {
  const invoke = dependencies.invoke ?? tauriInvoke;
  const desktop = dependencies.isDesktop ?? defaultIsDesktop;
  const mediaDevices = dependencies.mediaDevices ?? (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined);
  const contextFactory = dependencies.audioContextFactory ?? (() => new AudioContext());
  const makeAudio = dependencies.createAudioElement ?? (url => new Audio(url));
  const objectUrl = dependencies.createObjectUrl ?? (blob => URL.createObjectURL(blob));
  const revokeUrl = dependencies.revokeObjectUrl ?? (url => URL.revokeObjectURL(url));
  let playing: { stop(): void } | null = null;
  let previewGeneration = 0;
  const requireDesktop = () => {
    if (!desktop()) throw new VoiceLibraryError('VOICE_LIBRARY_DESKTOP_REQUIRED', 'Voice recording and playback require the Quickque Mac desktop app.');
  };
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    requireDesktop();
    recordFlowDebug('voice_library_begin');
    try { const result = await invoke<T>(command, args); recordFlowDebug('voice_library_ready'); return result; }
    catch (error) { recordFlowDebug('voice_library_failed'); recordAudioFailure(error); throw error instanceof VoiceLibraryError ? error : nativeError(error); }
  };
  const stopPreview = async () => {
    previewGeneration++;
    playing?.stop();
  };
  const playWav = async (bytes: Uint8Array) => {
    inspectVoiceWav(bytes);
    recordFlowDebug('voice_preview_begin');
    playing?.stop();
    const copy = new Uint8Array(bytes);
    const url = objectUrl(new Blob([copy.buffer], { type: 'audio/wav' }));
    let audio: AudioElementLike;
    try { audio = makeAudio(url) as AudioElementLike; } catch (error) { revokeUrl(url); throw error; }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: VoiceLibraryError) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        audio.onended = null; audio.onerror = null; audio.pause(); revokeUrl(url);
        if (playing === active) playing = null;
        if (error) { recordFlowDebug('voice_preview_failed'); reject(error); } else resolve();
      };
      const failure = () => finish(new VoiceLibraryError('VOICE_PREVIEW_FAILED', 'Could not play the sample. Check your audio output, then retry.'));
      const active = { stop: () => { recordFlowDebug('voice_preview_stopped'); finish(); } };
      // A reference is at most ten seconds; a stalled load/play must terminate visibly.
      const deadline = setTimeout(failure, 20000);
      playing = active;
      audio.onended = () => { recordFlowDebug('voice_preview_ready'); finish(); };
      audio.onerror = failure;
      try { void Promise.resolve(audio.play()).then(() => { if (!settled) recordFlowDebug('voice_preview_playing'); }, failure); }
      catch { failure(); }
    });
  };
  const readSample = async (voiceId: string) => {
    recordFlowDebug('voice_verify_begin');
    try {
      const bytes = Uint8Array.from(await call<number[]>('voice_library_read_recording', { voiceId: nativeId(voiceId) }));
      const info = inspectVoiceWav(bytes);
      recordFlowDebug('voice_verify_ready', undefined, bytes.length);
      return { bytes, info };
    } catch (error) { recordFlowDebug('voice_verify_failed'); recordAudioFailure(error); throw error; }
  };
  return {
    list: async () => (await call<VoiceMetadata[]>('voice_library_list')).map(normaliseVoice),
    startRecording: async (): Promise<VoiceRecordingSession> => {
      requireDesktop();
      recordFlowDebug('voice_record_begin');
      if (!mediaDevices?.getUserMedia) throw new VoiceLibraryError('VOICE_MICROPHONE_UNAVAILABLE', 'Microphone recording is available only in the Quickque Mac app.');
      let stream: MediaStreamLike | null = null;
      let context: AudioContextLike | null = null;
      let source: AudioNodeLike | null = null;
      let processor: ReturnType<AudioContextLike['createScriptProcessor']> | null = null;
      let samples: Float32Array[] = [];
      let peak = 0;
      let level = 0;
      let sampleRate = 48_000;
      let capturedFrames = 0;
      let settled = false;
      const teardown = async () => {
        if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
        source?.disconnect(); stream?.getTracks().forEach(track => track.stop());
        if (context) await context.close().catch(() => {});
        processor = null; source = null; stream = null; context = null;
      };
      try {
        stream = await mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        context = contextFactory();
        sampleRate = context.sampleRate;
        if (context.sampleRate < 16_000 || context.sampleRate > 48_000) throw new VoiceLibraryError('VOICE_SAMPLE_RATE_UNSUPPORTED', 'This microphone uses an unsupported sample rate.');
        source = context.createMediaStreamSource(stream);
        processor = context.createScriptProcessor(4096, 1, 1);
        const silent = context.createGain(); silent.gain.value = 0;
        processor.onaudioprocess = event => {
          const sourceSamples = event.inputBuffer.getChannelData(0);
          const remaining = Math.max(0, Math.floor(sampleRate * MAX_REFERENCE_SECONDS) - capturedFrames);
          if (!remaining) return;
          const copy = new Float32Array(sourceSamples.subarray(0, remaining));
          capturedFrames += copy.length;
          level = 0;
          samples.push(copy); for (const value of copy) level = Math.max(level, Math.abs(value));
          peak = Math.max(peak, level);
        };
        source.connect(processor); processor.connect(silent); silent.connect(context.destination);
        await context.resume();
        recordFlowDebug('voice_record_ready');
      } catch (error) {
        recordFlowDebug('voice_record_failed');
        await teardown();
        throw error instanceof VoiceLibraryError ? error : new VoiceLibraryError('VOICE_MICROPHONE_PERMISSION', 'Quickque could not access the microphone. Allow microphone access and try again.');
      }
      return {
        currentLevel: () => level,
        stop: async () => {
          if (settled) throw new VoiceLibraryError('VOICE_RECORDING_NOT_ACTIVE', 'This recording has already ended.');
          settled = true; await teardown();
          const encoded = encodeWav(samples, sampleRate);
          const result = { wavData: encoded.data, durationSeconds: encoded.duration, sampleRate, levelPeak: Math.max(peak, encoded.peak), complete: true };
          recordFlowDebug('voice_record_complete', undefined, Math.round(encoded.duration * 1000));
          return result;
        },
        cancel: async () => { if (settled) return; settled = true; await teardown(); samples = []; recordFlowDebug('voice_record_cancel'); },
      };
    },
    create: async (input: { name: string; recording: VoiceRecording; consentConfirmed: true }) => {
      const error = validateVoiceName(input.name) ?? validateRecording(input.recording);
      if (error) throw new VoiceLibraryError('VOICE_RECORDING_INVALID', error);
      const metadata = await call<VoiceMetadata>('voice_library_create', { name: input.name.trim(), consentConfirmed: true, recording: Array.from(input.recording.wavData) });
      return normaliseVoice(metadata);
    },
    rename: async (voiceId: string, name: string) => normaliseVoice(await call<VoiceMetadata>('voice_library_rename', { voiceId: nativeId(voiceId), name })),
    rerecord: async (voiceId: string, recording: VoiceRecording, consentConfirmed: true) => {
      const error = validateRecording(recording); if (error) throw new VoiceLibraryError('VOICE_RECORDING_INVALID', error);
      return normaliseVoice(await call<VoiceMetadata>('voice_library_rerecord', { voiceId: nativeId(voiceId), consentConfirmed: true, recording: Array.from(recording.wavData) }));
    },
    delete: (voiceId: string) => call<void>('voice_library_delete', { voiceId: nativeId(voiceId) }),
    verify: async (voiceId: string) => (await readSample(voiceId)).info,
    previewRecording: (recording: VoiceRecording) => { previewGeneration++; return playWav(recording.wavData); },
    preview: async (voice: { voiceId: string; revision?: number }) => {
      const generation = ++previewGeneration;
      playing?.stop();
      const { bytes } = await readSample(voice.voiceId);
      if (generation !== previewGeneration) return;
      await playWav(bytes);
    },
    stopPreview,
  };
}

export type VoiceLibrary = ReturnType<typeof createVoiceLibrary>;
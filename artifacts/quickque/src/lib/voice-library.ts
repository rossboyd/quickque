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
  close(): Promise<void>;
};
type AudioElementLike = {
  play(): Promise<void> | void;
  pause(): void;
  onended: (() => void) | null;
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
  if (!Number.isFinite(recording.durationSeconds) || recording.durationSeconds < MIN_REFERENCE_SECONDS || recording.durationSeconds > MAX_REFERENCE_SECONDS) {
    return `Record a clean sample between ${MIN_REFERENCE_SECONDS} and ${MAX_REFERENCE_SECONDS} seconds.`;
  }
  return null;
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
  let playing: { audio: AudioElementLike; url: string } | null = null;
  const requireDesktop = () => {
    if (!desktop()) throw new VoiceLibraryError('VOICE_LIBRARY_DESKTOP_REQUIRED', 'Voice recording and playback require the Quickque Mac desktop app.');
  };
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    requireDesktop();
    try { return await invoke<T>(command, args); } catch (error) { throw error instanceof VoiceLibraryError ? error : nativeError(error); }
  };
  const playWav = (bytes: Uint8Array) => {
    void stopPreview();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const url = objectUrl(new Blob([copy.buffer], { type: 'audio/wav' }));
    const audio = makeAudio(url) as AudioElementLike;
    playing = { audio, url };
    audio.onended = () => { if (playing?.audio === audio) { revokeUrl(url); playing = null; } };
    void Promise.resolve(audio.play()).catch(() => { revokeUrl(url); playing = null; });
  };
  const stopPreview = async () => {
    if (!playing) return;
    playing.audio.pause(); playing.audio.onended = null; revokeUrl(playing.url); playing = null;
  };
  return {
    list: async () => (await call<VoiceMetadata[]>('voice_library_list')).map(normaliseVoice),
    startRecording: async (): Promise<VoiceRecordingSession> => {
      requireDesktop();
      if (!mediaDevices?.getUserMedia) throw new VoiceLibraryError('VOICE_MICROPHONE_UNAVAILABLE', 'Microphone recording is available only in the Quickque Mac app.');
      let stream: MediaStreamLike | null = null;
      let context: AudioContextLike | null = null;
      let source: AudioNodeLike | null = null;
      let processor: ReturnType<AudioContextLike['createScriptProcessor']> | null = null;
      let samples: Float32Array[] = [];
      let peak = 0;
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
          samples.push(copy); for (const value of copy) peak = Math.max(peak, Math.abs(value));
        };
        source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      } catch (error) {
        await teardown();
        throw error instanceof VoiceLibraryError ? error : new VoiceLibraryError('VOICE_MICROPHONE_PERMISSION', 'Quickque could not access the microphone. Allow microphone access and try again.');
      }
      return {
        currentLevel: () => peak,
        stop: async () => {
          if (settled) throw new VoiceLibraryError('VOICE_RECORDING_NOT_ACTIVE', 'This recording has already ended.');
          settled = true; await teardown();
          const encoded = encodeWav(samples, sampleRate);
          const result = { wavData: encoded.data, durationSeconds: encoded.duration, sampleRate, levelPeak: Math.max(peak, encoded.peak), complete: true };
          return result;
        },
        cancel: async () => { if (settled) return; settled = true; await teardown(); samples = []; },
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
    previewRecording: (recording: VoiceRecording) => playWav(recording.wavData),
    preview: async (voice: { voiceId: string; revision?: number }) => {
      const bytes = await call<number[]>('voice_library_read_recording', { voiceId: nativeId(voice.voiceId) });
      playWav(Uint8Array.from(bytes));
    },
    stopPreview,
  };
}

export type VoiceLibrary = ReturnType<typeof createVoiceLibrary>;
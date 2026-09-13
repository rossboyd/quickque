import { invoke } from '@tauri-apps/api/core';

import { isDesktop } from './desktop.ts';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { SceneSpeechProgress } from './scene-lifecycle.ts';

export type LocalVoice = {
  /** A stable Chatterbox Turbo/default or local cloned reference. */
  id: string;
  name: string;
  language: string;
  engine: 'turbo';
};

export type SceneSpeechVoice = {
  engine: 'turbo';
  voiceId: string;
  rate: number;
  voiceRevision?: number;
};

export interface SceneSpeech {
  listLocalVoices(): Promise<LocalVoice[]>;
  speak(text: string, voice: SceneSpeechVoice, signal: AbortSignal, onProgress?: (progress: SceneSpeechProgress) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface SceneSpeechDependencies {
  isDesktop?: () => boolean;
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  listen?: typeof listen;
}

// Scene settings expose a relative multiplier around each platform default.
const MAX_RATE = 2;
const MIN_RATE = 0.5;
const MAX_TEXT_LENGTH = 100_000;
const SPEECH_TIMEOUT_MIN_MS = 30_000;
const SPEECH_TIMEOUT_MAX_MS = 15 * 60_000;
export class SceneSpeechError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SceneSpeechError';
    this.code = code;
  }
}

/** Preserve the failure category instead of sending every failure to Settings. */
export function voiceFailureMessage(error: unknown): string {
  const failure = normaliseNativeError(error);
  const advice: Record<string, string> = {
    SCENE_SPEECH_HELPER_UNAVAILABLE: 'Quickque could not launch its speech helper. Reinstall the Mac app from a complete build; refreshing voices cannot repair a missing helper.',
    SCENE_SPEECH_HELPER_PROTOCOL: 'The speech helper returned an invalid response. Reinstall the Mac app from a complete build.',
    SCENE_SPEECH_VOICE_REQUIRED: 'Choose a local Chatterbox voice for this character, then preview it.',
    SCENE_SPEECH_VOICE_UNAVAILABLE: 'This character’s saved local voice is unavailable. Open Settings → Chatterbox Turbo voices and choose or record another voice.',
    SCENE_SPEECH_DESKTOP_REQUIRED: 'Chatterbox voice playback requires the Quickque Mac desktop app. Browser speech is not used.',
    SCENE_SPEECH_TIMEOUT: 'The selected Chatterbox voice did not finish speaking. Try again or choose another local voice.',
    SCENE_SPEECH_STOP_FAILED: 'Quickque could not confirm speech stopped. Restart Quickque before trying again.',
    SCENE_SPEECH_TURBO_UNAVAILABLE: 'Download Chatterbox in Settings or Scene Partner setup, then choose a local voice.',
  };
  return advice[failure.code]
    ? `${advice[failure.code]} (${failure.code})`
    : `Voice failed: ${failure.message.slice(0, 600)}`;
}

function cancellationError(): SceneSpeechError {
  return new SceneSpeechError(
    'SCENE_SPEECH_CANCELLED',
    'Scene speech was cancelled.',
  );
}

function normaliseNativeError(error: unknown): SceneSpeechError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z_]+):/.exec(message)?.[1] ?? 'SCENE_SPEECH_NATIVE_ERROR';
  return new SceneSpeechError(code, message.replace(/^[A-Z_]+:\s*/, ''));
}

function validateRequest(text: string, voice: SceneSpeechVoice): void {
  if (voice.engine !== 'turbo') {
    throw new SceneSpeechError(
      'SCENE_SPEECH_TURBO_UNAVAILABLE',
      'Quickque uses Chatterbox Turbo voices only.',
    );
  }
  if (voice.engine === 'turbo' && voice.rate !== 1) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_TURBO_UNAVAILABLE',
      'Choose a Chatterbox voice at its natural speaking rate.',
    );
  }
  if (!text.trim()) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_TEXT_EMPTY',
      'Scene speech needs dialogue text to speak.',
    );
  }
  if (text.length > MAX_TEXT_LENGTH) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_TEXT_TOO_LONG',
      'This dialogue turn is too long for one speech request.',
    );
  }
  if (!voice.voiceId.trim()) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_VOICE_REQUIRED',
      'Choose a local Chatterbox voice before starting playback.',
    );
  }
  if (!Number.isFinite(voice.rate) || voice.rate < MIN_RATE || voice.rate > MAX_RATE) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_RATE_INVALID',
      `Speech rate must be between ${MIN_RATE} and ${MAX_RATE}.`,
    );
  }
}

function speechTimeoutFor(text: string): number {
  // This is deliberately generous (roughly 40 characters/minute) and exists
  // only to surface a wedged platform synthesizer instead of leaving a turn
  // indefinitely "speaking".
  return Math.min(
    SPEECH_TIMEOUT_MAX_MS,
    Math.max(SPEECH_TIMEOUT_MIN_MS, text.length * 1500 + 10_000),
  );
}

type ActiveSpeech = {
  completion: Promise<void>;
  cancel: () => Promise<void>;
};

/**
 * A narrow, cancellation-first boundary for scene-partner playback. It has no
 * knowledge of script state; callers own navigation and pass the corresponding
 * AbortSignal. Every transition serializes stop-before-start, and completion
 * handlers are scoped to one active operation so an old synthesizer callback
 * cannot complete a newer turn.
 */
class SceneSpeechAdapter implements SceneSpeech {
  private readonly desktop: () => boolean;
  private readonly nativeInvoke: <T>(
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<T>;
  private readonly scheduleTimeout: typeof globalThis.setTimeout;
  private readonly cancelTimeout: typeof globalThis.clearTimeout;
  private readonly listenToEvent: typeof listen;

  private active: ActiveSpeech | null = null;
  private transition: Promise<void> = Promise.resolve();
  private stopFailure: SceneSpeechError | null = null;

  constructor(dependencies: SceneSpeechDependencies = {}) {
    this.desktop = dependencies.isDesktop ?? isDesktop;
    this.nativeInvoke = dependencies.invoke ?? invoke;
    // Window timers require their host receiver when called as class members.
    this.scheduleTimeout = dependencies.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.cancelTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
    this.listenToEvent = dependencies.listen ?? listen;
  }

  async listLocalVoices(): Promise<LocalVoice[]> {
    if (this.desktop()) {
      try {
        const response = await this.nativeInvoke<{ voices: LocalVoice[] }>(
          'scene_speech_list_local_voices',
        );
        if (!Array.isArray(response?.voices)) {
          throw new SceneSpeechError(
            'SCENE_SPEECH_NATIVE_PROTOCOL',
            'The native Chatterbox voice service returned an invalid voice list.',
          );
        }
        return response.voices.filter(
          (voice): voice is LocalVoice =>
            voice?.engine === 'turbo' &&
            typeof voice.id === 'string' &&
            typeof voice.name === 'string' &&
            typeof voice.language === 'string' &&
            Boolean(voice.id && voice.name && voice.language),
        );
      } catch (error) {
        if (error instanceof SceneSpeechError) throw error;
        throw normaliseNativeError(error);
      }
    }
    // Browser builds intentionally expose no speech voices. In particular,
    // never fall back to speechSynthesis when the Mac helper is unavailable.
    return [];
  }

  async speak(text: string, voice: SceneSpeechVoice, signal: AbortSignal, onProgress?: (progress: SceneSpeechProgress) => void): Promise<void> {
    validateRequest(text, voice);
    if (signal.aborted) throw cancellationError();

    const active = await this.enqueueTransition(async () => {
      if (this.stopFailure) throw this.stopFailure;
      await this.cancelActive();
      if (signal.aborted) throw cancellationError();
      const desktop = this.desktop();
      if (!desktop) {
        throw new SceneSpeechError('SCENE_SPEECH_DESKTOP_REQUIRED', 'Chatterbox runs in the Quickque Mac app. Open this performance there.');
      }
      let requestId = 0;
      if (desktop) {
        try {
          requestId = await this.nativeInvoke<number>('scene_speech_next_request_id');
        } catch (error) {
          throw normaliseNativeError(error);
        }
      }
      if (
        desktop &&
        (!Number.isSafeInteger(requestId) || requestId <= 0)
      ) {
        throw new SceneSpeechError(
          'SCENE_SPEECH_NATIVE_PROTOCOL',
          'The local speech service returned an invalid playback request token.',
        );
      }
      if (signal.aborted) throw cancellationError();
      const next = this.startNative(text, voice, signal, requestId, onProgress);
      this.active = next;
      return next;
    });
    return active.completion;
  }

  stop(): Promise<void> {
    return this.enqueueTransition(() => this.cancelActive());
  }

  private enqueueTransition<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.transition.then(operation, operation);
    this.transition = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async cancelActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    // Do not clear `active` until a native stop acknowledges termination.
    // Abort settles playback promptly, but a second lifecycle `stop()` must
    // still await the same cancellation barrier before microphone/capture
    // code is allowed to continue.
    try {
      await active.cancel();
    } catch (error) {
      this.stopFailure = normaliseNativeError(error);
      throw this.stopFailure;
    }
  }

  private startNative(
    text: string,
    voice: SceneSpeechVoice,
    signal: AbortSignal,
    requestId: number,
    onProgress?: (progress: SceneSpeechProgress) => void,
  ): ActiveSpeech {
    let settled = false;
    let rejectCompletion: (error: unknown) => void = () => {};
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) rejectCompletion(error);
      else resolveCompletion();
    };
    let cancellation: Promise<void> | null = null;
    let unlisten: UnlistenFn | null = null;

    const timeout = this.scheduleTimeout(() => {
      void cancel(
        new SceneSpeechError(
          'SCENE_SPEECH_TIMEOUT',
      'Chatterbox speech did not finish before its safety timeout.',
        ),
      ).catch(() => {});
    }, Math.max(180_000, speechTimeoutFor(text)));

    const abort = () => {
      void cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });

    const finish = (error?: unknown) => {
      this.cancelTimeout(timeout);
      signal.removeEventListener('abort', abort);
      unlisten?.();
      unlisten = null;
      settle(error);
    };
    const cancel = (reason = cancellationError()): Promise<void> => {
      finish(reason);
      if (!cancellation) {
        cancellation = this.nativeInvoke<void>('scene_speech_stop', { requestId }).catch(
          error => {
            throw normaliseNativeError(error);
          },
        );
      }
      return cancellation!;
    };

    const launch = () => this.nativeInvoke('scene_speech_speak', {
      text,
      engine: voice.engine,
      voiceId: voice.voiceId,
      rate: voice.rate,
      voiceRevision: voice.voiceRevision,
      requestId,
    }).then(
      () => finish(),
      (error) => finish(normaliseNativeError(error)),
    );
    void this.listenToEvent<{ requestId: number; charStart: number; charEnd: number }>(
      'scene-speech-progress',
      event => {
        if (!settled && event.payload.requestId === requestId) {
          onProgress?.({ charStart: event.payload.charStart, charEnd: event.payload.charEnd });
        }
      },
    ).then(remove => {
      if (settled) remove();
      else unlisten = remove;
      return settled ? undefined : launch();
    }).catch(() => {
      if (!settled) void launch();
    });

    return { completion, cancel };
  }

}

export function createSceneSpeech(
  dependencies?: SceneSpeechDependencies,
): SceneSpeech {
  return new SceneSpeechAdapter(dependencies);
}

/** Lists only local Chatterbox voices available to the desktop helper. */
export async function listLocalVoices(): Promise<LocalVoice[]> {
  return createSceneSpeech().listLocalVoices();
}

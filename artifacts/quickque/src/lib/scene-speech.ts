import { invoke } from '@tauri-apps/api/core';

import { isDesktop } from './desktop.ts';

export type LocalVoice = {
  /** The platform-provided identifier. It is never a display-name surrogate. */
  id: string;
  name: string;
  language: string;
  engine: 'system' | 'turbo';
};

export type SceneSpeechVoice = {
  engine: 'system' | 'turbo';
  voiceId: string;
  rate: number;
};

export interface SceneSpeech {
  listLocalVoices(): Promise<LocalVoice[]>;
  speak(text: string, voice: SceneSpeechVoice, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}

type BrowserVoice = {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
};

type BrowserUtterance = {
  text: string;
  voice: BrowserVoice | null;
  rate: number;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

type BrowserSpeechSynthesis = {
  getVoices(): BrowserVoice[];
  speak(utterance: BrowserUtterance): void;
  cancel(): void;
  addEventListener?: (type: 'voiceschanged', listener: () => void) => void;
  removeEventListener?: (type: 'voiceschanged', listener: () => void) => void;
};

export interface SceneSpeechDependencies {
  isDesktop?: () => boolean;
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  browserSpeechSynthesis?: BrowserSpeechSynthesis | undefined;
  createBrowserUtterance?: (text: string) => BrowserUtterance;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
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
    SCENE_SPEECH_VOICE_REQUIRED: 'Choose an installed voice for this character, then preview it.',
    SCENE_SPEECH_VOICE_UNAVAILABLE: 'This character’s saved voice is unavailable. Refresh the list and choose an installed voice. If necessary, install one in System Settings → Accessibility → Read & Speak.',
    SCENE_SPEECH_TIMEOUT: 'The selected voice did not finish speaking. Try another installed voice. If all voices fail, restart Quickque.',
    SCENE_SPEECH_STOP_FAILED: 'Quickque could not confirm speech stopped. Restart Quickque before trying again.',
    SCENE_SPEECH_TURBO_UNAVAILABLE: 'Download Chatterbox in Settings or Scene Partner setup, then preview Chatterbox Default.',
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

function unavailableError(voiceId: string): SceneSpeechError {
  return new SceneSpeechError(
    'SCENE_SPEECH_VOICE_UNAVAILABLE',
    `The saved system voice "${voiceId}" is not installed or is unavailable.`,
  );
}

function normaliseNativeError(error: unknown): SceneSpeechError {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z_]+):/.exec(message)?.[1] ?? 'SCENE_SPEECH_NATIVE_ERROR';
  return new SceneSpeechError(code, message.replace(/^[A-Z_]+:\s*/, ''));
}

function validateRequest(text: string, voice: SceneSpeechVoice): void {
  if (voice.engine === 'turbo' && (voice.voiceId !== 'chatterbox-turbo:default-en' || voice.rate !== 1)) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_TURBO_UNAVAILABLE',
      'Choose Chatterbox Default at its natural speaking rate.',
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
      'Choose an installed system voice before starting playback.',
    );
  }
  if (!Number.isFinite(voice.rate) || voice.rate < MIN_RATE || voice.rate > MAX_RATE) {
    throw new SceneSpeechError(
      'SCENE_SPEECH_RATE_INVALID',
      `Speech rate must be between ${MIN_RATE} and ${MAX_RATE}.`,
    );
  }
}

function localBrowserVoices(synthesis: BrowserSpeechSynthesis | undefined): LocalVoice[] {
  if (!synthesis) return [];

  const seen = new Set<string>();
  const localVoices: LocalVoice[] = [];
  for (const voice of synthesis.getVoices()) {
    // A voice URI is the browser's identity for a voice. Do not manufacture an
    // ID from a name/language pair: that would silently select a different
    // voice when names are duplicated or a browser updates its voice list.
    if (
      !voice.localService ||
      !voice.voiceURI ||
      !voice.name ||
      !voice.lang ||
      seen.has(voice.voiceURI)
    ) {
      continue;
    }
    seen.add(voice.voiceURI);
    localVoices.push({
      id: voice.voiceURI,
      name: voice.name,
      language: voice.lang,
      engine: 'system',
    });
  }
  return localVoices;
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
  private readonly browserSynthesis: BrowserSpeechSynthesis | undefined;
  private readonly createUtterance: (text: string) => BrowserUtterance;
  private readonly scheduleTimeout: typeof globalThis.setTimeout;
  private readonly cancelTimeout: typeof globalThis.clearTimeout;

  private active: ActiveSpeech | null = null;
  private transition: Promise<void> = Promise.resolve();
  private stopFailure: SceneSpeechError | null = null;

  constructor(dependencies: SceneSpeechDependencies = {}) {
    this.desktop = dependencies.isDesktop ?? isDesktop;
    this.nativeInvoke = dependencies.invoke ?? invoke;
    this.browserSynthesis =
      dependencies.browserSpeechSynthesis ??
      (typeof window === 'undefined'
        ? undefined
        : (window.speechSynthesis as BrowserSpeechSynthesis | undefined));
    this.createUtterance =
      dependencies.createBrowserUtterance ??
      ((text) => {
        if (typeof SpeechSynthesisUtterance === 'undefined') {
          throw new SceneSpeechError(
            'SCENE_SPEECH_BROWSER_UNAVAILABLE',
            'This browser cannot create local speech utterances.',
          );
        }
        return new SpeechSynthesisUtterance(text) as unknown as BrowserUtterance;
      });
    // Window timers require their host receiver when called as class members.
    this.scheduleTimeout = dependencies.setTimeout ?? globalThis.setTimeout.bind(globalThis);
    this.cancelTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
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
            'The native system-voice service returned an invalid voice list.',
          );
        }
        return response.voices.filter(
          (voice): voice is LocalVoice =>
            (voice?.engine === 'system' || voice?.engine === 'turbo') &&
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
    const synthesis = this.browserSynthesis;
    const initial = localBrowserVoices(synthesis);
    if (
      initial.length > 0 ||
      !synthesis?.addEventListener ||
      !synthesis?.removeEventListener
    ) {
      return initial;
    }

    // Some browser engines populate voices asynchronously. Wait only for the
    // platform notification (with a short finite escape hatch); this never
    // enables a remote service or substitutes a default voice.
    return new Promise(resolve => {
      let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
      const finish = () => {
        if (timer !== null) this.cancelTimeout(timer);
        synthesis.removeEventListener!('voiceschanged', onVoicesChanged);
        resolve(localBrowserVoices(synthesis));
      };
      const onVoicesChanged = () => finish();
      timer = this.scheduleTimeout(() => finish(), 1_000);
      synthesis.addEventListener!('voiceschanged', onVoicesChanged);
    });
  }

  async speak(text: string, voice: SceneSpeechVoice, signal: AbortSignal): Promise<void> {
    validateRequest(text, voice);
    if (signal.aborted) throw cancellationError();

    const active = await this.enqueueTransition(async () => {
      if (this.stopFailure) throw this.stopFailure;
      await this.cancelActive();
      if (signal.aborted) throw cancellationError();
      const desktop = this.desktop();
      if (voice.engine === 'turbo' && !desktop) {
        throw new SceneSpeechError('SCENE_SPEECH_TURBO_UNSUPPORTED', 'Chatterbox runs in the Quickque Mac app. Open this performance there.');
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
      const next = desktop
        ? this.startNative(text, voice, signal, requestId)
        : this.startBrowser(text, voice, signal);
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

    const timeout = this.scheduleTimeout(() => {
      void cancel(
        new SceneSpeechError(
          'SCENE_SPEECH_TIMEOUT',
          'System speech did not finish before its safety timeout.',
        ),
      ).catch(() => {});
    }, voice.engine === 'turbo' ? Math.max(180_000, speechTimeoutFor(text)) : speechTimeoutFor(text));

    const abort = () => {
      void cancel().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });

    const finish = (error?: unknown) => {
      this.cancelTimeout(timeout);
      signal.removeEventListener('abort', abort);
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

    void this.nativeInvoke('scene_speech_speak', {
      text,
      engine: voice.engine,
      voiceId: voice.voiceId,
      rate: voice.rate,
      requestId,
    }).then(
      () => finish(),
      (error) => finish(normaliseNativeError(error)),
    );

    return { completion, cancel };
  }

  private startBrowser(
    text: string,
    voice: SceneSpeechVoice,
    signal: AbortSignal,
  ): ActiveSpeech {
    const synthesis = this.browserSynthesis;
    const selectedVoice = synthesis
      ? synthesis.getVoices().find(
          candidate => candidate.localService && candidate.voiceURI === voice.voiceId,
        )
      : undefined;
    if (!synthesis || !selectedVoice) {
      throw unavailableError(voice.voiceId);
    }

    let settled = false;
    let rejectCompletion: (error: unknown) => void = () => {};
    let resolveCompletion: () => void = () => {};
    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const utterance = this.createUtterance(text);
    const settle = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) rejectCompletion(error);
      else resolveCompletion();
    };
    let cancellation: Promise<void> | null = null;
    const timeout = this.scheduleTimeout(() => {
      void cancel(
        new SceneSpeechError(
          'SCENE_SPEECH_TIMEOUT',
          'Local browser speech did not finish before its safety timeout.',
        ),
      ).catch(() => {});
    }, speechTimeoutFor(text));
    const abort = () => cancel();
    const finish = (error?: unknown) => {
      this.cancelTimeout(timeout);
      signal.removeEventListener('abort', abort);
      settle(error);
    };
    const cancel = (reason = cancellationError()): Promise<void> => {
      finish(reason);
      if (!cancellation) {
        try {
          synthesis.cancel();
          cancellation = Promise.resolve();
        } catch (error) {
          cancellation = Promise.reject(
            new SceneSpeechError(
              'SCENE_SPEECH_BROWSER_STOP_FAILED',
              error instanceof Error
                ? error.message
                : 'Local browser speech could not stop.',
            ),
          );
        }
      }
      return cancellation;
    };

    utterance.voice = selectedVoice;
    utterance.rate = voice.rate;
    utterance.onend = () => finish();
    utterance.onerror = (event) => {
      finish(
        new SceneSpeechError(
          'SCENE_SPEECH_BROWSER_ERROR',
          event.error
            ? `Local browser speech failed: ${event.error}.`
            : 'Local browser speech failed.',
        ),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      synthesis.speak(utterance);
    } catch (error) {
      finish(
        new SceneSpeechError(
          'SCENE_SPEECH_BROWSER_ERROR',
          error instanceof Error ? error.message : 'Local browser speech could not start.',
        ),
      );
    }

    return { completion, cancel };
  }
}

export function createSceneSpeech(
  dependencies?: SceneSpeechDependencies,
): SceneSpeech {
  return new SceneSpeechAdapter(dependencies);
}

/**
 * Lists only system voices that can be used without a cloud fallback.
 * Browser callers receive only `localService === true` voices.
 */
export async function listLocalVoices(): Promise<LocalVoice[]> {
  return createSceneSpeech().listLocalVoices();
}

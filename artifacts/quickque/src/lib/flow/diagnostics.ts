import { parseAudioDroppedWarning } from './native-errors.ts';

export {
  boundNativeStderr,
  formatNativeErrorDetailsForCopy,
  isRecoverableOverrunCode,
  MAX_AUDIO_QUEUE_FRAMES,
  MAX_NATIVE_MESSAGE_LENGTH,
  MAX_NATIVE_STDERR_BYTES,
  normalizeNativeErrorCode,
  parseAudioDroppedWarning,
  parseNativeErrorDetails,
  type AudioDroppedWarning,
  type NativeErrorDetails,
} from './native-errors.ts';

// Only fixed lifecycle labels and numeric metadata may enter this in-memory
// buffer. Never pass messages, payloads, script text, paths, or stderr here.
const labels: Record<string, string> = {
  audio_passages_complete: 'Audio passages saved',
  voice_verify_begin: 'Reading and checking saved voice WAV',
  voice_verify_ready: 'Saved voice WAV verified (bytes)',
  voice_verify_failed: 'Saved voice verification failed',
  voice_preview_playing: 'Voice reference audio playback started',
  voice_preview_stopped: 'Voice reference playback stopped',
  audio_generate_begin: 'Script audio generation requested',
  audio_generate_ready: 'Script audio generation completed',
  audio_generate_failed: 'Script audio generation failed',
  audio_listener_failed: 'Audio diagnostic listener could not be registered',
  audio_model_load: 'Chatterbox loading model',
  audio_voice_prepare: 'Chatterbox preparing voice reference',
  audio_generation: 'Chatterbox generating passage',
  audio_cancel_begin: 'Audio cancellation requested',
  audio_cancel_ready: 'Audio cancellation confirmed',
  audio_cancel_failed: 'Audio cancellation failed',
  voice_record_begin: 'Voice reference microphone requested',
  voice_record_ready: 'Voice reference microphone recording',
  voice_record_complete: 'Voice reference recording completed (milliseconds)',
  voice_record_failed: 'Voice reference recording failed',
  voice_record_cancel: 'Voice reference recording cancelled',
  voice_library_begin: 'Voice library operation requested',
  voice_library_ready: 'Voice library operation completed',
  voice_library_failed: 'Voice library operation failed',
  voice_preview_begin: 'Voice reference preview started',
  voice_preview_ready: 'Voice reference preview completed',
  voice_preview_failed: 'Voice reference preview failed',
  speech_begin: 'Chatterbox speech requested',
  speech_ready: 'Chatterbox speech completed',
  speech_failed: 'Chatterbox speech failed or cancelled',
  ui_desktop: 'Desktop UI loaded',
  ui_browser: 'Browser preview — native Flow is unavailable',
  session_begin: 'Flow session opened',
  session_cleanup: 'Flow session closing',
  listener_begin: 'Registering Tauri event listener',
  listener_ready: 'Tauri event listener registered',
  listener_failed: 'Tauri event listener failed',
  listener_removed: 'Tauri event listener removed',
  command_sent: 'Sending command to Rust',
  command_resolved: 'Rust command returned successfully',
  command_failed: 'Rust command rejected',
  cleanup_failed: 'Helper stop could not be confirmed',
  watchdog_armed: 'Waiting for operation (deadline in ms)',
  watchdog_cleared: 'Operation deadline cleared',
  watchdog_expired: 'Operation timed out; requesting helper stop',
  lifecycle_error: 'Flow stopped after an error — see setup error for details',
  stale_event: 'Ignored an event from an older session',
  rust_command_received: 'Rust received command',
  helper_spawn_begin: 'Starting native helper process',
  helper_spawned: 'Native helper process created',
  helper_command_sent: 'Command written to helper stdin',
  helper_boot: 'Swift helper entered main',
  helper_read_wait: 'Swift helper waiting for command bytes',
  helper_command_received: 'Swift helper decoded command',
  apple_support_check_begin: 'Checking Apple speech support',
  apple_support_check_complete: 'Apple speech support check returned',
  apple_assets_check_begin: 'Checking Apple managed language assets',
  apple_assets_check_complete: 'Apple managed language asset check returned',
  microphone_request_begin: 'Checking/requesting macOS microphone permission',
  microphone_authorized: 'macOS microphone permission granted',
  apple_assets_download_begin: 'Downloading Apple managed language assets',
  apple_assets_download_complete: 'Apple managed language assets downloaded',
  apple_analyzer_prepare_begin: 'Preparing Apple on-device speech analyzer',
  apple_analyzer_prepare_complete: 'Apple on-device speech analyzer prepared',
  apple_analyzer_ready: 'Apple on-device speech analyzer ready',
  audio_engine_start: 'Starting microphone audio engine',
  audio_engine_listening: 'Microphone audio engine is listening',
  audio_buffer_received: 'Audio buffer received',
  audio_conversion_begin: 'Audio conversion started',
  audio_conversion_complete: 'Audio conversion completed',
  helper_exit_code: 'Native helper exited with code',
  helper_exit_signal: 'Native helper exited from signal',
  helper_cleanup_forced: 'Native helper cleanup required a kill',
  download_progress: 'Apple language asset download percentage',
  'status:needs-model': 'Native status: Apple language assets required',
  'status:ready': 'Native status: Apple on-device speech ready',
  'status:loading': 'Native status: preparing Apple on-device speech',
  'status:downloading': 'Native status: downloading Apple language assets',
  'status:listening': 'Native status: listening',
  'status:paused': 'Native status: paused',
  'status:stopped': 'Native status: stopped',
  'status:silence-stopped': 'Native status: stopped after silence',
  'status:unsupported': 'Native status: unsupported platform',
  'status:error': 'Native status: error',
  audio_dropped: 'Native audio dropped warning (cumulative frames)',
};

for (const code of [
  'microphone_denied', 'microphone_unavailable', 'unsupported_platform',
  'apple_support', 'apple_assets', 'apple_assets_download', 'apple_analyzer',
  'engine_start', 'permission_start', 'transcription', 'overrun', 'audio_input',
  'helper_protocol', 'helper_exited', 'helper_invalid_output', 'helper_output_too_large',
]) labels[`error:${code}`] = `Native error code: ${code}`;

for (const code of [
  'SCENE_SPEECH_TURBO_VOICE_PREPARE', 'VOICE_RECORDING_SILENT',
  'SCENE_SPEECH_TURBO_MODEL_LOAD', 'SCENE_SPEECH_TURBO_GENERATION',
  'SCENE_SPEECH_TURBO_FAILED', 'SCENE_SPEECH_TURBO_UNAVAILABLE',
  'SCENE_SPEECH_TURBO_RUNTIME', 'SCENE_SPEECH_TURBO_UNSUPPORTED',
  'SCENE_SPEECH_TURBO_OFFLINE', 'SCENE_SPEECH_TURBO_AUDIO',
  'SCENE_SPEECH_VOICE_REFERENCE_SHORT',
  'SCENE_SPEECH_VOICE_UNAVAILABLE', 'SCENE_SPEECH_VOICE_INTEGRITY',
  'VOICE_RECORDING_INTEGRITY', 'VOICE_RECORDING_MISSING', 'VOICE_RECORDING_INVALID',
  'VOICE_RECORDING_DURATION', 'VOICE_STORAGE_UNAVAILABLE', 'VOICE_PREVIEW_FAILED',
  'SCRIPT_AUDIO_CANCELLED', 'SCRIPT_AUDIO_BUSY', 'SCRIPT_AUDIO_PAID_REQUIRED',
]) labels[`error:${code}`] = `Audio error code: ${code}`;

export function recordAudioFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z_]+):/.exec(message)?.[1];
  if (code) recordFlowDebug(`error:${code}`);
}

export interface FlowDebugEntry {
  id: number;
  at: number;
  code: string;
  label: string;
  generation?: number;
  value?: number;
  action?: string;
}

export const DEBUG_LIMIT = 160;
let entries: readonly FlowDebugEntry[] = [];
let sequence = 0;
const subscribers = new Set<() => void>();
const actions = new Set(['status', 'download', 'start', 'pause', 'stop', 'cancelDownload']);
const exitStages = new Set(['helper_exit_code', 'helper_exit_signal']);
const numberOrUndefined = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export function recordFlowDebug(
  code: string,
  generation?: unknown,
  value?: unknown,
  action?: unknown,
) {
  if (!Object.hasOwn(labels, code)) return;
  const entry = {
    id: ++sequence, at: Date.now(), code, label: labels[code],
    generation: numberOrUndefined(generation),
    value: numberOrUndefined(value),
    action: typeof action === 'string' && actions.has(action) ? action : undefined,
  };
  const last = entries.at(-1);
  if (last?.code === entry.code && last.generation === entry.generation &&
      last.value === entry.value && last.action === entry.action) return;
  entries = [...entries.slice(-(DEBUG_LIMIT - 1)), entry];
  subscribers.forEach(listener => listener());
}

export function recordFlowEvent(payload: unknown, activeGeneration: number) {
  if (!payload || typeof payload !== 'object') return;
  const event = payload as Record<string, unknown>;
  // Transcription events are not diagnostics, even if they have extra fields.
  if (!['diagnostic', 'status', 'error', 'warning'].includes(String(event.type))) return;
  if (event.generation !== activeGeneration) {
    recordFlowDebug('stale_event', event.generation);
    return;
  }
  if (event.type === 'diagnostic') {
    if (typeof event.stage === 'string') {
      // Exit values are the only native diagnostic metadata allowed into the
      // in-memory buffer. Ignore values on every other stage, regardless of
      // their type or shape.
      const value = exitStages.has(event.stage) ? numberOrUndefined(event.value) : undefined;
      recordFlowDebug(event.stage, event.generation, value);
    }
  } else if (event.type === 'status') {
    recordFlowDebug(`status:${event.status}`, event.generation);
    if (event.status === 'downloading' && typeof event.progress === 'number' &&
        Number.isFinite(event.progress) && event.progress >= 0 && event.progress <= 1) {
      recordFlowDebug('download_progress', event.generation, Math.floor(event.progress * 10) * 10);
    }
  } else if (event.type === 'warning') {
    // Warnings are intentionally reduced to a fixed label and the
    // cumulative frame counter. Queue state is rendered from FlowState, not
    // retained in this general-purpose diagnostics buffer.
    const warning = parseAudioDroppedWarning(event, activeGeneration);
    if (warning) recordFlowDebug('audio_dropped', warning.generation, warning.droppedFrames);
  } else {
    const code = `error:${event.code}`;
    recordFlowDebug(Object.hasOwn(labels, code) ? code : 'lifecycle_error', event.generation);
  }
}

export const getFlowDebugSnapshot = () => entries;
export function subscribeFlowDebug(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
export function clearFlowDebug() {
  entries = [];
  subscribers.forEach(listener => listener());
}
export function formatFlowDebug(entry: FlowDebugEntry) {
  return `${new Date(entry.at).toISOString().slice(11, 23)} ${entry.code} — ${entry.label}` +
    (entry.action ? ` [${entry.action}]` : '') +
    (entry.generation !== undefined ? ` #${entry.generation}` : '') +
    (entry.value !== undefined ? ` (${entry.value})` : '');
}
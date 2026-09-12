/**
 * Data that is safe to keep in Flow state, but intentionally not in the
 * general diagnostics buffer. `stderr` can contain paths, asset names, or
 * words spoken near a native process failure.
 */
export interface NativeErrorDetails {
  stderr: string;
  exitCode: number | null;
  signal: number | null;
  cleanupForced: boolean;
  stderrTruncated: boolean;
}

export interface AudioDroppedWarning {
  type: "warning";
  generation: number;
  code: "audio_dropped";
  /** Cumulative 16 kHz mono frame count for the current native generation. */
  droppedFrames: number;
  /** Frames currently queued by the native pipeline (0..80,000). */
  queuedFrames: number;
}

export const MAX_NATIVE_STDERR_BYTES = 8192;
export const MAX_NATIVE_MESSAGE_LENGTH = 320;
export const MAX_AUDIO_QUEUE_FRAMES = 80_000;
export const NATIVE_SAMPLE_RATE = 16_000;

const SAFE_NATIVE_ERROR_CODES = new Set([
  "audio_input",
  "engine_start",
  "helper_exited",
  "helper_invalid_output",
  "helper_output_too_large",
  "helper_protocol",
  "microphone_denied",
  "microphone_unavailable",
  "overrun",
  "audio_overrun",
  "audio_input_overrun",
  "recoverable_overrun",
  "recoverable_audio_overrun",
  "permission_start",
  "transcription",
  "unsupported_platform",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeCounter(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function isSafeGeneration(value: unknown): value is number {
  return isSafeCounter(value);
}

function parseExitNumber(value: unknown): number | null {
  if (value === null) return null;
  return isSafeCounter(value) ? value : null;
}

/**
 * Bound a string by UTF-8 bytes, rather than JavaScript code units. This
 * keeps the frontend cap aligned with the native cap for non-ASCII stderr.
 */
export function boundNativeStderr(value: string): { value: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= MAX_NATIVE_STDERR_BYTES) {
    return { value, truncated: false };
  }

  // TextDecoder replaces a split multi-byte character with U+FFFD. Trim the
  // decoded result once more so even that replacement cannot exceed the cap.
  const decoder = new TextDecoder();
  let bounded = decoder.decode(bytes.slice(0, MAX_NATIVE_STDERR_BYTES));
  while (encoder.encode(bounded).byteLength > MAX_NATIVE_STDERR_BYTES) {
    bounded = bounded.slice(0, -1);
  }
  return { value: bounded, truncated: true };
}

/**
 * Parse only the documented Rust error details shape. Unknown data, invalid
 * counters, and non-numeric process exit metadata never pass through.
 */
export function parseNativeErrorDetails(
  payload: unknown,
  activeGeneration?: number,
): NativeErrorDetails | null {
  if (!isRecord(payload) || !isRecord(payload.details)) return null;
  if ("type" in payload && payload.type !== "error") return null;
  if (activeGeneration !== undefined && payload.generation !== activeGeneration) return null;
  const details = payload.details;
  if (typeof details.stderr !== "string") return null;

  const stderr = boundNativeStderr(details.stderr);
  return {
    stderr: stderr.value,
    exitCode: parseExitNumber(details.exitCode),
    signal: parseExitNumber(details.signal),
    cleanupForced: details.cleanupForced === true,
    stderrTruncated: stderr.truncated || details.stderrTruncated === true,
  };
}

/**
 * Parse the transient audio-drop warning without changing lifecycle state.
 * A generation is required so callers cannot accidentally display an old
 * pipeline's cumulative counter.
 */
export function parseAudioDroppedWarning(
  payload: unknown,
  activeGeneration?: number,
): AudioDroppedWarning | null {
  if (!isRecord(payload) ||
      payload.type !== "warning" ||
      payload.code !== "audio_dropped" ||
      !isSafeGeneration(payload.generation) ||
      (activeGeneration !== undefined && payload.generation !== activeGeneration) ||
      !isSafeCounter(payload.droppedFrames) ||
      !isSafeCounter(payload.queuedFrames) ||
      payload.queuedFrames > MAX_AUDIO_QUEUE_FRAMES) {
    return null;
  }

  return {
    type: "warning",
    generation: payload.generation,
    code: "audio_dropped",
    droppedFrames: payload.droppedFrames,
    queuedFrames: payload.queuedFrames,
  };
}

export function isRecoverableOverrunCode(code: unknown): boolean {
  return typeof code === "string" &&
    /(?:^|_)overrun$/i.test(code);
}

export function normalizeNativeErrorCode(value: unknown): string {
  return typeof value === "string" && SAFE_NATIVE_ERROR_CODES.has(value)
    ? value
    : "FLOW_HELPER";
}

/**
 * This formatter is called only from the explicit native-details Copy
 * button. It must not be used by Flow diagnostics or automatic clipboard
 * actions.
 */
export function formatNativeErrorDetailsForCopy(details: NativeErrorDetails): string {
  return [
    "Quickque native error details (may contain sensitive information)",
    `Process exit code: ${details.exitCode === null ? "unknown" : details.exitCode}`,
    `Process signal: ${details.signal === null ? "unknown" : details.signal}`,
    `Forced cleanup: ${details.cleanupForced ? "yes" : "no"}`,
    `Stderr${details.stderrTruncated ? " (frontend-capped at 8192 bytes)" : ""}:`,
    details.stderr || "(no stderr captured)",
  ].join("\n");
}
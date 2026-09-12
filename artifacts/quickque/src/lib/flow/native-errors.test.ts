import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUDIO_QUEUE_FRAMES,
  MAX_NATIVE_STDERR_BYTES,
  boundNativeStderr,
  formatNativeErrorDetailsForCopy,
  normalizeNativeErrorCode,
  parseAudioDroppedWarning,
  parseNativeErrorDetails,
} from "./native-errors.ts";

test("accepts the documented cumulative audio-drop warning", () => {
  const warning = parseAudioDroppedWarning({
    type: "warning",
    generation: 42,
    code: "audio_dropped",
    droppedFrames: 16_000,
    queuedFrames: 8_000,
  }, 42);

  assert.deepEqual(warning, {
    type: "warning",
    generation: 42,
    code: "audio_dropped",
    droppedFrames: 16_000,
    queuedFrames: 8_000,
  });
});

test("rejects stale warnings and invalid counters without throwing", () => {
  const base = {
    type: "warning",
    generation: 42,
    code: "audio_dropped",
    droppedFrames: 1,
    queuedFrames: 1,
  };
  assert.equal(parseAudioDroppedWarning(base, 43), null);
  assert.equal(parseAudioDroppedWarning({ ...base, droppedFrames: -1 }, 42), null);
  assert.equal(parseAudioDroppedWarning({ ...base, droppedFrames: 1.5 }, 42), null);
  assert.equal(parseAudioDroppedWarning({ ...base, droppedFrames: Infinity }, 42), null);
  assert.equal(parseAudioDroppedWarning({ ...base, queuedFrames: -1 }, 42), null);
  assert.equal(parseAudioDroppedWarning({ ...base, queuedFrames: MAX_AUDIO_QUEUE_FRAMES + 1 }, 42), null);
  assert.equal(parseAudioDroppedWarning({ ...base, queuedFrames: "800" }, 42), null);
});

test("parses process details while nulling invalid exit numbers", () => {
  const details = parseNativeErrorDetails({
    type: "error",
    generation: 42,
    code: "overrun",
    message: "recoverable",
    details: {
      stderr: "native warning",
      exitCode: 2.5,
      signal: "9",
      cleanupForced: true,
      stderrTruncated: false,
      privateUnknownField: "/private/path",
    },
  });

  assert.deepEqual(details, {
    stderr: "native warning",
    exitCode: null,
    signal: null,
    cleanupForced: true,
    stderrTruncated: false,
  });
  assert.equal(parseNativeErrorDetails({ details: { stderr: "ok", exitCode: Infinity } })?.exitCode, null);
  assert.equal(parseNativeErrorDetails({ details: { stderr: "ok", signal: -1 } })?.signal, null);
  assert.equal(parseNativeErrorDetails({ details: { stderr: "ok", exitCode: 1.2 } })?.exitCode, null);
  assert.equal(parseNativeErrorDetails({
    type: "warning",
    details: { stderr: "wrong event", exitCode: 1, signal: null },
  }), null);
  assert.equal(parseNativeErrorDetails({
    generation: 41,
    details: { stderr: "stale", exitCode: 1, signal: null },
  }, 42), null);
});

test("caps stderr in UTF-8 bytes and carries truncation metadata", () => {
  const source = "é".repeat(MAX_NATIVE_STDERR_BYTES);
  const bounded = boundNativeStderr(source);
  assert.equal(bounded.truncated, true);
  assert.ok(new TextEncoder().encode(bounded.value).byteLength <= MAX_NATIVE_STDERR_BYTES);

  const details = parseNativeErrorDetails({
    details: {
      stderr: source,
      exitCode: 1,
      signal: null,
      cleanupForced: false,
      stderrTruncated: false,
    },
  });
  assert.ok(details);
  assert.equal(details?.stderrTruncated, true);
  assert.ok(new TextEncoder().encode(details?.stderr || "").byteLength <= MAX_NATIVE_STDERR_BYTES);
});

test("copy formatting is the only explicit raw-detail formatter", () => {
  const copy = formatNativeErrorDetailsForCopy({
    stderr: "SECRET /Users/name/private.wav",
    exitCode: null,
    signal: 9,
    cleanupForced: true,
    stderrTruncated: true,
  });
  assert.match(copy, /may contain sensitive information/);
  assert.ok(copy.includes("SECRET /Users/name/private.wav"));
  assert.match(copy, /signal: 9/i);
  assert.match(copy, /forced cleanup: yes/i);
});

test("unknown native codes use a fixed safe fallback", () => {
  assert.equal(normalizeNativeErrorCode("overrun"), "overrun");
  assert.equal(normalizeNativeErrorCode("recoverable_audio_overrun"), "recoverable_audio_overrun");
  assert.equal(normalizeNativeErrorCode("audio_input"), "audio_input");
  assert.equal(normalizeNativeErrorCode("private/path"), "FLOW_HELPER");
  assert.equal(normalizeNativeErrorCode("new_native_code"), "FLOW_HELPER");
});
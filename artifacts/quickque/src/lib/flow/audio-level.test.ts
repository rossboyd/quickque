import assert from "node:assert/strict";
import test from "node:test";
import { liveAudioLevel, parseAudioLevel } from "./audio-level.ts";
import { clearFlowDebug, getFlowDebugSnapshot, recordFlowEvent } from "./diagnostics.ts";

test("mic telemetry retains only a validated live level and receipt time", () => {
  assert.deepEqual(parseAudioLevel({
    type: "audio_level", generation: 42, level: 0.6, text: "discard", pcm: [1],
  }, 42, true, 100), { level: 0.6, receivedAt: 100 });
  for (const level of [0, 1]) {
    assert.equal(parseAudioLevel({ type: "audio_level", generation: 42, level }, 42, true, 100)?.level, level);
  }
});

test("mic telemetry rejects stale generations, inactive capture and invalid values", () => {
  const event = { type: "audio_level", generation: 42, level: 0.5 };
  assert.equal(parseAudioLevel(event, 43, true, 100), null);
  assert.equal(parseAudioLevel(event, 42, false, 100), null);
  for (const level of [-1, 1.1, NaN, Infinity, "0.5", null, undefined]) {
    assert.equal(parseAudioLevel({ ...event, level }, 42, true, 100), null);
  }
  for (const payload of [null, undefined, [], "audio_level", { ...event, type: "transcript" }]) {
    assert.equal(parseAudioLevel(payload, 42, true, 100), null);
  }
});

test("visual activity disappears on stale input or pause instead of simulating capture", () => {
  const sample = { level: 0.8, receivedAt: 100 };
  assert.equal(liveAudioLevel(sample, 100, true), 0.8);
  assert.equal(liveAudioLevel(sample, 600, true), 0.8);
  assert.equal(liveAudioLevel(sample, 601, true), 0);
  assert.equal(liveAudioLevel(sample, 150, false), 0);
  assert.equal(liveAudioLevel(sample, 99, true), 0);
  assert.equal(liveAudioLevel({ level: 0, receivedAt: 100 }, 150, true), 0);
});

test("mic levels never enter retained lifecycle diagnostics", () => {
  clearFlowDebug();
  recordFlowEvent({ type: "audio_level", generation: 42, level: 0.8 }, 42);
  recordFlowEvent({ type: "audio_level", generation: 41, level: 0.8 }, 42);
  assert.equal(getFlowDebugSnapshot().length, 0);
});
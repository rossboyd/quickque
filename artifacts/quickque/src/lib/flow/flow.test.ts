import assert from "node:assert/strict";
import test from "node:test";
import { FlowAligner } from "./alignment.ts";
import {
  FlowLifecycleController,
  INACTIVITY_MS,
  type OrderedTranscriptEvent,
  type TeardownReason,
  type TimerHandle,
} from "./controller.ts";
import { tokenize } from "./tokenize.ts";

test("tokenization normalizes while preserving exact UTF-16 source offsets", () => {
  const source = "  Héllo, WORLD! Don’t stop — 42.";
  const tokens = tokenize(source);
  assert.deepEqual(
    tokens.map(({ value, source: original }) => [value, original]),
    [
      ["hello", "Héllo"],
      ["world", "WORLD"],
      ["don't", "Don’t"],
      ["stop", "stop"],
      ["42", "42"],
    ],
  );
  for (const token of tokens) assert.equal(source.slice(token.start, token.end), token.source);
});

test("aligns punctuation, case, and a small fuzzy misspelling", () => {
  const aligner = new FlowAligner("Hello, wonderful world. This is Quickque.");
  const result = aligner.update("u1", "HELLO wonderfull world", true);
  assert.equal(result.matched, true);
  assert.equal(result.anchor, 3);
  assert.ok(result.confidence > 0.7);
});

test("holds on tangents and resumes on a strong upcoming sequence", () => {
  const aligner = new FlowAligner(
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda",
  );
  aligner.update("first", "alpha beta gamma", true);
  assert.equal(aligner.update("tangent", "weather is lovely today", true).matched, false);
  const resumed = aligner.update("return", "anyway epsilon zeta eta", true);
  assert.equal(resumed.matched, true);
  assert.equal(resumed.anchor, 7);
});

test("allows a stumble and one skipped script word", () => {
  const aligner = new FlowAligner("one two three four five six seven");
  const result = aligner.update("u", "one um two four five", true);
  assert.equal(result.matched, true);
  assert.equal(result.anchor, 5);
});

test("does not jump to an ambiguous repeated phrase", () => {
  const aligner = new FlowAligner(
    "start here then red green blue filler words red green blue ending now",
  );
  aligner.reanchor(2);
  const result = aligner.update("u", "red green blue", true);
  assert.equal(result.matched, false);
  assert.equal(result.reason, "ambiguous");
  assert.equal(aligner.anchor, 2);
});

test("accepts a repeated phrase when it begins exactly at the anchor", () => {
  const aligner = new FlowAligner("red green blue filler red green blue");
  const result = aligner.update("u", "red green blue", true);
  assert.equal(result.matched, true);
  assert.equal(result.anchor, 3);
});

test("bounded lookahead prevents distant jumps", () => {
  const aligner = new FlowAligner(
    "a b c d e f g h i j k l m n o p q r distant target words",
    { forwardWindow: 8 },
  );
  assert.equal(aligner.update("u", "distant target words", true).matched, false);
});

test("rolling partial revisions are reevaluated and only finals commit", () => {
  const aligner = new FlowAligner("one two three four five six");
  assert.equal(aligner.update("u", "one two three").anchor, 3);
  assert.equal(aligner.anchor, 0);
  assert.equal(aligner.update("u", "one too").matched, false);
  assert.equal(aligner.anchor, 0);
  assert.equal(aligner.update("u", "one two three four", true).anchor, 4);
  assert.equal(aligner.anchor, 4);
});

test("reanchor discards partial context", () => {
  const aligner = new FlowAligner("zero one two three four five six");
  aligner.update("old", "zero one two");
  aligner.reanchor(4);
  const result = aligner.update("new", "four five six", true);
  assert.equal(result.anchor, 7);
});

class FakeTime {
  now = 0;
  private id = 0;
  private timers = new Map<number, { at: number; callback: () => void }>();

  setTimer = (callback: () => void, delay: number): TimerHandle => {
    const value = ++this.id;
    this.timers.set(value, { at: this.now + delay, callback });
    return { value };
  };

  clearTimer = (handle: TimerHandle): void => {
    this.timers.delete(handle.value as number);
  };

  advance(milliseconds: number): void {
    const target = this.now + milliseconds;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.now = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.now = target;
  }
}

function event(
  generation: number,
  sequence: number,
  eventId = `event-${sequence}`,
): OrderedTranscriptEvent {
  return {
    generation,
    sequence,
    eventId,
    utteranceId: "utterance",
    text: `text ${sequence}`,
    isFinal: true,
  };
}

function harness() {
  const time = new FakeTime();
  const delivered: number[] = [];
  const teardowns: Array<[TeardownReason, number]> = [];
  const controller = new FlowLifecycleController({
    now: () => time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    onTranscript: (item) => delivered.push(item.sequence),
    teardown: (reason, generation) => teardowns.push([reason, generation]),
  });
  return { time, delivered, teardowns, controller };
}

test("stops at exactly thirty seconds of speech inactivity", () => {
  const { time, controller, teardowns } = harness();
  controller.start();
  time.advance(INACTIVITY_MS - 1);
  assert.equal(controller.state, "listening");
  time.advance(1);
  assert.equal(controller.state, "silence-stopped");
  assert.deepEqual(teardowns.map(([reason]) => reason), ["silence"]);
});

test("any speech, including off-script speech, resets inactivity", () => {
  const { time, controller } = harness();
  const generation = controller.start();
  time.advance(29_000);
  assert.equal(controller.markSpeech(generation), true);
  time.advance(29_999);
  assert.equal(controller.state, "listening");
  time.advance(1);
  assert.equal(controller.state, "silence-stopped");
});

test("orders buffered events and deduplicates event IDs", () => {
  const { controller, delivered } = harness();
  const generation = controller.start();
  controller.accept(event(generation, 1));
  assert.deepEqual(delivered, []);
  controller.accept(event(generation, 0));
  assert.deepEqual(delivered, [0, 1]);
  assert.equal(controller.accept(event(generation, 1)), false);
});

test("pause immediately invalidates generation and pending events", () => {
  const { controller, delivered, teardowns } = harness();
  const generation = controller.start();
  controller.accept(event(generation, 1));
  controller.pause();
  assert.equal(controller.state, "paused");
  assert.equal(controller.accept(event(generation, 0)), false);
  assert.deepEqual(delivered, []);
  assert.deepEqual(teardowns, [["pause", generation]]);
});

test("resume and reanchor isolate old generations", () => {
  const { controller, delivered, teardowns } = harness();
  const first = controller.start();
  controller.pause();
  const second = controller.resume();
  assert.notEqual(second, first);
  assert.equal(controller.accept(event(first, 0, "old")), false);
  controller.accept(event(second, 0, "current"));
  const third = controller.reanchor();
  assert.notEqual(third, second);
  assert.equal(controller.accept(event(second, 1, "stale")), false);
  controller.accept(event(third, 0, "new"));
  assert.deepEqual(delivered, [0, 0]);
  assert.deepEqual(teardowns.map(([reason]) => reason), ["pause", "reanchor"]);
});

test("stop clears timers and invokes teardown once", () => {
  const { time, controller, teardowns } = harness();
  const generation = controller.start();
  controller.stop();
  time.advance(INACTIVITY_MS);
  controller.stop();
  assert.equal(controller.state, "stopped");
  assert.deepEqual(teardowns, [["stop", generation]]);
});
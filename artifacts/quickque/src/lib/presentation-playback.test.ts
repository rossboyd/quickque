import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PresentationPlayback,
  TIMED_SPEED_ERRORS,
  calculateTimedSpeed,
  getPlaybackTimingSnapshot,
} from './presentation-playback.ts';
import type { TimerState } from './presentation-timer.ts';

class FakeClock {
  nowMs = 0;
  private nextHandle = 1;
  private timers = new Map<
    number,
    { at: number; callback: () => void }
  >();

  now = () => this.nowMs;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++;
    this.timers.set(handle, {
      at: this.nowMs + Math.max(0, delayMs),
      callback,
    });
    return handle;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  advance(ms: number): void {
    const target = this.nowMs + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, a], [, b]) => a.at - b.at || 0)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.nowMs = due[1].at;
      due[1].callback();
    }
    this.nowMs = target;
  }

  get pendingCount(): number {
    return this.timers.size;
  }
}

function makeController(clock: FakeClock, starts: number[] = []) {
  const changes: ReturnType<PresentationPlayback['getState']>[] = [];
  const controller = new PresentationPlayback({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: state => changes.push(state),
    onStart: () => starts.push(clock.now()),
  });
  return { controller, changes };
}

function assertTimer(timer: TimerState, elapsedMs: number, lastStartedAt: number | null) {
  assert.equal(timer.elapsedMs, elapsedMs);
  assert.equal(timer.lastStartedAt, lastStartedAt);
}

test('PresentationPlayback has a cancellable, duplicate-safe countdown', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);

  controller.requestStart(3);
  controller.requestStart(3);
  assert.equal(controller.state.phase, 'countdown');
  assert.equal(controller.state.countdownSeconds, 3);
  assert.equal(clock.pendingCount, 1);
  assert.deepEqual(starts, []);

  clock.advance(1000);
  assert.equal(controller.state.countdownSeconds, 2);
  clock.advance(2000);
  assert.equal(controller.state.phase, 'starting');
  assert.deepEqual(starts, [3000]);
  assert.equal(clock.pendingCount, 0);
});

test('Flow reanchor preparation freezes elapsed and remote playing without another start or countdown', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);
  controller.requestStart(2);
  clock.advance(2000);
  controller.activate();
  clock.advance(3500);
  controller.suspendForPreparation();
  assert.equal(controller.state.phase, 'starting');
  assert.deepEqual(getPlaybackTimingSnapshot(controller.state, clock.now()),
    { elapsedMs: 3500, playing: false });
  clock.advance(12000);
  controller.suspendForPreparation();
  controller.requestStart(30);
  assert.deepEqual(getPlaybackTimingSnapshot(controller.state, clock.now()),
    { elapsedMs: 3500, playing: false });
  assert.deepEqual(starts, [2000]);
  assert.equal(clock.pendingCount, 0);
  // Native listening acknowledgement, not a new capture command.
  controller.activate();
  clock.advance(700);
  assert.deepEqual(getPlaybackTimingSnapshot(controller.state, clock.now()),
    { elapsedMs: 4200, playing: true });
  assert.deepEqual(starts, [2000]);
});

test('pause during Flow preparation cannot be revived by a late listening acknowledgement', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);
  controller.requestStart(0);
  controller.activate();
  clock.advance(1000);
  controller.suspendForPreparation();
  controller.pause();
  clock.advance(5000);
  controller.activate();
  assert.equal(controller.state.phase, 'paused');
  assert.deepEqual(getPlaybackTimingSnapshot(controller.state, clock.now()),
    { elapsedMs: 1000, playing: false });
  controller.requestStart(30);
  assert.equal(controller.state.phase, 'starting');
  assert.equal(clock.pendingCount, 0);
  assert.equal(starts.length, 2);
});

test('pausing a fresh countdown cancels it and the next request counts down again', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);

  controller.requestStart(2);
  controller.pause();
  assert.equal(controller.state.phase, 'idle');
  assert.equal(clock.pendingCount, 0);
  clock.advance(5000);
  assert.deepEqual(starts, []);

  controller.requestStart(1);
  clock.advance(1000);
  assert.equal(controller.state.phase, 'starting');
  assert.deepEqual(starts, [6000]);
});

test('activation starts active time, and pause/resume does not repeat countdown', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);

  controller.requestStart(0);
  assert.equal(controller.state.phase, 'starting');
  assert.deepEqual(starts, [0]);
  controller.activate();
  clock.advance(1500);
  controller.pause();
  assert.equal(controller.state.phase, 'paused');
  assertTimer(controller.state.timerState, 1500, null);

  controller.requestStart(30);
  assert.equal(controller.state.phase, 'starting');
  assert.deepEqual(starts, [0, 1500]);
  controller.activate();
  clock.advance(500);
  assertTimer(controller.state.timerState, 1500, 1500);
  controller.pause();
  assertTimer(controller.state.timerState, 2000, null);
});

test('complete pauses active time, reset starts over, and seek reopens completed state', () => {
  const clock = new FakeClock();
  const { controller } = makeController(clock);

  controller.requestStart(0);
  controller.activate();
  clock.advance(800);
  controller.complete();
  assert.equal(controller.state.phase, 'completed');
  assertTimer(controller.state.timerState, 800, null);

  controller.requestStart(0);
  assert.equal(controller.state.phase, 'completed');
  controller.seek();
  assert.equal(controller.state.phase, 'paused');
  assertTimer(controller.state.timerState, 800, null);
  controller.requestStart(0);
  assert.equal(controller.state.phase, 'starting');

  controller.reset();
  assert.equal(controller.state.phase, 'idle');
  assertTimer(controller.state.timerState, 0, null);
});

test('resumePaused restores a paused, started session with a zero timer', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);

  controller.resumePaused();
  assert.equal(controller.state.phase, 'paused');
  assertTimer(controller.state.timerState, 0, null);
  controller.requestStart(10);
  assert.equal(controller.state.phase, 'starting');
  assert.deepEqual(starts, [0]);
});

test('dispose invalidates countdown callbacks and mount revives the controller', () => {
  const clock = new FakeClock();
  const starts: number[] = [];
  const { controller } = makeController(clock, starts);

  controller.requestStart(1);
  controller.dispose();
  clock.advance(1000);
  assert.deepEqual(starts, []);

  controller.requestStart(0);
  assert.deepEqual(starts, []);
  controller.mount();
  controller.requestStart(0);
  assert.deepEqual(starts, [1000]);
});

test('timed speed handles completion, invalid targets, and the speed ceiling', () => {
  assert.deepEqual(calculateTimedSpeed(100, 10_000), { speed: 10 });
  assert.deepEqual(calculateTimedSpeed(1, 0), { speed: 0 });
  assert.deepEqual(calculateTimedSpeed(0, 0), { speed: 0 });
  assert.deepEqual(calculateTimedSpeed(100, 0), {
    speed: 0,
    error: TIMED_SPEED_ERRORS.targetExpired,
  });
  assert.deepEqual(calculateTimedSpeed(Number.NaN, 1000), {
    speed: 0,
    error: TIMED_SPEED_ERRORS.nonFinite,
  });
  assert.deepEqual(calculateTimedSpeed(100, Number.POSITIVE_INFINITY), {
    speed: 0,
    error: TIMED_SPEED_ERRORS.nonFinite,
  });
  assert.deepEqual(calculateTimedSpeed(3001, 1000), {
    speed: 0,
    error: TIMED_SPEED_ERRORS.tooFast,
  });
  assert.deepEqual(calculateTimedSpeed(3000, 1000), { speed: 3000 });
});

import {
  createTimer,
  getElapsedMs,
  pauseTimer,
  startTimer,
  type TimerState,
} from './presentation-timer.ts';

export type PresentationPlaybackPhase =
  | 'idle'
  | 'countdown'
  | 'starting'
  | 'playing'
  | 'paused'
  | 'completed';

export interface PresentationPlaybackState {
  phase: PresentationPlaybackPhase;
  /** The whole seconds left in a countdown, or zero outside a countdown. */
  countdownSeconds: number;
  timerState: TimerState;
}

/** The existing phone snapshot contract, derived from the authoritative clock. */
export function getPlaybackTimingSnapshot(state: PresentationPlaybackState, now: number) {
  return {
    elapsedMs: getElapsedMs(state.timerState, now),
    playing: state.phase === 'playing',
  };
}

export type PlaybackTimeout = unknown;
export type PlaybackSetTimeout = (
  callback: () => void,
  delayMs: number,
) => PlaybackTimeout;
export type PlaybackClearTimeout = (timeout: PlaybackTimeout) => void;

export interface PresentationPlaybackDependencies {
  now: () => number;
  setTimeout: PlaybackSetTimeout;
  clearTimeout: PlaybackClearTimeout;
  onChange?: (state: PresentationPlaybackState) => void;
  onStart?: () => void;
}

export type PresentationPlaybackOptions = PresentationPlaybackDependencies;

const MAX_COUNTDOWN_SECONDS = 30;
const MAX_TIMED_SPEED_PX_PER_SECOND = 3000;

/**
 * A result used by the reader's timed-scrolling calculation.
 *
 * `speed` is always present so callers can safely use the result after
 * checking `error`. The error strings are deliberately user-facing: this
 * result is also the boundary between the pure timing code and the reader's
 * status message.
 */
export interface TimedSpeedResult {
  speed: number;
  error?: string;
}

export const TIMED_SPEED_ERRORS = {
  targetExpired: 'The timed scrolling target has elapsed.',
  nonFinite: 'Timed scrolling needs a finite reading distance and target time.',
  tooFast: 'The target duration would require scrolling faster than 3000 px/s.',
} as const;

/**
 * Calculates the speed needed to cover a rendered distance in the remaining
 * active time. It intentionally does not inspect wall-clock state or a DOM
 * node, which makes it safe to use from a deterministic reader loop.
 *
 * A distance at the end of the script is complete rather than an error. A
 * zero speed makes that outcome deterministic for callers that do not perform
 * their own end-distance check.
 */
export function calculateTimedSpeed(
  distancePx: number,
  remainingMs: number,
): TimedSpeedResult {
  if (distancePx <= 1 && Number.isFinite(distancePx)) {
    return { speed: 0 };
  }

  if (!Number.isFinite(distancePx) || !Number.isFinite(remainingMs)) {
    return { speed: 0, error: TIMED_SPEED_ERRORS.nonFinite };
  }

  if (remainingMs <= 0) {
    return { speed: 0, error: TIMED_SPEED_ERRORS.targetExpired };
  }

  const speed = distancePx / (remainingMs / 1000);
  if (!Number.isFinite(speed)) {
    return { speed: 0, error: TIMED_SPEED_ERRORS.nonFinite };
  }
  if (speed > MAX_TIMED_SPEED_PX_PER_SECOND) {
    return { speed: 0, error: TIMED_SPEED_ERRORS.tooFast };
  }

  return { speed };
}

function initialState(): PresentationPlaybackState {
  return {
    phase: 'idle',
    countdownSeconds: 0,
    timerState: createTimer(),
  };
}

function cloneState(state: PresentationPlaybackState): PresentationPlaybackState {
  return {
    phase: state.phase,
    countdownSeconds: state.countdownSeconds,
    timerState: { ...state.timerState },
  };
}

function normalizeCountdownSeconds(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNTDOWN_SECONDS, value));
}

/**
 * Owns the presentation lifecycle while leaving elapsed-time arithmetic to
 * presentation-timer.ts. The controller has no browser clock dependency:
 * every clock and timer operation is injected, so countdown cancellation and
 * late callbacks can be tested without sleeping.
 */
export class PresentationPlayback {
  private readonly now: () => number;
  private readonly scheduleTimeout: PlaybackSetTimeout;
  private readonly cancelTimeout: PlaybackClearTimeout;
  private onChange: (state: PresentationPlaybackState) => void;
  private onStart: () => void;

  private currentState: PresentationPlaybackState = initialState();
  private countdownTimeout: PlaybackTimeout | null = null;
  private countdownDeadline: number | null = null;
  private countdownGeneration = 0;
  private sessionHasStarted = false;
  private disposed = false;

  constructor(dependencies: PresentationPlaybackDependencies) {
    this.now = dependencies.now;
    this.scheduleTimeout = dependencies.setTimeout;
    this.cancelTimeout = dependencies.clearTimeout;
    this.onChange = dependencies.onChange ?? (() => {});
    this.onStart = dependencies.onStart ?? (() => {});
  }

  /**
   * Current state is exposed as a snapshot. In particular, consumers cannot
   * mutate the timer state held by this controller behind its back.
   */
  get state(): PresentationPlaybackState {
    return cloneState(this.currentState);
  }

  getState(): PresentationPlaybackState {
    return this.state;
  }

  /** Whether this controller has entered an actual presentation session. */
  get hasStarted(): boolean {
    return this.sessionHasStarted;
  }

  /**
   * Reconnects a controller after a React StrictMode effect cleanup. A real
   * disposal does not run a callback, and a stale countdown/starting phase is
   * made idle when the controller is revived because its callback no longer
   * exists.
   */
  mount(): this {
    if (!this.disposed) return this;
    this.disposed = false;

    if (
      this.currentState.phase === 'countdown' ||
      (this.currentState.phase === 'starting' && !this.sessionHasStarted)
    ) {
      this.sessionHasStarted = false;
      this.currentState = {
        phase: 'idle',
        countdownSeconds: 0,
        timerState: createTimer(),
      };
    }

    return this;
  }

  setOnChange(onChange: ((state: PresentationPlaybackState) => void) | undefined): void {
    this.onChange = onChange ?? (() => {});
  }

  setOnStart(onStart: (() => void) | undefined): void {
    this.onStart = onStart ?? (() => {});
  }

  requestStart(countdownSeconds: number): void {
    if (this.disposed) return;

    switch (this.currentState.phase) {
      case 'idle':
        this.startFromIdle(normalizeCountdownSeconds(countdownSeconds));
        return;
      case 'paused':
        if (this.sessionHasStarted) {
          this.enterStarting();
        } else {
          this.startFromIdle(normalizeCountdownSeconds(countdownSeconds));
        }
        return;
      case 'countdown':
      case 'starting':
      case 'playing':
      case 'completed':
        // A second start command must never restart a countdown or session.
        return;
    }
  }

  /**
   * A capture/flow start command is allowed to call this once it is ready.
   * Starting the elapsed timer here, rather than in onStart, ensures that
   * countdown time is never counted as active presentation time.
   */
  activate(): void {
    if (this.disposed || this.currentState.phase !== 'starting') return;

    const timerState = startTimer(this.currentState.timerState, this.now());
    this.sessionHasStarted = true;
    this.setState({
      phase: 'playing',
      countdownSeconds: 0,
      timerState,
    });
  }

  /**
   * Flow can replace capture when reanchoring an already playing session.
   * Wait for its listening acknowledgement without starting capture again,
   * repeating countdown, or accruing active time during preparation.
   */
  suspendForPreparation(): void {
    if (this.disposed || this.currentState.phase !== 'playing') return;
    this.setState({
      phase: 'starting',
      countdownSeconds: 0,
      timerState: pauseTimer(this.currentState.timerState, this.now()),
    });
  }

  pause(): void {
    if (this.disposed) return;

    if (this.currentState.phase === 'countdown') {
      this.cancelCountdown();
      this.sessionHasStarted = false;
      this.setState({
        phase: 'idle',
        countdownSeconds: 0,
        timerState: this.currentState.timerState,
      });
      return;
    }

    if (this.currentState.phase === 'starting') {
      // A paused persisted session remains resumable without another
      // countdown. A fresh start that has not activated returns to idle.
      this.cancelCountdown();
      this.setState({
        phase: this.sessionHasStarted ? 'paused' : 'idle',
        countdownSeconds: 0,
        timerState: this.currentState.timerState,
      });
      return;
    }

    if (this.currentState.phase !== 'playing') return;

    const timerState = pauseTimer(this.currentState.timerState, this.now());
    this.setState({
      phase: 'paused',
      countdownSeconds: 0,
      timerState,
    });
  }

  complete(): void {
    if (this.disposed || this.currentState.phase === 'completed') return;

    this.cancelCountdown();
    const timerState =
      this.currentState.timerState.lastStartedAt === null
        ? this.currentState.timerState
        : pauseTimer(this.currentState.timerState, this.now());
    this.setState({
      phase: 'completed',
      countdownSeconds: 0,
      timerState,
    });
  }

  /**
   * Starts a new session from the beginning. Reset deliberately creates a
   * stopped timer instead of using resetTimer: idle must not accrue time.
   */
  reset(): void {
    if (this.disposed) return;

    this.cancelCountdown();
    this.sessionHasStarted = false;
    this.setState({
      phase: 'idle',
      countdownSeconds: 0,
      timerState: createTimer(),
    });
  }

  /**
   * Restores a persisted logical position without starting motion or capture.
   * The persisted elapsed value is intentionally not restored: resume begins
   * paused with a fresh active-time clock.
   */
  resumePaused(): void {
    if (this.disposed) return;

    this.cancelCountdown();
    this.sessionHasStarted = true;
    this.setState({
      phase: 'paused',
      countdownSeconds: 0,
      timerState: createTimer(),
    });
  }

  /**
   * Moving away from an end position is the only seek transition owned by the
   * lifecycle. Existing elapsed time remains useful for timing displays.
   */
  seek(): void {
    if (this.disposed || this.currentState.phase !== 'completed') return;

    this.cancelCountdown();
    const timerState = pauseTimer(this.currentState.timerState, this.now());
    this.setState({
      phase: 'paused',
      countdownSeconds: 0,
      timerState,
    });
  }

  /**
   * Invalidates both countdown callbacks and future lifecycle commands. The
   * callback generation check still protects against timer implementations
   * that invoke a cleared timeout late.
   */
  dispose(): void {
    if (this.disposed) return;
    this.cancelCountdown();
    this.disposed = true;
  }

  private startFromIdle(countdownSeconds: number): void {
    if (countdownSeconds <= 0) {
      this.enterStarting();
      return;
    }

    this.cancelCountdown();
    const now = this.now();
    this.countdownDeadline = now + countdownSeconds * 1000;
    this.setState({
      phase: 'countdown',
      countdownSeconds: Math.ceil(countdownSeconds),
      timerState: this.currentState.timerState,
    });

    if (this.disposed || this.currentState.phase !== 'countdown') return;
    this.scheduleCountdown();
  }

  private enterStarting(): void {
    this.cancelCountdown();
    this.setState({
      phase: 'starting',
      countdownSeconds: 0,
      timerState: this.currentState.timerState,
    });

    // An onChange listener may dispose or reset the controller synchronously.
    // Never invoke onStart after that invalidation.
    if (!this.disposed && this.currentState.phase === 'starting') {
      this.onStart();
    }
  }

  private scheduleCountdown(): void {
    const deadline = this.countdownDeadline;
    const generation = this.countdownGeneration;
    if (
      this.disposed ||
      deadline === null ||
      this.currentState.phase !== 'countdown'
    ) {
      return;
    }

    const remainingMs = deadline - this.now();
    if (remainingMs <= 0) {
      this.expireCountdown(generation);
      return;
    }

    this.countdownTimeout = this.scheduleTimeout(() => {
      this.countdownTimeout = null;
      if (
        this.disposed ||
        generation !== this.countdownGeneration ||
        this.currentState.phase !== 'countdown'
      ) {
        return;
      }

      const remaining = deadline - this.now();
      if (remaining <= 0) {
        this.expireCountdown(generation);
        return;
      }

      const seconds = Math.ceil(remaining / 1000);
      if (seconds !== this.currentState.countdownSeconds) {
        this.setState({
          phase: 'countdown',
          countdownSeconds: seconds,
          timerState: this.currentState.timerState,
        });
      }
      if (
        !this.disposed &&
        generation === this.countdownGeneration &&
        this.currentState.phase === 'countdown'
      ) {
        this.scheduleCountdown();
      }
    }, Math.min(1000, remainingMs));
  }

  private expireCountdown(generation: number): void {
    if (
      this.disposed ||
      generation !== this.countdownGeneration ||
      this.currentState.phase !== 'countdown'
    ) {
      return;
    }

    this.cancelCountdown();
    this.enterStarting();
  }

  private cancelCountdown(): void {
    this.countdownGeneration += 1;
    if (this.countdownTimeout !== null) {
      this.cancelTimeout(this.countdownTimeout);
      this.countdownTimeout = null;
    }
    this.countdownDeadline = null;
  }

  private setState(next: PresentationPlaybackState): void {
    this.currentState = next;
    if (!this.disposed) {
      this.onChange(cloneState(next));
    }
  }
}

export type PresentationPlaybackController = PresentationPlayback;

export function createPresentationPlayback(
  dependencies: PresentationPlaybackDependencies,
): PresentationPlayback {
  return new PresentationPlayback(dependencies);
}

export const createPresentationPlaybackController = createPresentationPlayback;

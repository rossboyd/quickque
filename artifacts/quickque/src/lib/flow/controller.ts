export type FlowState = "idle" | "listening" | "paused" | "silence-stopped" | "stopped";
export type TeardownReason = "pause" | "silence" | "stop" | "reanchor";

export interface OrderedTranscriptEvent {
  generation: number;
  sequence: number;
  eventId: string;
  utteranceId: string;
  text: string;
  isFinal: boolean;
}

export interface TimerHandle {
  readonly value: unknown;
}

export interface FlowControllerDependencies {
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  onTranscript: (event: OrderedTranscriptEvent) => void;
  onStateChange?: (state: FlowState) => void;
  teardown: (reason: TeardownReason, generation: number) => void;
}

const INACTIVITY_MS = 30_000;

/**
 * Owns no microphone or network objects. Transports use the current generation
 * as a capability and feed events back through accept(); stale capabilities
 * are rejected synchronously.
 */
export class FlowLifecycleController {
  private readonly dependencies: Required<FlowControllerDependencies>;
  private timer: TimerHandle | undefined;
  private deadline = 0;
  private nextSequence = 0;
  private pending = new Map<number, OrderedTranscriptEvent>();
  private seen = new Set<string>();
  private currentState: FlowState = "idle";
  private currentGeneration = 0;

  constructor(dependencies: FlowControllerDependencies) {
    this.dependencies = {
      now: dependencies.now ?? (() => Date.now()),
      setTimer:
        dependencies.setTimer ??
        ((callback, delayMs) => ({ value: globalThis.setTimeout(callback, delayMs) })),
      clearTimer:
        dependencies.clearTimer ??
        ((handle) => globalThis.clearTimeout(handle.value as ReturnType<typeof setTimeout>)),
      onTranscript: dependencies.onTranscript,
      onStateChange: dependencies.onStateChange ?? (() => undefined),
      teardown: dependencies.teardown,
    };
  }

  get state(): FlowState {
    return this.currentState;
  }

  get generation(): number {
    return this.currentGeneration;
  }

  start(firstSequence = 0): number {
    if (this.currentState === "listening") return this.currentGeneration;
    this.newGeneration(firstSequence);
    this.setState("listening");
    this.markSpeech();
    return this.currentGeneration;
  }

  resume(firstSequence = 0): number {
    return this.start(firstSequence);
  }

  /** Speech activity is transport VAD input, independent of script matching. */
  markSpeech(generation = this.currentGeneration): boolean {
    if (this.currentState !== "listening" || generation !== this.currentGeneration) return false;
    this.deadline = this.dependencies.now() + INACTIVITY_MS;
    this.armTimer();
    return true;
  }

  accept(event: OrderedTranscriptEvent): boolean {
    if (
      this.currentState !== "listening" ||
      event.generation !== this.currentGeneration ||
      event.sequence < this.nextSequence ||
      this.seen.has(event.eventId)
    ) {
      return false;
    }
    this.seen.add(event.eventId);
    if (!this.pending.has(event.sequence)) this.pending.set(event.sequence, event);
    this.flush();
    return true;
  }

  pause(): void {
    if (this.currentState !== "listening") return;
    const invalidated = this.currentGeneration;
    this.invalidate();
    this.setState("paused");
    this.dependencies.teardown("pause", invalidated);
  }

  reanchor(firstSequence = 0): number {
    const invalidated = this.currentGeneration;
    const wasListening = this.currentState === "listening";
    this.invalidate();
    this.dependencies.teardown("reanchor", invalidated);
    if (wasListening) {
      this.newGeneration(firstSequence);
      this.setState("listening");
      this.markSpeech();
    }
    return this.currentGeneration;
  }

  stop(): void {
    if (this.currentState === "stopped") return;
    const invalidated = this.currentGeneration;
    this.invalidate();
    this.setState("stopped");
    this.dependencies.teardown("stop", invalidated);
  }

  private newGeneration(firstSequence: number): void {
    this.currentGeneration += 1;
    this.nextSequence = firstSequence;
    this.pending.clear();
    this.seen.clear();
  }

  private invalidate(): void {
    this.currentGeneration += 1;
    this.pending.clear();
    this.seen.clear();
    if (this.timer) this.dependencies.clearTimer(this.timer);
    this.timer = undefined;
  }

  private flush(): void {
    while (true) {
      const event = this.pending.get(this.nextSequence);
      if (!event) break;
      this.pending.delete(this.nextSequence);
      this.nextSequence += 1;
      this.dependencies.onTranscript(event);
    }
  }

  private armTimer(): void {
    if (this.timer) this.dependencies.clearTimer(this.timer);
    const delay = Math.max(0, this.deadline - this.dependencies.now());
    this.timer = this.dependencies.setTimer(() => this.onTimer(), delay);
  }

  private onTimer(): void {
    this.timer = undefined;
    if (this.currentState !== "listening") return;
    if (this.dependencies.now() < this.deadline) {
      this.armTimer();
      return;
    }
    const invalidated = this.currentGeneration;
    this.invalidate();
    this.setState("silence-stopped");
    this.dependencies.teardown("silence", invalidated);
  }

  private setState(state: FlowState): void {
    if (state === this.currentState) return;
    this.currentState = state;
    this.dependencies.onStateChange(state);
  }
}

export { INACTIVITY_MS };
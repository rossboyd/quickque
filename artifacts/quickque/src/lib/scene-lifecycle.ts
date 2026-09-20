/**
 * Turn-taking is deliberately independent of React, DOM geometry, and either
 * speech engine.  This keeps cancellation ordering testable and makes a late
 * synthesis completion incapable of moving a newer turn.
 */
export type SceneTurn = {
  id: string;
  content: string;
  characterId?: string | null;
};

export type ScenePhase =
  | 'idle'
  | 'preparing'
  | 'speaking'
  | 'waiting'
  | 'paused'
  | 'blocked'
  | 'completed';

export type SceneState = {
  phase: ScenePhase;
  turnIndex: number;
  generation: number;
  message: string | null;
  progress: SceneSpeechProgress | null;
  completedTurnIds: string[];
};

export type SceneSpeechProgress = {
  charStart: number;
  charEnd: number;
};
export type SceneVoice = {
  engine: 'turbo';
  voiceId: string;
  rate: number;
  voiceRevision?: number;
};

export interface SceneSpeaker {
  speak(
    text: string,
    voice: SceneVoice,
    signal: AbortSignal,
    onProgress?: (progress: SceneSpeechProgress) => void,
  ): Promise<void>;
  stop(): Promise<void>;
}

export interface SceneLifecycleOptions {
  turns: SceneTurn[];
  myRoleIds: readonly string[];
  voiceForCharacter: (characterId: string) => SceneVoice | null;
  speaker: SceneSpeaker;
  /** Restrict playback and navigation to these script turn IDs. */
  turnIds?: readonly string[];
  /**
   * Wait for native input teardown between every turn transition.  The
   * callback runs after speaker.stop() and before the next waiting/completed
   * state is exposed.
   */
  beforeTurnChange?: () => Promise<void>;
  /** Used to wait for native microphone teardown before speaker playback. */
  beforePartnerSpeak?: () => Promise<void>;
  onChange?: (state: SceneState) => void;
  startIndex?: number;
  endIndexExclusive?: number;
}

function copyState(state: SceneState): SceneState {
  return { ...state, completedTurnIds: [...state.completedTurnIds] };
}

/**
 * A partner line always owns a new generation and AbortController.  All
 * navigation and transport actions invalidate that generation before awaiting
 * native/browser speech shutdown, so a completion from the old line is inert.
 */
export class SceneLifecycle {
  private readonly turns: SceneTurn[];
  private readonly myRoles: ReadonlySet<string>;
  private readonly voiceForCharacter: (characterId: string) => SceneVoice | null;
  private readonly speaker: SceneSpeaker;
  private readonly turnQueue: number[];
  private readonly hasExplicitQueue: boolean;
  private readonly beforeTurnChange: () => Promise<void>;
  private readonly beforePartnerSpeak: () => Promise<void>;
  private onChange: (state: SceneState) => void;
  private stateValue: SceneState = {
    phase: 'idle',
    turnIndex: 0,
    generation: 0,
    message: null,
    progress: null,
    completedTurnIds: [],
  };
  private aborter: AbortController | null = null;
  private disposed = false;
  private readonly startIndex: number;
  private readonly endIndexExclusive: number;
  private transitionTail: Promise<void> = Promise.resolve();
  private pausedFromWaiting = false;

  constructor(options: SceneLifecycleOptions) {
    this.turns = options.turns;
    this.myRoles = new Set(options.myRoleIds);
    this.voiceForCharacter = options.voiceForCharacter;
    this.speaker = options.speaker;
    this.hasExplicitQueue = options.turnIds !== undefined;
    this.beforeTurnChange = options.beforeTurnChange ?? (async () => {});
    this.beforePartnerSpeak = options.beforePartnerSpeak ?? (async () => {});
    this.onChange = options.onChange ?? (() => {});
    this.startIndex = Math.max(0, Math.min(
      Math.trunc(options.startIndex ?? 0),
      this.turns.length,
    ));
    this.endIndexExclusive = Math.max(this.startIndex, Math.min(
      Math.trunc(options.endIndexExclusive ?? this.turns.length),
      this.turns.length,
    ));
    const requestedIds = options.turnIds === undefined ? null : new Set(options.turnIds);
    const seenIds = new Set<string>();
    this.turnQueue = requestedIds === null
      ? Array.from({ length: this.endIndexExclusive - this.startIndex }, (_, offset) => this.startIndex + offset)
      : this.turns.flatMap((turn, index) => {
        if (
          index < this.startIndex ||
          index >= this.endIndexExclusive ||
          !requestedIds.has(turn.id) ||
          seenIds.has(turn.id)
        ) return [];
        seenIds.add(turn.id);
        return [index];
      });
    this.stateValue.turnIndex = this.turnQueue[0] ?? this.startIndex;
  }

  get state(): SceneState {
    return copyState(this.stateValue);
  }

  get currentTurn(): SceneTurn | null {
    return this.turnQueue.includes(this.stateValue.turnIndex)
      ? this.turns[this.stateValue.turnIndex] ?? null
      : null;
  }

  setOnChange(onChange: ((state: SceneState) => void) | undefined): void {
    this.onChange = onChange ?? (() => {});
  }

  start(): Promise<void> {
    if (this.disposed || this.stateValue.phase === 'completed') return Promise.resolve();
    return this.enterTurn(this.stateValue.turnIndex);
  }

  pause(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.stateValue.phase === 'waiting') {
      this.pausedFromWaiting = true;
    } else if (this.stateValue.phase !== 'paused') {
      this.pausedFromWaiting = false;
    }
    const generation = this.invalidateSpeech();
    this.setState({
      phase: 'paused',
      turnIndex: this.stateValue.turnIndex,
      generation,
      message: null,
      progress: null,
      completedTurnIds: this.stateValue.completedTurnIds,
    });
    return this.stopSpeakerOrBlock(generation, this.stateValue.turnIndex).then(() => {});
  }

  next(): Promise<void> {
    return this.navigate(
      this.nextIndex(),
      this.stateValue.phase === 'waiting' || (this.stateValue.phase === 'paused' && this.pausedFromWaiting),
    );
  }

  goTo(index: number): Promise<void> {
    return this.navigate(this.resolveGoTo(index), false);
  }

  previous(): Promise<void> {
    return this.navigate(this.previousIndex(), false);
  }

  replay(): Promise<void> {
    return this.enterTurn(this.stateValue.turnIndex);
  }

  startOver(): Promise<void> {
    return this.reset();
  }

  async reset(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const generation = this.invalidateSpeech();
    this.setState({
      phase: 'idle',
      turnIndex: this.turnQueue[0] ?? this.startIndex,
      generation,
      message: null,
      progress: null,
      completedTurnIds: [],
    });
    this.pausedFromWaiting = false;
    const stopped = await this.stopSpeakerOrBlock(
      generation,
      this.turnQueue[0] ?? this.startIndex,
    );
    if (!stopped) {
      // A later action or disposal may supersede reset while its serialized
      // stop is still pending. That expected cancellation must not reject
      // callers (or surface as an unhandled promise rejection).
      if (this.isStale(generation)) return;
      throw new Error(this.stateValue.message ?? 'Speech did not stop before resetting the scene.');
    }
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    this.invalidateSpeech();
    const disposeOperation = this.transitionTail
      .catch(() => {})
      .then(async () => {
        await this.speaker.stop();
      });
    this.transitionTail = disposeOperation;
    // Cleanup callers attach their own policy to this barrier, but attaching
    // a rejection observer here prevents an ignored dispose() from becoming
    // an unhandled rejection without converting the returned barrier into a
    // successful promise.
    void disposeOperation.catch(() => {});
    return disposeOperation;
  }

  private navigate(index: number, completeCurrent: boolean): Promise<void> {
    const completionId = completeCurrent ? this.currentTurnId() : undefined;
    // An explicit bookmark queue has no meaningful idle/paused position
    // beyond its end: selecting one completes the queue after teardown.
    if (this.isCompletionIndex(index) && this.hasExplicitQueue) {
      return this.enterTurn(index, completionId);
    }
    return this.isSessionRunning()
      ? this.enterTurn(index, completionId)
      : this.selectWithoutStarting(index, completionId);
  }

  private async selectWithoutStarting(index: number, completedTurnId?: string): Promise<void> {
    if (this.disposed) return;
    const generation = this.invalidateSpeech();
    const phase = this.stateValue.phase === 'paused' ? 'paused' : 'idle';
    const completedTurnIds = completedTurnId &&
      this.turns[this.stateValue.turnIndex]?.id === completedTurnId
      ? this.addCompletedId(this.stateValue.completedTurnIds, completedTurnId)
      : this.stateValue.completedTurnIds;
    this.setState({
      phase: 'preparing',
      turnIndex: index,
      generation,
      message: null,
      progress: null,
      completedTurnIds,
    });
    if (!await this.prepareTurnChange(generation, index)) return;
    if (this.isStale(generation)) return;
    this.pausedFromWaiting = false;
    this.setState({
      phase,
      turnIndex: index,
      generation,
      message: null,
      progress: null,
      completedTurnIds: this.stateValue.completedTurnIds,
    });
  }

  private async enterTurn(index: number, completedTurnId?: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const generation = this.invalidateSpeech();
    const completedTurnIds = completedTurnId &&
      this.turns[this.stateValue.turnIndex]?.id === completedTurnId
      ? this.addCompletedId(this.stateValue.completedTurnIds, completedTurnId)
      : this.stateValue.completedTurnIds;
    // Preparing is intentionally inert. No actor waiting state or partner
    // speech is exposed until the prior audio has stopped successfully.
    this.setState({
      phase: 'preparing',
      turnIndex: index,
      generation,
      message: null,
      progress: null,
      completedTurnIds,
    });
    if (!await this.prepareTurnChange(generation, index)) return;

    if (this.isCompletionIndex(index)) {
      this.setState({
        phase: 'completed',
        turnIndex: this.completionIndex(),
        generation,
        message: null,
        progress: null,
        completedTurnIds: this.stateValue.completedTurnIds,
      });
      return;
    }

    const turn = this.turns[index];
    if (!turn.characterId) {
      this.setState({
        phase: 'blocked',
        turnIndex: index,
        generation,
        message: 'This turn is unassigned. Assign a character before Quickque can speak it.',
        progress: null,
        completedTurnIds: this.stateValue.completedTurnIds,
      });
      return;
    }

    if (this.myRoles.has(turn.characterId)) {
      this.setState({
        phase: 'waiting',
        turnIndex: index,
        generation,
        message: null,
        progress: null,
        completedTurnIds: this.stateValue.completedTurnIds,
      });
      return;
    }

    const voice = this.voiceForCharacter(turn.characterId);
    if (!voice) {
      this.setState({
        phase: 'blocked',
        turnIndex: index,
        generation,
        message: 'This character needs an available local voice before playback can start.',
        progress: null,
        completedTurnIds: this.stateValue.completedTurnIds,
      });
      return;
    }

    await this.speakWhenSafe(turn, voice, generation);
  }

  private async speakWhenSafe(turn: SceneTurn, voice: SceneVoice, generation: number): Promise<void> {
    try {
      await this.beforePartnerSpeak();
    } catch (error) {
      this.blockIfCurrent(
        generation,
        `Microphone did not stop: ${this.errorDetail(error, 'Stop Flow before starting partner speech.')}`,
      );
      return;
    }
    if (this.isStale(generation)) return;

    const aborter = new AbortController();
    this.aborter = aborter;
    this.setState({
      phase: 'speaking',
      turnIndex: this.stateValue.turnIndex,
      generation,
      message: null,
      progress: null,
      completedTurnIds: this.stateValue.completedTurnIds,
    });
    try {
      await this.speaker.speak(turn.content, voice, aborter.signal, progress => {
        if (this.isStale(generation) || aborter.signal.aborted ||
          this.stateValue.phase !== 'speaking') return;
        const charStart = Math.max(0, Math.min(turn.content.length, Math.trunc(progress.charStart)));
        const charEnd = Math.max(charStart, Math.min(turn.content.length, Math.trunc(progress.charEnd)));
        if (charEnd <= charStart) return;
        this.setState({ ...this.stateValue, progress: { charStart, charEnd } });
      });
    } catch (error) {
      if (this.isStale(generation) || aborter.signal.aborted) return;
      this.setState({
        phase: 'blocked',
        turnIndex: this.stateValue.turnIndex,
        generation,
        message: error instanceof Error && error.message
          ? `Speech could not play: ${error.message}`
          : 'Speech could not play. Check the selected local voice and try again.',
        progress: null,
        completedTurnIds: this.stateValue.completedTurnIds,
      });
      return;
    } finally {
      if (this.aborter === aborter) this.aborter = null;
    }
    if (!this.isStale(generation)) {
      await this.enterTurn(this.nextIndex(), turn.id);
    }
  }

  private invalidateSpeech(): number {
    const generation = this.stateValue.generation + 1;
    this.aborter?.abort();
    this.aborter = null;
    return generation;
  }

  private async stopSpeakerOrBlock(generation: number, turnIndex: number): Promise<boolean> {
    return this.enqueueTransition(async () => {
      try {
        await this.speaker.stop();
      } catch (error) {
        this.blockIfCurrent(
          generation,
          `Speech did not stop: ${this.errorDetail(error, 'Stop audio before changing turns.')}`,
          turnIndex,
        );
        return false;
      }
      return !this.isStale(generation);
    });
  }

  private async prepareTurnChange(generation: number, turnIndex: number): Promise<boolean> {
    return this.enqueueTransition(async () => {
      try {
        await this.speaker.stop();
      } catch (error) {
        this.blockIfCurrent(
          generation,
          `Speech did not stop: ${this.errorDetail(error, 'Stop audio before changing turns.')}`,
          turnIndex,
        );
        return false;
      }
      if (this.isStale(generation)) return false;
      try {
        await this.beforeTurnChange();
      } catch (error) {
        this.blockIfCurrent(
          generation,
          `Microphone did not stop: ${this.errorDetail(error, 'Stop Flow before changing turns.')}`,
          turnIndex,
        );
        return false;
      }
      return !this.isStale(generation);
    });
  }

  private enqueueTransition<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.transitionTail
      .catch(() => {})
      .then(operation);
    this.transitionTail = queued.then(() => {}, () => {});
    return queued;
  }

  private blockIfCurrent(generation: number, message: string, turnIndex = this.stateValue.turnIndex): void {
    if (this.isStale(generation)) return;
    this.setState({
      phase: 'blocked',
      turnIndex,
      generation,
      message,
      progress: null,
      completedTurnIds: this.stateValue.completedTurnIds,
    });
  }

  private errorDetail(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  private isSessionRunning(): boolean {
    return ['preparing', 'speaking', 'waiting'].includes(this.stateValue.phase);
  }

  private isStale(generation: number): boolean {
    return this.disposed || generation !== this.stateValue.generation;
  }

  private currentTurnId(): string | undefined {
    return this.turns[this.stateValue.turnIndex]?.id;
  }

  private addCompletedId(completedTurnIds: readonly string[], id: string): string[] {
    return completedTurnIds.includes(id) ? [...completedTurnIds] : [...completedTurnIds, id];
  }

  private queuePosition(index: number): number {
    return this.turnQueue.indexOf(index);
  }

  private nextIndex(): number {
    const position = this.queuePosition(this.stateValue.turnIndex);
    if (position >= 0) return this.turnQueue[position + 1] ?? this.completionIndex();
    return this.turnQueue.find(index => index > this.stateValue.turnIndex) ?? this.completionIndex();
  }

  private previousIndex(): number {
    const position = this.queuePosition(this.stateValue.turnIndex);
    if (position > 0) return this.turnQueue[position - 1];
    if (position === 0) return this.turnQueue[0] ?? this.startIndex;
    return this.turnQueue.filter(index => index < this.stateValue.turnIndex).pop()
      ?? this.turnQueue[0]
      ?? this.startIndex;
  }

  private resolveGoTo(index: number): number {
    if (!Number.isFinite(index)) return this.turnQueue[0] ?? this.startIndex;
    const requested = Math.trunc(index);
    if (!this.hasExplicitQueue) {
      return Math.max(this.startIndex, Math.min(requested, this.endIndexExclusive));
    }
    return this.turnQueue.find(turnIndex => turnIndex >= requested) ?? this.completionIndex();
  }

  private completionIndex(): number {
    return this.endIndexExclusive;
  }

  private isCompletionIndex(index: number): boolean {
    return this.hasExplicitQueue
      ? this.turnQueue.length === 0 || index >= this.completionIndex() || !this.turnQueue.includes(index)
      : index >= this.endIndexExclusive;
  }

  private setState(state: SceneState): void {
    if (this.disposed) return;
    this.stateValue = state;
    this.onChange(copyState(state));
  }
}

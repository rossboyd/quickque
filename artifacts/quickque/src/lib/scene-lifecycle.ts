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
  /** Used to wait for native microphone teardown before speaker playback. */
  beforePartnerSpeak?: () => Promise<void>;
  onChange?: (state: SceneState) => void;
  startIndex?: number;
  endIndexExclusive?: number;
}

function copyState(state: SceneState): SceneState {
  return { ...state };
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
  private readonly beforePartnerSpeak: () => Promise<void>;
  private onChange: (state: SceneState) => void;
  private stateValue: SceneState = {
    phase: 'idle',
    turnIndex: 0,
    generation: 0,
    message: null,
    progress: null,
  };
  private aborter: AbortController | null = null;
  private disposed = false;
  private readonly startIndex: number;
  private readonly endIndexExclusive: number;

  constructor(options: SceneLifecycleOptions) {
    this.turns = options.turns;
    this.myRoles = new Set(options.myRoleIds);
    this.voiceForCharacter = options.voiceForCharacter;
    this.speaker = options.speaker;
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
    this.stateValue.turnIndex = this.startIndex;
  }

  get state(): SceneState {
    return copyState(this.stateValue);
  }

  get currentTurn(): SceneTurn | null {
    return this.turns[this.stateValue.turnIndex] ?? null;
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
    const generation = this.invalidateSpeech();
    this.setState({
      phase: 'paused',
      turnIndex: this.stateValue.turnIndex,
      generation,
      message: null,
      progress: null,
    });
    return this.stopSpeakerOrBlock(generation, this.stateValue.turnIndex).then(() => {});
  }

  next(): Promise<void> {
    return this.navigate(this.stateValue.turnIndex + 1);
  }

  goTo(index: number): Promise<void> {
    return this.navigate(Math.max(this.startIndex, Math.min(index, this.endIndexExclusive)));
  }

  previous(): Promise<void> {
    return this.navigate(Math.max(this.startIndex, this.stateValue.turnIndex - 1));
  }

  replay(): Promise<void> {
    return this.enterTurn(this.stateValue.turnIndex);
  }

  startOver(): Promise<void> {
    return this.reset();
  }

  reset(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const generation = this.invalidateSpeech();
    this.setState({ phase: 'idle', turnIndex: this.startIndex, generation, message: null, progress: null });
    return this.stopSpeakerOrBlock(generation, this.startIndex).then(() => {});
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    this.invalidateSpeech();
    return this.speaker.stop().catch(() => {
      // The owner has gone away; no later scene transition can start speech.
    });
  }

  private navigate(index: number): Promise<void> {
    return this.isSessionRunning()
      ? this.enterTurn(index)
      : this.selectWithoutStarting(index);
  }

  private async selectWithoutStarting(index: number): Promise<void> {
    if (this.disposed) return;
    const generation = this.invalidateSpeech();
    const phase = this.stateValue.phase === 'paused' ? 'paused' : 'idle';
    this.setState({ phase, turnIndex: index, generation, message: null, progress: null });
    await this.stopSpeakerOrBlock(generation, index);
  }

  private async enterTurn(index: number): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const generation = this.invalidateSpeech();
    // Preparing is intentionally inert. No actor waiting state or partner
    // speech is exposed until the prior audio has stopped successfully.
    this.setState({ phase: 'preparing', turnIndex: index, generation, message: null, progress: null });
    if (!await this.stopSpeakerOrBlock(generation, index)) return;

    if (index >= this.endIndexExclusive) {
      this.setState({ phase: 'completed', turnIndex: this.endIndexExclusive, generation, message: null, progress: null });
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
      });
      return;
    }

    if (this.myRoles.has(turn.characterId)) {
      this.setState({ phase: 'waiting', turnIndex: index, generation, message: null, progress: null });
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
    this.setState({ phase: 'speaking', turnIndex: this.stateValue.turnIndex, generation, message: null, progress: null });
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
      });
      return;
    } finally {
      if (this.aborter === aborter) this.aborter = null;
    }
    if (!this.isStale(generation)) await this.enterTurn(this.stateValue.turnIndex + 1);
  }

  private invalidateSpeech(): number {
    const generation = this.stateValue.generation + 1;
    this.aborter?.abort();
    this.aborter = null;
    return generation;
  }

  private async stopSpeakerOrBlock(generation: number, turnIndex: number): Promise<boolean> {
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
  }

  private blockIfCurrent(generation: number, message: string, turnIndex = this.stateValue.turnIndex): void {
    if (this.isStale(generation)) return;
    this.setState({ phase: 'blocked', turnIndex, generation, message, progress: null });
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

  private setState(state: SceneState): void {
    if (this.disposed) return;
    this.stateValue = state;
    this.onChange(copyState(state));
  }
}

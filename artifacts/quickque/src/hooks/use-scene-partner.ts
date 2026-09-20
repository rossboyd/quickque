import { useLicence } from '@/lib/licence';
import type { Script } from '@/lib/types';
import { audioRequest } from '@/lib/script-audio-model';
import { PreparedScriptAudio } from '@/lib/script-audio';
import { chainDisposalBarrier } from '@/lib/disposal-barrier';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SceneLifecycle,
  type ScenePhase,
  type SceneSpeaker,
  type SceneState,
  type SceneTurn,
  type SceneVoice,
} from '@/lib/scene-lifecycle';

export type UseScenePartnerArgs = {
  enabled: boolean;
  script?: Script;
  turns: SceneTurn[];
  myRoleIds: readonly string[];
  voiceForCharacter: (characterId: string) => SceneVoice | null;
  /** Optional bookmark queue, resolved in script order by SceneLifecycle. */
  turnIds?: readonly string[];
  /** Stable representation of voice/engine settings that changes speech output. */
  voiceSignature: string;
  beforeTurnChange?: () => Promise<void>;
  beforePartnerSpeak?: () => Promise<void>;
  startIndex?: number;
  endIndexExclusive?: number;
};

export type ScenePartner = SceneState & {
  enabled: boolean;
  currentTurn: SceneTurn | null;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  next: () => Promise<void>;
  goTo: (index: number) => Promise<void>;
  previous: () => Promise<void>;
  replay: () => Promise<void>;
  startOver: () => Promise<void>;
  reset: () => Promise<void>;
};

const idle: SceneState = {
  phase: 'idle',
  turnIndex: 0,
  generation: 0,
  message: null,
  progress: null,
  completedTurnIds: [],
};

/**
 * React boundary around SceneLifecycle. Rebuilding after an edit deliberately
 * stops the old engine first; no old promise can update the newly built state.
 */
export function useScenePartner(args: UseScenePartnerArgs): ScenePartner {
  const licence = useLicence();
  const [state, setState] = useState<SceneState>(idle);
  const beforeTurnChangeRef = useRef(args.beforeTurnChange);
  beforeTurnChangeRef.current = args.beforeTurnChange;
  const beforeSpeakRef = useRef(args.beforePartnerSpeak);
  beforeSpeakRef.current = args.beforePartnerSpeak;
  const voiceRef = useRef(args.voiceForCharacter);
  voiceRef.current = args.voiceForCharacter;
  const actionGeneration = useRef(0);
  const prepareRef = useRef<Promise<void>>(Promise.resolve());
  const inheritedDisposalRef = useRef<Promise<void>>(Promise.resolve());
  const disposalRef = useRef<Promise<void>>(Promise.resolve());
  const lifecycleRef = useRef<SceneLifecycle | null>(null);

  const signature = useMemo(() => JSON.stringify({
    licensed: licence.licensed,
    scriptId: args.script?.id,
    enabled: args.enabled,
    turns: args.turns.map(turn => [turn.id, turn.content, turn.characterId ?? null]),
    turnIds: args.turnIds === undefined ? null : [...args.turnIds],
    myRoleIds: [...args.myRoleIds].sort(),
    voiceSignature: args.voiceSignature,
    startIndex: args.startIndex ?? 0,
    endIndexExclusive: args.endIndexExclusive ?? args.turns.length,
  }), [
    licence.licensed,
    args.enabled,
    args.script?.id,
    args.turns,
    args.turnIds,
    args.myRoleIds,
    args.voiceSignature,
    args.startIndex,
    args.endIndexExclusive,
  ]);

  useEffect(() => {
    actionGeneration.current++;
    const previousDisposal = disposalRef.current;
    inheritedDisposalRef.current = previousDisposal;
    let cached: PreparedScriptAudio | null = null;
    let disposed = false;
    const hasTurbo = args.enabled && args.turns.some(turn => turn.characterId && !args.myRoleIds.includes(turn.characterId) && voiceRef.current(turn.characterId)?.engine === 'turbo');
    const preparation = previousDisposal.then(async () => {
      if (!hasTurbo || !args.script || disposed) return;
      const request = await audioRequest(args.script);
      if (disposed) return;
      cached = new PreparedScriptAudio(request);
      await cached.prepare();
    });
    prepareRef.current = preparation;
    // Keep background preparation rejection handled; transport surfaces it on Start.
    void preparation.catch(() => {});
    const speech: SceneSpeaker = {
      speak: async (text, voice, signal, onProgress) => {
        if (voice.engine !== 'turbo') throw new Error('Chatterbox Turbo is the only Quickque speech engine.');
        await preparation;
        if (!cached) throw new Error('Generate saved AI audio in Edit before rehearsing.');
        return cached.speak(text, voice, signal, onProgress);
      },
      stop: async () => { await cached?.stop(); },
    };
    if (!args.enabled) {
      lifecycleRef.current = null;
      setState(idle);
      return () => {
        disposed = true;
        actionGeneration.current++;
        const disposal = chainDisposalBarrier(previousDisposal, async () => {
          try {
            await preparation;
          } catch {
            // Preparation failures are surfaced by Start, not made permanent
            // disposal failures. Teardown still waits for preparation settle.
          }
          await cached?.dispose();
        });
        disposalRef.current = disposal;
        // Keep disposalRef's rejection intact as the replacement barrier,
        // while handling the cleanup promise when React does not await it.
        void disposal.catch(() => {});
      };
    }
    const lifecycle = new SceneLifecycle({
      turns: args.turns,
      myRoleIds: args.myRoleIds,
      voiceForCharacter: id => voiceRef.current(id),
      turnIds: args.turnIds,
      beforeTurnChange: () => beforeTurnChangeRef.current?.() ?? Promise.resolve(),
      speaker: speech,
      beforePartnerSpeak: () => beforeSpeakRef.current?.() ?? Promise.resolve(),
      onChange: setState,
      startIndex: args.startIndex,
      endIndexExclusive: args.endIndexExclusive,
    });
    lifecycleRef.current = lifecycle;
    setState(lifecycle.state);
    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      disposed = true;
      actionGeneration.current++;
      // Invalidate now, before awaiting inherited cleanup. An old handoff can
      // resolve during that wait and must not speak or publish replacement UI.
      const lifecycleDisposal = lifecycle.dispose();
      const disposal = chainDisposalBarrier(previousDisposal, async () => {
        let lifecycleError: unknown;
        try {
          await lifecycleDisposal;
        } catch (error) {
          lifecycleError = error;
        }
        try {
          await preparation;
        } catch {
          // Preparation failures are not teardown failures, but the cleanup
          // must wait for the generation's preparation to settle.
        }
        try {
          await cached?.dispose();
        } catch (error) {
          if (lifecycleError === undefined) lifecycleError = error;
        }
        if (lifecycleError !== undefined) throw lifecycleError;
      });
      disposalRef.current = disposal;
      void disposal.catch(() => {});
    };
    // signature intentionally represents all state that must invalidate speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const preparedAction = async (action: (lifecycle: SceneLifecycle) => Promise<void>) => {
    const generation = ++actionGeneration.current;
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;
    setState({ ...lifecycle.state, phase: 'preparing', message: 'Preparing saved audio…' });
    try {
      await prepareRef.current;
      if (lifecycleRef.current === lifecycle && actionGeneration.current === generation) await action(lifecycle);
    } catch (error) {
      if (lifecycleRef.current === lifecycle && actionGeneration.current === generation) setState({ ...lifecycle.state, phase: 'blocked', message: error instanceof Error ? error.message : String(error) });
    }
  };
  const pauseAction = async (): Promise<void> => {
    const generation = ++actionGeneration.current;
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;
    try {
      await inheritedDisposalRef.current;
      if (lifecycleRef.current !== lifecycle || actionGeneration.current !== generation) return;
      await lifecycle.pause();
    } catch (error) {
      if (lifecycleRef.current !== lifecycle || actionGeneration.current !== generation) return;
      setState({
        ...lifecycle.state,
        phase: 'blocked',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const resetAction = async (): Promise<void> => {
    const generation = ++actionGeneration.current;
    const lifecycle = lifecycleRef.current;
    if (!lifecycle) return;
    try {
      await inheritedDisposalRef.current;
      if (lifecycleRef.current !== lifecycle || actionGeneration.current !== generation) return;
      await lifecycle.reset();
    } catch (error) {
      if (lifecycleRef.current !== lifecycle || actionGeneration.current !== generation) return;
      setState({
        ...lifecycle.state,
        phase: 'blocked',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  return {
    ...state,
    enabled: args.enabled,
    currentTurn: args.enabled && state.phase !== 'completed'
      ? (
        args.turnIds === undefined || (
          args.turnIds.includes(args.turns[state.turnIndex]?.id ?? '') &&
          args.turns.findIndex(turn => turn.id === args.turns[state.turnIndex]?.id) === state.turnIndex &&
          state.turnIndex >= (args.startIndex ?? 0) &&
          state.turnIndex < (args.endIndexExclusive ?? args.turns.length)
        )
          ? args.turns[state.turnIndex] ?? null
          : null
      )
      : null,
    start: () => preparedAction(lifecycle => lifecycle.start()),
    pause: pauseAction,
    next: () => preparedAction(lifecycle => lifecycle.next()),
    goTo: index => preparedAction(lifecycle => lifecycle.goTo(index)),
    previous: () => preparedAction(lifecycle => lifecycle.previous()),
    replay: () => preparedAction(lifecycle => lifecycle.replay()),
    startOver: () => preparedAction(lifecycle => lifecycle.startOver()),
    reset: resetAction,
  };
}

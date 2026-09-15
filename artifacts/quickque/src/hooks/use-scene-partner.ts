import { useLicence } from '@/lib/licence';
import type { Script } from '@/lib/types';
import { audioRequest } from '@/lib/script-audio-model';
import { PreparedScriptAudio } from '@/lib/script-audio';
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
  /** Stable representation of voice/engine settings that changes speech output. */
  voiceSignature: string;
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

const idle: SceneState = { phase: 'idle', turnIndex: 0, generation: 0, message: null, progress: null };

/**
 * React boundary around SceneLifecycle. Rebuilding after an edit deliberately
 * stops the old engine first; no old promise can update the newly built state.
 */
export function useScenePartner(args: UseScenePartnerArgs): ScenePartner {
  const licence = useLicence();
  const [state, setState] = useState<SceneState>(idle);
  const beforeSpeakRef = useRef(args.beforePartnerSpeak);
  beforeSpeakRef.current = args.beforePartnerSpeak;
  const voiceRef = useRef(args.voiceForCharacter);
  voiceRef.current = args.voiceForCharacter;
  const actionGeneration = useRef(0);
  const prepareRef = useRef<Promise<void>>(Promise.resolve());
  const lifecycleRef = useRef<SceneLifecycle | null>(null);

  const signature = useMemo(() => JSON.stringify({
    licensed: licence.licensed,
    scriptId: args.script?.id,
    enabled: args.enabled,
    turns: args.turns.map(turn => [turn.id, turn.content, turn.characterId ?? null]),
    myRoleIds: [...args.myRoleIds].sort(),
    voiceSignature: args.voiceSignature,
    startIndex: args.startIndex ?? 0,
    endIndexExclusive: args.endIndexExclusive ?? args.turns.length,
  }), [
    licence.licensed,
    args.enabled,
    args.script?.id,
    args.turns,
    args.myRoleIds,
    args.voiceSignature,
    args.startIndex,
    args.endIndexExclusive,
  ]);

  useEffect(() => {
    actionGeneration.current++;
    let cached: PreparedScriptAudio | null = null;
    let disposed = false;
    const hasTurbo = args.enabled && args.turns.some(turn => turn.characterId && !args.myRoleIds.includes(turn.characterId) && voiceRef.current(turn.characterId)?.engine === 'turbo');
    const preparation = hasTurbo && args.script ? audioRequest(args.script).then(async request => {
      if (disposed) return;
      cached = new PreparedScriptAudio(request);
      await cached.prepare();
    }) : Promise.resolve();
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
      return () => { disposed = true; void cached?.dispose(); void speech.stop(); };
    }
    const lifecycle = new SceneLifecycle({
      turns: args.turns,
      myRoleIds: args.myRoleIds,
      voiceForCharacter: id => voiceRef.current(id),
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
      void lifecycle.dispose().finally(() => cached?.dispose());
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
  return {
    ...state,
    enabled: args.enabled,
    currentTurn: args.enabled ? args.turns[state.turnIndex] ?? null : null,
    start: () => preparedAction(lifecycle => lifecycle.start()),
    pause: () => { actionGeneration.current++; return lifecycleRef.current?.pause() ?? Promise.resolve(); },
    next: () => preparedAction(lifecycle => lifecycle.next()),
    goTo: index => preparedAction(lifecycle => lifecycle.goTo(index)),
    previous: () => preparedAction(lifecycle => lifecycle.previous()),
    replay: () => preparedAction(lifecycle => lifecycle.replay()),
    startOver: () => preparedAction(lifecycle => lifecycle.startOver()),
    reset: () => { actionGeneration.current++; return lifecycleRef.current?.reset() ?? Promise.resolve(); },
  };
}

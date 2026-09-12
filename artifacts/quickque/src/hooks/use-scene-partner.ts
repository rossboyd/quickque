import { useEffect, useMemo, useRef, useState } from 'react';
import { createSceneSpeech } from '@/lib/scene-speech';
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
  turns: SceneTurn[];
  myRoleIds: readonly string[];
  voiceForCharacter: (characterId: string) => SceneVoice | null;
  /** Stable representation of voice/engine settings that changes speech output. */
  voiceSignature: string;
  beforePartnerSpeak?: () => Promise<void>;
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

const idle: SceneState = { phase: 'idle', turnIndex: 0, generation: 0, message: null };

/**
 * React boundary around SceneLifecycle. Rebuilding after an edit deliberately
 * stops the old engine first; no old promise can update the newly built state.
 */
export function useScenePartner(args: UseScenePartnerArgs): ScenePartner {
  const [state, setState] = useState<SceneState>(idle);
  const beforeSpeakRef = useRef(args.beforePartnerSpeak);
  beforeSpeakRef.current = args.beforePartnerSpeak;
  const voiceRef = useRef(args.voiceForCharacter);
  voiceRef.current = args.voiceForCharacter;
  const lifecycleRef = useRef<SceneLifecycle | null>(null);

  const signature = useMemo(() => JSON.stringify({
    enabled: args.enabled,
    turns: args.turns.map(turn => [turn.id, turn.content, turn.characterId ?? null]),
    myRoleIds: [...args.myRoleIds].sort(),
    voiceSignature: args.voiceSignature,
  }), [args.enabled, args.turns, args.myRoleIds, args.voiceSignature]);

  useEffect(() => {
    const speech = createSceneSpeech() as SceneSpeaker;
    if (!args.enabled) {
      lifecycleRef.current = null;
      setState(idle);
      return () => { void speech.stop(); };
    }
    const lifecycle = new SceneLifecycle({
      turns: args.turns,
      myRoleIds: args.myRoleIds,
      voiceForCharacter: id => voiceRef.current(id),
      speaker: speech,
      beforePartnerSpeak: () => beforeSpeakRef.current?.() ?? Promise.resolve(),
      onChange: setState,
    });
    lifecycleRef.current = lifecycle;
    setState(lifecycle.state);
    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current = null;
      void lifecycle.dispose();
    };
    // signature intentionally represents all state that must invalidate speech.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return {
    ...state,
    enabled: args.enabled,
    currentTurn: args.enabled ? args.turns[state.turnIndex] ?? null : null,
    start: () => lifecycleRef.current?.start() ?? Promise.resolve(),
    pause: () => lifecycleRef.current?.pause() ?? Promise.resolve(),
    next: () => lifecycleRef.current?.next() ?? Promise.resolve(),
    goTo: index => lifecycleRef.current?.goTo(index) ?? Promise.resolve(),
    previous: () => lifecycleRef.current?.previous() ?? Promise.resolve(),
    replay: () => lifecycleRef.current?.replay() ?? Promise.resolve(),
    startOver: () => lifecycleRef.current?.startOver() ?? Promise.resolve(),
    reset: () => lifecycleRef.current?.reset() ?? Promise.resolve(),
  };
}
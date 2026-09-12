import { useEffect, useRef, useState } from 'react';
import {
  PresentationPlayback,
  type PresentationPlaybackState,
} from '@/lib/presentation-playback';
import { createTimer } from '@/lib/presentation-timer';

export interface UsePresentationPlaybackResult {
  controller: PresentationPlayback;
  state: PresentationPlaybackState;
}

/**
 * React binding for PresentationPlayback.
 *
 * The controller is created once and remains imperative/stable across
 * renders. Its effect cleanup disposes it, while the next StrictMode effect
 * setup calls mount() to revive the same instance after React's development
 * cleanup/setup probe.
 */
export function usePresentationPlayback(
  onStart: () => void,
): UsePresentationPlaybackResult {
  const [state, setState] = useState<PresentationPlaybackState>(() => ({
    phase: 'idle',
    countdownSeconds: 0,
    timerState: createTimer(),
  }));
  const stateListenerRef = useRef<(next: PresentationPlaybackState) => void>(
    () => {},
  );
  stateListenerRef.current = setState;

  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;

  const controllerRef = useRef<PresentationPlayback | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new PresentationPlayback({
      now: () => performance.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: timeout => clearTimeout(timeout as ReturnType<typeof setTimeout>),
      onChange: next => stateListenerRef.current(next),
      onStart: () => onStartRef.current(),
    });
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.mount();
    return () => {
      controller.dispose();
    };
  }, [controller]);

  return { controller, state };
}

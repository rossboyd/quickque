import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  createTimer, 
  startTimer, 
  pauseTimer, 
  resetTimer, 
  TimerState 
} from '@/lib/presentation-timer';

export function usePresentationTimer(isActive: boolean, scriptId: string) {
  const [timerState, setTimerState] = useState<TimerState>(createTimer());
  const scriptIdRef = useRef(scriptId);

  // Reset when script session changes
  useEffect(() => {
    if (scriptIdRef.current !== scriptId) {
      scriptIdRef.current = scriptId;
      setTimerState(s => resetTimer(s, performance.now()));
    }
  }, [scriptId]);

  // Start/pause based on active presentation state
  useEffect(() => {
    setTimerState(prev => {
      const now = performance.now();
      if (isActive) {
        return startTimer(prev, now);
      } else {
        return pauseTimer(prev, now);
      }
    });
  }, [isActive]);

  const reset = useCallback(() => {
    setTimerState(prev => resetTimer(prev, performance.now()));
  }, []);

  return { timerState, reset };
}

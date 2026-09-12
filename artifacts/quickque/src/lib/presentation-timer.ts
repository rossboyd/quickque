export interface TimerState {
  elapsedMs: number;
  lastStartedAt: number | null;
}

export function createTimer(): TimerState {
  return { elapsedMs: 0, lastStartedAt: null };
}

export function startTimer(state: TimerState, now: number): TimerState {
  if (state.lastStartedAt !== null) return state;
  return { ...state, lastStartedAt: now };
}

export function pauseTimer(state: TimerState, now: number): TimerState {
  if (state.lastStartedAt === null) return state;
  return {
    elapsedMs: state.elapsedMs + Math.max(0, now - state.lastStartedAt),
    lastStartedAt: null,
  };
}

export function resetTimer(state: TimerState, now: number): TimerState {
  return {
    elapsedMs: 0,
    lastStartedAt: state.lastStartedAt !== null ? now : null,
  };
}

export function getElapsedMs(state: TimerState, now: number): number {
  if (state.lastStartedAt === null) {
    return state.elapsedMs;
  }
  return state.elapsedMs + Math.max(0, now - state.lastStartedAt);
}

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

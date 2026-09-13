export type HydrationPhase = 'pending' | 'ready' | 'error';

export type StartupHydration = {
  settings: HydrationPhase;
  library: HydrationPhase;
  error?: string | null;
};

export type StartupContract =
  | { phase: 'pending'; error: null }
  | { phase: 'ready'; error: null }
  | { phase: 'error'; error: string };

export type WatchdogState =
  | 'healthy'
  | 'reported-error'
  | 'mount-failure'
  | 'hydration-timeout';

const MAX_STARTUP_ERROR_LENGTH = 240;

/**
 * Settings and the native library intentionally have separate lifecycles.
 * Native bridge work may be delayed while cached settings remain usable, and
 * a startup shell must not mistake either lifecycle for a mounted chrome.
 */
export function getStartupContract(state: StartupHydration): StartupContract {
  if (state.settings === 'error' || state.library === 'error') {
    return {
      phase: 'error',
      error: boundStartupError(
        state.error || 'Quickque could not finish loading its local data.',
      ),
    };
  }
  if (state.settings === 'pending' || state.library === 'pending') {
    return { phase: 'pending', error: null };
  }
  return { phase: 'ready', error: null };
}

export function boundStartupError(
  value: unknown,
  fallback = 'Quickque could not finish loading its local data.',
): string {
  const message =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : '';
  const normalized = message.trim() || fallback;
  if (normalized.length <= MAX_STARTUP_ERROR_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_STARTUP_ERROR_LENGTH - 1).trimEnd()}…`;
}

export const STARTUP_ERROR_LIMIT = MAX_STARTUP_ERROR_LENGTH;

export function classifyWatchdogState(state: {
  mounted: boolean;
  ready: boolean;
  reportedError?: boolean;
}): WatchdogState {
  if (state.ready) return 'healthy';
  if (state.reportedError) return 'reported-error';
  return state.mounted ? 'hydration-timeout' : 'mount-failure';
}
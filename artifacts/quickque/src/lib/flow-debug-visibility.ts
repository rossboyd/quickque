import { useSyncExternalStore } from 'react';

const preferenceKey = 'quickque-debug-visible';
const listeners = new Set<() => void>();

function readPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(preferenceKey) === 'true';
  } catch {
    return false;
  }
}

let visible = readPreference();

function emitChange() {
  for (const listener of listeners) listener();
}

export function setFlowDebugVisible(next: boolean): boolean {
  visible = next;
  let saved = true;
  try {
    window.localStorage.setItem(preferenceKey, String(next));
  } catch {
    saved = false;
  }
  emitChange();
  return saved;
}

export function subscribeFlowDebugVisibility(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFlowDebugVisible(): boolean {
  return visible;
}

export function useFlowDebugVisibility(): boolean {
  return useSyncExternalStore(
    subscribeFlowDebugVisibility,
    getFlowDebugVisible,
    () => false,
  );
}
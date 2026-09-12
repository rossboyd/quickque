import { useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './desktop';
export const DEBUG_LICENCE_CHANGED = 'quickque:debug-licence-changed';
const key = 'quickque-debug-licensed';
const listeners = new Set<() => void>();
let state = { licensed: false, loaded: false };
let loading: Promise<void> | null = null;
function publish(licensed: boolean) {
  state = { licensed, loaded: true };
  for (const listener of listeners) listener();
  window.dispatchEvent(new Event(DEBUG_LICENCE_CHANGED));
}
async function load() {
  const licensed = isDesktop() ? await invoke<boolean>('debug_licence_get') : localStorage.getItem(key) === 'true';
  publish(licensed);
}
export async function setDebugLicensed(licensed: boolean) {
  if (loading) await loading;
  const next = isDesktop() ? await invoke<boolean>('debug_licence_set', { licensed }) : licensed;
  if (!isDesktop()) localStorage.setItem(key, String(next));
  publish(next);
}
export function useDebugLicence() {
  const snapshot = useSyncExternalStore(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }, () => state, () => state);
  useEffect(() => {
    loading ??= load().catch(() => { publish(false); });
  }, []);
  return snapshot;
}

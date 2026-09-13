import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop } from './desktop';
import { useDebugLicence } from './debug-licence';
export type LicenceStatus = { status: string; message: string; configured: boolean; testingBypass?: boolean; canRefresh?: boolean; plan?: string; offlineUntil?: number | null; updatesUntil?: number | null; lastChecked?: number | null };
export const LICENCE_UPDATED = 'quickque:licence-updated';
export async function readLicence(): Promise<LicenceStatus> {
  if (!isDesktop()) return { status: 'desktop-required', configured: false, message: 'Activate a licence in the Quickque Mac app.' };
  return invoke<LicenceStatus>('licence_status');
}
export async function licenceOperation(action: 'activate' | 'refresh' | 'deactivate', licenceKey?: string) {
  const result = await invoke<LicenceStatus>(`licence_${action}`, action === 'activate' ? { licenceKey } : undefined);
  window.dispatchEvent(new Event(LICENCE_UPDATED));
  return result;
}
export function useLicence() {
  const bypass = useDebugLicence();
  const [status, setStatus] = useState<LicenceStatus | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void readLicence().then(next => { if (active) setStatus(next); }).catch(() => { if (active) setStatus({ status: 'error', configured: false, message: 'Could not read licence status.' }); }); };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener(LICENCE_UPDATED, refresh);
    const listener = isDesktop() ? listen('licence-changed', refresh).catch(() => () => {}) : Promise.resolve(() => {});
    return () => { active = false; clearInterval(timer); window.removeEventListener(LICENCE_UPDATED, refresh); void listener.then(remove => remove()); };
  }, []);
  return { status, licensed: bypass.licensed || status?.status === 'active', loaded: bypass.loaded && status !== null, testingBypass: bypass.licensed };
}

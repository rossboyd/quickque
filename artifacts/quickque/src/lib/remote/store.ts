import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '../desktop';
import type { RemoteSessionInfo } from './types';

interface RemoteStore {
  isRunning: boolean;
  sessionInfo: RemoteSessionInfo | null;
  serverError: string | null;
  isPending: boolean;
  isConnected: boolean;

  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  approveConnection: () => Promise<void>;
  rejectConnection: () => Promise<void>;
  replaceController: () => Promise<void>;
  
  checkPending: () => Promise<void>;
}

export const useRemoteStore = create<RemoteStore>((set, get) => ({
  isRunning: false,
  sessionInfo: null,
  serverError: null,
  isPending: false,
  isConnected: false,

  startServer: async () => {
    if (!isDesktop()) return;
    try {
      const info = await invoke<RemoteSessionInfo>('remote_start');
      set({ isRunning: true, sessionInfo: info, serverError: null, isPending: false, isConnected: false });
    } catch (e: any) {
      set({ serverError: e.message || String(e), isRunning: false });
    }
  },

  stopServer: async () => {
    if (!isDesktop()) return;
    try {
      await invoke('remote_stop');
    } catch (e) {}
    set({ isRunning: false, sessionInfo: null, isPending: false, isConnected: false });
  },

  approveConnection: async () => {
    const { sessionInfo } = get();
    if (!isDesktop() || !sessionInfo) return;
    try {
      await invoke('remote_approve', { sessionId: sessionInfo.sessionId });
      set({ isPending: false, isConnected: true });
    } catch (e) {
      console.error(e);
    }
  },

  rejectConnection: async () => {
    if (!isDesktop()) return;
    try {
      await invoke('remote_reject');
      set({ isPending: false });
    } catch (e) {
      console.error(e);
    }
  },

  replaceController: async () => {
    await get().stopServer();
    await get().startServer();
  },

  checkPending: async () => {
    if (!isDesktop() || !get().isRunning) return;
    try {
      const pending = await invoke<boolean>('remote_pairing_pending');
      set({ isPending: pending });
    } catch (e) {}
  }
}));
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '../desktop';
import { useRemoteStore } from './store';
import type { RemoteCommand } from './types';

export function useReaderCommands(onCommand: (cmd: RemoteCommand) => void) {
  const { isRunning, isConnected } = useRemoteStore();

  useEffect(() => {
    if (!isDesktop() || !isRunning || !isConnected) return;
    
    let active = true;
    const interval = setInterval(async () => {
       if (!active) return;
       try {
         const commands = await invoke<RemoteCommand[]>('remote_take_commands');
         if (commands && commands.length > 0) {
           for (const cmd of commands) {
             onCommand(cmd);
           }
         }
       } catch (e) {}
    }, 200);
    
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isRunning, isConnected, onCommand]);
}
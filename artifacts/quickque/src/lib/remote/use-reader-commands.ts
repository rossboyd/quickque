import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '../desktop';
import { useRemoteStore } from './store';
import type { RemoteCommand } from './types';

export function useReaderCommands(onCommand: (cmd: RemoteCommand) => void) {
  const { isRunning, isApproved, sessionInfo } = useRemoteStore();
  const sessionId = sessionInfo?.sessionId;

  useEffect(() => {
    // Authorization survives a transient heartbeat disconnect. Keep draining
    // the desktop queue while approved so commands received during that
    // interruption are handled as soon as the remote service reconnects.
    if (!isDesktop() || !isRunning || !isApproved || !sessionId) return;
    
    let active = true;
    let polling = false;
    const interval = setInterval(async () => {
       if (!active || polling) return;
       polling = true;
       try {
         const commands = await invoke<RemoteCommand[]>('remote_take_commands');
         const current = useRemoteStore.getState();
         if (!active || !current.isApproved || current.isStopping ||
             current.isReplacing || current.sessionInfo?.sessionId !== sessionId) return;
         if (commands && commands.length > 0) {
           for (const cmd of commands) {
             onCommand(cmd);
           }
         }
       } catch (e) {
         console.error('Could not receive local remote commands', e);
       } finally {
         polling = false;
       }
    }, 200);
    
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isRunning, isApproved, sessionId, onCommand]);
}
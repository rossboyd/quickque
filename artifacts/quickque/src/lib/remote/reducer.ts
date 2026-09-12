import type { RemoteCommandAction } from './types';

export type CommandEffect = 
  | { type: 'setPlaying', playing: boolean }
  | { type: 'flowStart' }
  | { type: 'flowPause' }
  | { type: 'jumpToSection', index: number }
  | { type: 'setSpeed', speed: number }
  | { type: 'setFontSize', fontSize: number }
  | { type: 'adjustPosition', delta: number }
  | { type: 'setReadMode', mode: 'manual' | 'flow' }
  | null;

export function resolveCommandEffect(
  cmd: { action?: string, detail?: string, type?: string, value?: number, mode?: 'manual' | 'flow' }, 
  context: {
    readMode: 'manual' | 'flow';
    /** Scene transport is independent of optional recognition readiness. */
    sceneEnabled?: boolean;
    isPlaying: boolean;
    playbackPhase?: string;
    flowStatus: string;
    activeSectionIdx: number;
    sectionCount: number;
    speed: number;
    fontSize: number;
  }
): CommandEffect {
  const action = cmd.action || cmd.detail || ({
    TogglePlay: 'playPause',
    NextSection: 'next',
    PreviousSection: 'previous',
  } as Record<string, string>)[cmd.type || ''];
  const value = cmd.value;

  switch (action) {
    case 'playPause':
    case 'toggle':
      if (context.sceneEnabled) {
        return { type: 'setPlaying', playing: !context.isPlaying };
      }
      if (context.playbackPhase === 'countdown' || context.playbackPhase === 'starting') {
        return context.readMode === 'manual'
          ? { type: 'setPlaying', playing: false }
          : { type: 'flowPause' };
      }
      if (context.readMode === 'manual') {
        return { type: 'setPlaying', playing: !context.isPlaying };
      } else {
        if (context.flowStatus === 'listening' || context.flowStatus === 'loading') {
          return { type: 'flowPause' };
        } else if (['ready', 'paused', 'silence-stopped', 'stopped', 'error'].includes(context.flowStatus)) {
          return { type: 'flowStart' };
        }
      }
      break;
    case 'next':
      if (context.activeSectionIdx < context.sectionCount - 1) {
        return { type: 'jumpToSection', index: context.activeSectionIdx + 1 };
      }
      break;
    case 'previous':
      if (context.activeSectionIdx > 0) {
        return { type: 'jumpToSection', index: context.activeSectionIdx - 1 };
      }
      break;
    case 'scrollSpeed':
      if (context.sceneEnabled) break;
      if (context.readMode === 'manual' && typeof value === 'number') {
        return { type: 'setSpeed', speed: Math.max(10, Math.min(150, context.speed + value)) };
      }
      break;
    case 'fontSize':
      if (typeof value === 'number') {
        return { type: 'setFontSize', fontSize: Math.max(16, Math.min(120, context.fontSize + value)) };
      }
      break;
    case 'position':
      if (context.sceneEnabled) break;
      if (context.readMode === 'manual' && typeof value === 'number') {
        return { type: 'adjustPosition', delta: value };
      }
      break;
    case 'jumpToSection':
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < context.sectionCount) {
        return { type: 'jumpToSection', index: value };
      }
      break;
    case 'setReadMode':
      if (cmd.mode === 'manual' || cmd.mode === 'flow') {
        return { type: 'setReadMode', mode: cmd.mode };
      }
      break;
  }
  return null;
}
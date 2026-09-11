export type RemoteSessionInfo = {
  url: string;
  code: string;
  expiresInSeconds: number;
  sessionId: string;
};

export type RemoteSnapshot = {
  mode: 'manual' | 'flow';
  section: number;
  sectionCount: number;
  elapsedMs: number;
  playing: boolean;
  fontSize: number;
  scrollSpeed: number;
  position: number;
};

export type RemoteCommandAction = 'playPause' | 'previous' | 'next' | 'scrollSpeed' | 'fontSize' | 'position';

export type RemoteCommand = {
  action: RemoteCommandAction;
  value?: number;
  requestId: string;
};
/**
 * Information needed to pair a phone with the desktop remote.
 *
 * `pairingUrl` is supplied by the desktop service and is the only value that
 * should be encoded in the QR code. In particular, clients must not derive a
 * URL by appending the pairing code to `url`: the service may change the
 * pairing route or include additional session information in that URL.
 */
export type RemoteInfo = {
  url: string;
  pairingUrl: string;
  code: string;
  expiresInSeconds: number;
  sessionId: string;
};

/** @deprecated Use RemoteInfo. Kept for callers that still use the old name. */
export type RemoteSessionInfo = RemoteInfo;

export type RemoteStatus =
  | 'stopped'
  | 'awaitingScan'
  | 'awaitingApproval'
  | 'connected'
  | 'disconnected'
  | 'rejected'
  | 'expired';

export type RemoteStatusResponse = {
  status: RemoteStatus;
  sessionInfo: RemoteInfo | null;
  approved: boolean;
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
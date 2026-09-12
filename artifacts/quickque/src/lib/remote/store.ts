import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop as detectDesktop } from '../desktop.ts';
import type {
  RemoteInfo,
  RemoteStatus,
  RemoteStatusResponse,
} from './types';

export type RemoteInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export type RemoteStoreDependencies = {
  /**
   * Injectable for lifecycle tests. The application uses Tauri's invoke
   * implementation by default.
   */
  invoke?: RemoteInvoke;
  isDesktop?: () => boolean;
};

export interface RemoteStore {
  status: RemoteStatus;
  sessionInfo: RemoteInfo | null;
  serverError: string | null;
  isRunning: boolean;
  isPending: boolean;
  isConnected: boolean;
  /** Authorization state is deliberately separate from live connectivity. */
  isApproved: boolean;
  isStarting: boolean;
  isStopping: boolean;
  isReplacing: boolean;

  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  approveConnection: () => Promise<void>;
  rejectConnection: () => Promise<void>;
  replaceController: () => Promise<void>;
  /** Alias used by the QR-first dialog for an explicit new pairing. */
  newQr: () => Promise<void>;
  checkStatus: () => Promise<void>;
}

type OperationName =
  | 'start'
  | 'stop'
  | 'replace'
  | 'approve'
  | 'reject';

type RemoteErrorKind = 'poll' | 'mutation' | null;

const initialState: Pick<
  RemoteStore,
  | 'status'
  | 'sessionInfo'
  | 'serverError'
  | 'isRunning'
  | 'isPending'
  | 'isConnected'
  | 'isApproved'
  | 'isStarting'
  | 'isStopping'
  | 'isReplacing'
> = {
  status: 'stopped',
  sessionInfo: null,
  serverError: null,
  isRunning: false,
  isPending: false,
  isConnected: false,
  isApproved: false,
  isStarting: false,
  isStopping: false,
  isReplacing: false,
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Creates a store with a small dependency-injection seam. Keeping the
 * lifecycle here (rather than in the dialog) means closing the dialog cannot
 * stop polling or lose a session, and makes stale async responses testable.
 */
export function createRemoteStore(
  dependencies: RemoteStoreDependencies = {},
) {
  const invokeCommand: RemoteInvoke =
    dependencies.invoke ??
    ((command, args) => invoke(command, args));
  const desktop = dependencies.isDesktop ?? detectDesktop;

  // All mutating commands share one queue. Calls of the same kind return the
  // same promise; calls of different kinds are serialized in call order.
  let mutationQueue: Promise<void> = Promise.resolve();
  const inFlight: Partial<Record<OperationName, Promise<void>>> = {};

  // Every mutation invalidates status/start responses already in flight. This
  // is what prevents a late remote_start or remote_status response from
  // resurrecting a session after replace/stop.
  let lifecycleVersion = 0;
  let statusRequestSequence = 0;
  let statusInFlight:
    | { version: number; promise: Promise<void> }
    | undefined;
  let errorKind: RemoteErrorKind = null;

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const operation = mutationQueue.then(job, job);
    mutationQueue = operation.catch(() => undefined);
    return operation;
  };

  const remember = (name: OperationName, operation: Promise<void>) => {
    inFlight[name] = operation;
    operation.then(
      () => {
        if (inFlight[name] === operation) delete inFlight[name];
      },
      () => {
        if (inFlight[name] === operation) delete inFlight[name];
      },
    );
    return operation;
  };

  const store = create<RemoteStore>((set, get) => {
    const isCurrent = (version: number, sessionId?: string) => {
      if (version !== lifecycleVersion) return false;
      if (sessionId === undefined) return true;
      return get().sessionInfo?.sessionId === sessionId;
    };

    const clearError = () => {
      errorKind = null;
      set({ serverError: null });
    };

    const recordError = (
      kind: Exclude<RemoteErrorKind, null>,
      error: unknown,
    ) => {
      // A transient status failure must not replace an actionable startup or
      // mutation error (for example, "no reachable LAN address").
      if (kind === 'poll' && errorKind === 'mutation') return;
      errorKind = kind;
      set({ serverError: errorMessage(error) });
    };

    const applyStatus = (snapshot: RemoteStatusResponse) => {
      const running = snapshot.status !== 'stopped';
      const recoveredPoll = errorKind === 'poll';
      if (recoveredPoll) errorKind = null;
      set({
        status: snapshot.status,
        sessionInfo: snapshot.sessionInfo,
        ...(recoveredPoll ? { serverError: null } : {}),
        isRunning: running,
        isPending: snapshot.status === 'awaitingApproval',
        isConnected: snapshot.status === 'connected',
        isApproved: snapshot.approved,
      });
    };

    const checkStatus = (force = false): Promise<void> => {
      if (!desktop()) return Promise.resolve();
      // A regular poll must not race a replace/stop/start command. In
      // particular, a poll begun after replace was requested but before its
      // remote_stop completes could otherwise put the old QR back on screen.
      // Mutations use `force` for their post-command refresh.
      if (
        !force &&
        (get().isStarting || get().isStopping || get().isReplacing)
      ) {
        return Promise.resolve();
      }

      const version = lifecycleVersion;
      if (!force && statusInFlight?.version === version) {
        return statusInFlight.promise;
      }

      const sequence = ++statusRequestSequence;
      const operation = invokeCommand<RemoteStatusResponse>('remote_status')
        .then((snapshot) => {
          // A mutation may have replaced the session while this request was
          // on the wire. Also ignore an older poll than the latest response.
          if (
            !isCurrent(version) ||
            sequence !== statusRequestSequence
          ) {
            return;
          }
          applyStatus(snapshot);
        })
        .catch((error: unknown) => {
          if (!isCurrent(version) || sequence !== statusRequestSequence) {
            return;
          }
          recordError('poll', error);
        })
        .finally(() => {
          if (statusInFlight?.promise === operation) {
            statusInFlight = undefined;
          }
        });

      statusInFlight = { version, promise: operation };
      return operation;
    };

    const startServer = (): Promise<void> => {
      if (!desktop()) return Promise.resolve();
      const existing = inFlight.start;
      if (existing) return existing;

      const current = get();
      // Opening the dialog again should preserve a live session. A status
      // refresh is enough; calling start here would briefly replace the
      // visible QR and needlessly race the poller.
      if (current.isRunning && current.sessionInfo) {
        return checkStatus();
      }

      const version = ++lifecycleVersion;
      clearError();
      set({
        isStarting: true,
        isStopping: false,
        isReplacing: false,
        serverError: null,
      });

      const operation = enqueue(async () => {
        try {
          const info = await invokeCommand<RemoteInfo>('remote_start');
          if (!isCurrent(version)) return;

          clearError();
          const previous = get();
          const sameSession =
            previous.sessionInfo?.sessionId === info.sessionId;
          set({
            status: sameSession && previous.isRunning
              ? previous.status
              : 'awaitingScan',
            sessionInfo: info,
            serverError: null,
            isRunning: true,
            isPending: sameSession
              ? previous.isPending
              : false,
            isConnected: sameSession
              ? previous.isConnected
              : false,
            isApproved: sameSession
              ? previous.isApproved
              : false,
          });
          await checkStatus(true);
        } catch (error: unknown) {
          if (!isCurrent(version)) return;
          recordError('mutation', error);
          set({
            status: 'stopped',
            sessionInfo: null,
            isRunning: false,
            isPending: false,
            isConnected: false,
            isApproved: false,
          });
        } finally {
          if (isCurrent(version)) {
            set({ isStarting: false });
          }
        }
      });

      return remember('start', operation);
    };

    const stopServer = (): Promise<void> => {
      if (!desktop()) return Promise.resolve();
      const existing = inFlight.stop;
      if (existing) return existing;

      const version = ++lifecycleVersion;
      clearError();
      set({
        isStopping: true,
        isStarting: false,
        isReplacing: false,
        serverError: null,
      });

      const operation = enqueue(async () => {
        try {
          await invokeCommand('remote_stop');
          if (!isCurrent(version)) return;
          clearError();
          set({ ...initialState });
        } catch (error: unknown) {
          if (!isCurrent(version)) return;
          recordError('mutation', error);
          set({
            isStopping: false,
          });
        }
      });

      return remember('stop', operation);
    };

    const approveConnection = (): Promise<void> => {
      if (!desktop()) return Promise.resolve();
      const existing = inFlight.approve;
      if (existing) return existing;

      const sessionId = get().sessionInfo?.sessionId;
      if (!sessionId) return Promise.resolve();
      const version = lifecycleVersion;

      const operation = enqueue(async () => {
        try {
          if (!isCurrent(version, sessionId)) return;
          clearError();
          await invokeCommand('remote_approve', { sessionId });
          if (!isCurrent(version, sessionId)) return;
          clearError();
          set({ isApproved: true, serverError: null });
          await checkStatus(true);
        } catch (error: unknown) {
          if (!isCurrent(version, sessionId)) return;
          recordError('mutation', error);
        }
      });

      return remember('approve', operation);
    };

    const rejectConnection = (): Promise<void> => {
      if (!desktop()) return Promise.resolve();
      const existing = inFlight.reject;
      if (existing) return existing;

      const version = lifecycleVersion;
      const sessionId = get().sessionInfo?.sessionId;
      const operation = enqueue(async () => {
        try {
          if (!isCurrent(version, sessionId)) return;
          clearError();
          // remote_reject intentionally has no arguments.
          await invokeCommand('remote_reject');
          if (!isCurrent(version, sessionId)) return;
          clearError();
          set({ isPending: false, serverError: null });
          await checkStatus(true);
        } catch (error: unknown) {
          if (!isCurrent(version, sessionId)) return;
          recordError('mutation', error);
        }
      });

      return remember('reject', operation);
    };

    const replaceController = (): Promise<void> => {
      if (!desktop()) return Promise.resolve();
      const existing = inFlight.replace;
      if (existing) return existing;

      // Invalidate a start/status response immediately, before the queued
      // stop runs. Otherwise that response could restore the old QR.
      const version = ++lifecycleVersion;
      clearError();
      set({
        status: 'stopped',
        sessionInfo: null,
        serverError: null,
        isRunning: false,
        isPending: false,
        isConnected: false,
        isApproved: false,
        isStarting: true,
        isStopping: false,
        isReplacing: true,
      });

      const operation = enqueue(async () => {
        try {
          await invokeCommand('remote_stop');
          if (!isCurrent(version)) return;

          const info = await invokeCommand<RemoteInfo>('remote_start');
          if (!isCurrent(version)) return;
          clearError();
          set({
            status: 'awaitingScan',
            sessionInfo: info,
            serverError: null,
            isRunning: true,
            isPending: false,
            isConnected: false,
            isApproved: false,
          });
          await checkStatus(true);
        } catch (error: unknown) {
          if (!isCurrent(version)) return;
          recordError('mutation', error);
          set({
            status: 'stopped',
            sessionInfo: null,
            isRunning: false,
            isPending: false,
            isConnected: false,
            isApproved: false,
          });
        } finally {
          if (isCurrent(version)) {
            set({ isStarting: false, isReplacing: false });
          }
        }
      });

      return remember('replace', operation);
    };

    return {
      ...initialState,
      startServer,
      stopServer,
      approveConnection,
      rejectConnection,
      replaceController,
      newQr: replaceController,
      checkStatus,
    };
  });

  return store;
}

export const useRemoteStore = createRemoteStore();

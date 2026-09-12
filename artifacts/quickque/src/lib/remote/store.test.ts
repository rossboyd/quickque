import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteStore } from './store.ts';
import type { RemoteInfo, RemoteStatusResponse } from './types.ts';

const firstInfo: RemoteInfo = {
  url: 'http://192.168.1.20:4310/',
  pairingUrl: 'http://192.168.1.20:4310/pair?session=first',
  code: '111111',
  expiresInSeconds: 300,
  sessionId: 'first',
};

const secondInfo: RemoteInfo = {
  ...firstInfo,
  pairingUrl: 'http://192.168.1.20:4310/pair?session=second',
  code: '222222',
  sessionId: 'second',
};

function status(
  sessionInfo: RemoteInfo | null,
  statusName: RemoteStatusResponse['status'] = sessionInfo
    ? 'awaitingScan'
    : 'stopped',
): RemoteStatusResponse {
  return {
    status: statusName,
    sessionInfo,
    approved: statusName === 'connected',
  };
}

describe('remote desktop lifecycle', () => {
  it('deduplicates concurrent starts and refreshes the status', async () => {
    const calls: string[] = [];
    const store = createRemoteStore({
      isDesktop: () => true,
      invoke: async <T>(command: string) => {
        calls.push(command);
        if (command === 'remote_start') return firstInfo as T;
        if (command === 'remote_status') return status(firstInfo) as T;
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    const firstStart = store.getState().startServer();
    const secondStart = store.getState().startServer();
    assert.strictEqual(firstStart, secondStart);
    await firstStart;

    assert.equal(calls.filter((command) => command === 'remote_start').length, 1);
    assert.equal(store.getState().sessionInfo?.sessionId, firstInfo.sessionId);
    assert.equal(store.getState().status, 'awaitingScan');
  });

  it('does not let an old start response resurrect state during replace', async () => {
    const calls: string[] = [];
    let releaseFirstStart!: (info: RemoteInfo) => void;
    const firstStartResponse = new Promise<RemoteInfo>((resolve) => {
      releaseFirstStart = resolve;
    });
    let startCount = 0;

    const store = createRemoteStore({
      isDesktop: () => true,
      invoke: async <T>(command: string) => {
        calls.push(command);
        if (command === 'remote_start') {
          startCount += 1;
          return (startCount === 1
            ? await firstStartResponse
            : secondInfo) as T;
        }
        if (command === 'remote_stop') return undefined as T;
        if (command === 'remote_status') return status(secondInfo) as T;
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    const start = store.getState().startServer();
    const replace = store.getState().replaceController();
    releaseFirstStart(firstInfo);
    await Promise.all([start, replace]);

    assert.deepEqual(
      calls.filter((command) => command === 'remote_start').length,
      2,
    );
    assert.deepEqual(
      calls.filter((command) => command === 'remote_stop').length,
      1,
    );
    assert.equal(store.getState().sessionInfo?.sessionId, secondInfo.sessionId);
    assert.equal(store.getState().status, 'awaitingScan');
  });

  it('uses the backend approval and reject contracts exactly', async () => {
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    const store = createRemoteStore({
      isDesktop: () => true,
      invoke: async <T>(command: string, args?: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'remote_approve') return undefined as T;
        if (command === 'remote_reject') return undefined as T;
        if (command === 'remote_status') {
          return status(firstInfo, 'connected') as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });
    // Seed the store through the normal state transition, avoiding a test-only
    // setState mutation that would skip the session-id guard.
    store.setState({
      status: 'awaitingApproval',
      sessionInfo: firstInfo,
      isRunning: true,
      isPending: true,
    });

    await store.getState().approveConnection();
    assert.deepEqual(
      calls.find((call) => call.command === 'remote_approve'),
      { command: 'remote_approve', args: { sessionId: firstInfo.sessionId } },
    );

    await store.getState().rejectConnection();
    assert.deepEqual(
      calls.find((call) => call.command === 'remote_reject'),
      { command: 'remote_reject', args: undefined },
    );
  });

  it('preserves a no-LAN startup error until retry succeeds', async () => {
    let startAttempts = 0;
    const store = createRemoteStore({
      isDesktop: () => true,
      invoke: async <T>(command: string) => {
        if (command === 'remote_start') {
          startAttempts += 1;
          if (startAttempts === 1) {
            throw new Error('No reachable LAN address');
          }
          return firstInfo as T;
        }
        if (command === 'remote_status') {
          return (startAttempts > 1
            ? status(firstInfo)
            : status(null)) as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });

    await store.getState().startServer();
    assert.equal(store.getState().serverError, 'No reachable LAN address');

    // A successful stopped status is not a successful startup retry and must
    // not erase the actionable error shown by the dialog.
    await store.getState().checkStatus();
    assert.equal(store.getState().serverError, 'No reachable LAN address');

    await store.getState().startServer();
    assert.equal(store.getState().serverError, null);
    assert.equal(store.getState().sessionInfo?.sessionId, firstInfo.sessionId);
  });

  it('does not send a queued reject after its session was replaced', async () => {
    let releaseFirstStop!: () => void;
    const firstStop = new Promise<void>((resolve) => {
      releaseFirstStop = resolve;
    });
    let stopCalls = 0;
    let rejectCalls = 0;
    const store = createRemoteStore({
      isDesktop: () => true,
      invoke: async <T>(command: string) => {
        if (command === 'remote_stop') {
          stopCalls += 1;
          if (stopCalls === 1) await firstStop;
          return undefined as T;
        }
        if (command === 'remote_reject') {
          rejectCalls += 1;
          return undefined as T;
        }
        if (command === 'remote_start') return secondInfo as T;
        if (command === 'remote_status') return status(secondInfo) as T;
        throw new Error(`Unexpected command: ${command}`);
      },
    });
    store.setState({
      status: 'awaitingApproval',
      sessionInfo: firstInfo,
      isRunning: true,
      isPending: true,
    });

    const stop = store.getState().stopServer();
    const reject = store.getState().rejectConnection();
    const replace = store.getState().replaceController();
    releaseFirstStop();
    await Promise.all([stop, reject, replace]);

    assert.equal(rejectCalls, 0);
    assert.equal(store.getState().sessionInfo?.sessionId, secondInfo.sessionId);
  });
});

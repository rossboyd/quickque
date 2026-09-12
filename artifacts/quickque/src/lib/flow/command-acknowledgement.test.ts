import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeAcknowledgedFlowCommand } from './command-acknowledgement.ts';
import { SceneLifecycle } from '../scene-lifecycle.ts';

test('real Flow command acknowledgement path blocks partner speech on native stop failure', async () => {
  const commands: string[] = [];
  let errorReported = false;
  let spoken = false;
  const scene = new SceneLifecycle({
    turns: [{ id: 'turn', characterId: 'partner', content: 'synthetic test line' }],
    myRoleIds: [],
    voiceForCharacter: () => ({ engine: 'system', voiceId: 'local', rate: 1 }),
    speaker: {
      stop: async () => {},
      speak: async () => { spoken = true; },
    },
    // This is the same executor used by useLocalFlow.stopAndWait(), including
    // its UI error reporting callback. A native bridge failure is injected,
    // not a preconstructed rejecting beforePartnerSpeak test double.
    beforePartnerSpeak: () => invokeAcknowledgedFlowCommand(
      { action: 'stop', generation: 10 },
      async command => {
        commands.push(command.action);
        throw new Error('native stop failed');
      },
      () => { errorReported = true; },
    ),
  });
  await scene.start();
  assert.deepEqual(commands, ['stop']);
  assert.equal(errorReported, true);
  assert.equal(spoken, false);
  assert.equal(scene.state.phase, 'blocked');
  assert.match(scene.state.message ?? '', /microphone|stop|acknowledged/i);
});

test('inactive/stale UI reporting cannot convert failed native shutdown into success', async () => {
  await assert.rejects(invokeAcknowledgedFlowCommand(
    { action: 'stop', generation: 11 },
    async () => { throw new Error('sensitive native detail'); },
    () => { /* Component stale: intentionally no UI update. */ },
  ), error => error instanceof Error &&
    error.message.includes('not acknowledged') &&
    !error.message.includes('sensitive'));
});

test('Flow acknowledgement remains pending until the actual native stop resolves', async () => {
  let acknowledge!: () => void;
  let resolved = false;
  const nativeStop = new Promise<void>(resolve => { acknowledge = resolve; });
  const barrier = invokeAcknowledgedFlowCommand(
    { action: 'stop', generation: 12 }, () => nativeStop, () => {},
  ).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  acknowledge();
  await barrier;
  assert.equal(resolved, true);
});
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SceneLifecycle, type SceneSpeaker, type SceneVoice } from './scene-lifecycle.ts';

const voice: SceneVoice = { engine: 'system', voiceId: 'local', rate: 1 };
const turns = [
  { id: 'partner-1', content: 'Partner one', characterId: 'partner' },
  { id: 'mine', content: 'My line', characterId: 'mine' },
  { id: 'partner-2', content: 'Partner two', characterId: 'partner' },
];
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

class DeferredSpeaker implements SceneSpeaker {
  calls: string[] = [];
  stops = 0;
  private pending: { resolve: () => void; reject: (error: Error) => void; progress?: (value: { charStart: number; charEnd: number }) => void }[] = [];

  speak(text: string, _voice: SceneVoice, signal: AbortSignal, progress?: (value: { charStart: number; charEnd: number }) => void): Promise<void> {
    this.calls.push(text);
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      this.pending.push({ resolve, reject, progress });
    });
  }

  stop(): Promise<void> {
    this.stops += 1;
    return Promise.resolve();
  }

  finish(call: number): void {
    this.pending[call]?.resolve();
  }

  report(call: number, charStart: number, charEnd: number): void {
    this.pending[call]?.progress?.({ charStart, charEnd });
  }
}

test('partner progress is bounded to the active generation and cleared on pause', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });
  void scene.start();
  await flush();
  speaker.report(0, 0, 7);
  assert.deepEqual(scene.state.progress, { charStart: 0, charEnd: 7 });
  await scene.pause();
  assert.equal(scene.state.progress, null);
  speaker.report(0, 8, 11);
  assert.equal(scene.state.progress, null, 'late progress from the paused turn is ignored');
});

test('scene lifecycle waits on actor turns and never speaks an assigned role', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });

  void scene.start();
  await flush();
  assert.equal(scene.state.phase, 'speaking');
  assert.deepEqual(speaker.calls, ['Partner one']);
  speaker.finish(0);
  await flush();
  assert.equal(scene.state.phase, 'waiting');
  assert.equal(scene.state.turnIndex, 1);

  void scene.next();
  await flush();
  assert.equal(scene.state.phase, 'speaking');
  assert.deepEqual(speaker.calls, ['Partner one', 'Partner two']);
});

test('navigation invalidates a late partner completion instead of advancing a newer turn', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });

  void scene.start();
  await flush();
  await scene.next();
  assert.equal(scene.state.phase, 'waiting');
  assert.equal(scene.state.turnIndex, 1);
  speaker.finish(0);
  await flush();
  assert.equal(scene.state.turnIndex, 1);
  assert.equal(scene.state.phase, 'waiting');
});

test('pause/resume deterministically replays the interrupted partner line', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
  });

  void scene.start();
  await flush();
  await scene.pause();
  assert.equal(scene.state.phase, 'paused');
  void scene.start();
  await flush();
  assert.deepEqual(speaker.calls, ['Partner one', 'Partner one']);
  assert.equal(scene.state.phase, 'speaking');
});

test('unassigned turns are blocked and never delivered to speech', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [{ id: 'unassigned', content: 'Do not say this', characterId: null }],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
  });
  await scene.start();
  assert.equal(scene.state.phase, 'blocked');
  assert.match(scene.state.message ?? '', /unassigned/i);
  assert.deepEqual(speaker.calls, []);
});

test('partner speech waits for the Flow hard-stop acknowledgement', async () => {
  const speaker = new DeferredSpeaker();
  let releaseMicrophone: (() => void) | undefined;
  const microphoneStopped = new Promise<void>(resolve => { releaseMicrophone = resolve; });
  const scene = new SceneLifecycle({
    turns: [{ id: 'partner', content: 'Wait for microphone', characterId: 'partner' }],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
    beforePartnerSpeak: () => microphoneStopped,
  });

  void scene.start();
  await flush();
  assert.equal(scene.state.phase, 'preparing');
  assert.deepEqual(speaker.calls, []);
  releaseMicrophone?.();
  await flush();
  assert.equal(scene.state.phase, 'speaking');
  assert.deepEqual(speaker.calls, ['Wait for microphone']);
});

test('no selected roles is a full read-through and finishes consecutive partner turns', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: turns.slice(0, 2),
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
  });
  void scene.start();
  await flush();
  speaker.finish(0);
  await flush();
  assert.deepEqual(speaker.calls, ['Partner one', 'My line']);
  speaker.finish(1);
  await flush();
  assert.equal(scene.state.phase, 'completed');
  assert.equal(scene.state.turnIndex, 2);
});

test('all selected roles is a silent cue reader through consecutive actor turns', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: ['partner', 'mine'],
    voiceForCharacter: () => voice,
    speaker,
  });
  await scene.start();
  assert.equal(scene.state.phase, 'waiting');
  await scene.next();
  assert.equal(scene.state.phase, 'waiting');
  await scene.next();
  assert.equal(scene.state.phase, 'waiting');
  await scene.next();
  assert.equal(scene.state.phase, 'completed');
  assert.deepEqual(speaker.calls, []);
});

test('consecutive actor turns remain waiting before the next partner begins', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [
      { id: 'mine-1', content: 'One', characterId: 'mine' },
      { id: 'mine-2', content: 'Two', characterId: 'mine' },
      { id: 'partner', content: 'Three', characterId: 'partner' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });
  await scene.start();
  await scene.next();
  assert.equal(scene.state.turnIndex, 1);
  assert.equal(scene.state.phase, 'waiting');
  void scene.next();
  await flush();
  assert.equal(scene.state.phase, 'speaking');
  assert.deepEqual(speaker.calls, ['Three']);
});

test('an empty scene completes without asking speech to speak', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
  });
  await scene.start();
  assert.equal(scene.state.phase, 'completed');
  assert.deepEqual(speaker.calls, []);
});

test('speech and hard-stop failures close the scene with actionable errors', async () => {
  const speechFailure: SceneSpeaker = {
    stop: async () => {},
    speak: async () => { throw new Error('voice device unavailable'); },
  };
  const failedSpeech = new SceneLifecycle({
    turns: [turns[0]],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker: speechFailure,
  });
  await failedSpeech.start();
  assert.equal(failedSpeech.state.phase, 'blocked');
  assert.match(failedSpeech.state.message ?? '', /voice device unavailable/);

  let spoke = false;
  const stopFailure: SceneSpeaker = {
    stop: async () => { throw new Error('native audio still active'); },
    speak: async () => { spoke = true; },
  };
  const failedStop = new SceneLifecycle({
    turns: [turns[0]],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker: stopFailure,
  });
  await failedStop.start();
  assert.equal(failedStop.state.phase, 'blocked');
  assert.match(failedStop.state.message ?? '', /did not stop.*native audio still active/i);
  assert.equal(spoke, false);
});

test('a rejected microphone handoff stays blocked and never starts partner speech', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [turns[0]],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
    beforePartnerSpeak: async () => { throw new Error('Flow helper did not exit'); },
  });
  await scene.start();
  assert.equal(scene.state.phase, 'blocked');
  assert.match(scene.state.message ?? '', /microphone did not stop.*Flow helper did not exit/i);
  assert.deepEqual(speaker.calls, []);
});

test('paused navigation only changes the cue and does not restart speech', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });
  void scene.start();
  await flush();
  await scene.pause();
  await scene.next();
  assert.equal(scene.state.phase, 'paused');
  assert.equal(scene.state.turnIndex, 1);
  assert.deepEqual(speaker.calls, ['Partner one']);
});

test('a bounded passage starts and completes at its selected turn limits', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns,
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
    startIndex: 1,
    endIndexExclusive: 2,
  });
  assert.equal(scene.state.turnIndex, 1);
  await scene.start();
  assert.equal(scene.state.phase, 'waiting');
  await scene.next();
  assert.equal(scene.state.phase, 'completed');
  assert.equal(scene.state.turnIndex, 2);
  await scene.startOver();
  assert.equal(scene.state.turnIndex, 1);
  assert.deepEqual(speaker.calls, []);
});
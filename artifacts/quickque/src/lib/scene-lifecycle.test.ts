import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainDisposalBarrier } from './disposal-barrier.ts';
import { SceneLifecycle, type SceneSpeaker, type SceneVoice } from './scene-lifecycle.ts';

const voice: SceneVoice = { engine: 'system', voiceId: 'local', rate: 1 };
const turns = [
  { id: 'partner-1', content: 'Partner one', characterId: 'partner' },
  { id: 'mine', content: 'My line', characterId: 'mine' },
  { id: 'partner-2', content: 'Partner two', characterId: 'partner' },
];
const flush = async () => {
  // A transition now crosses a serialized stop barrier and (optionally) a
  // microphone barrier. Let the current microtask graph drain at the next
  // turn of the event loop instead of depending on an arbitrary promise
  // depth.
  await new Promise<void>(resolve => setImmediate(resolve));
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

class DelayedStopSpeaker extends DeferredSpeaker {
  private pendingStops: (() => void)[] = [];
  private delayStops = false;

  delayNextStop(): void {
    this.delayStops = true;
  }

  releaseStop(): void {
    this.pendingStops.shift()?.();
  }

  override stop(): Promise<void> {
    this.stops += 1;
    if (!this.delayStops) return Promise.resolve();
    this.delayStops = false;
    return new Promise(resolve => this.pendingStops.push(resolve));
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

test('bookmark queues resolve in script order, retain coordinates, and skip removed IDs', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [
      { id: 'first', content: 'First', characterId: 'mine' },
      { id: 'second', content: 'Second', characterId: 'mine' },
      { id: 'third', content: 'Third', characterId: 'mine' },
      { id: 'fourth', content: 'Fourth', characterId: 'mine' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
    turnIds: ['missing', 'fourth', 'first', 'fourth'],
  });

  assert.equal(scene.state.turnIndex, 0);
  await scene.start();
  assert.equal(scene.state.phase, 'waiting');
  await scene.next();
  assert.equal(scene.state.turnIndex, 3);
  assert.deepEqual(scene.state.completedTurnIds, ['first']);
  await scene.next();
  assert.equal(scene.state.phase, 'completed');
  assert.equal(scene.state.turnIndex, 4);
  assert.deepEqual(scene.state.completedTurnIds, ['first', 'fourth']);

  await scene.goTo(1);
  assert.equal(scene.state.turnIndex, 3, 'a jump into the gap selects the next bookmark');
  assert.equal(scene.state.phase, 'idle');
  await scene.goTo(99);
  assert.equal(scene.state.phase, 'completed');
  assert.equal(scene.state.turnIndex, 4);
});

test('an explicit empty bookmark queue completes safely and does not expose a turn', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [{ id: 'not-bookmarked', content: 'Nope', characterId: 'mine' }],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
    turnIds: [],
  });

  await scene.start();
  assert.equal(scene.state.phase, 'completed');
  assert.equal(scene.currentTurn, null);
  assert.deepEqual(scene.state.completedTurnIds, []);
  assert.deepEqual(speaker.calls, []);
});

test('a sparse explicit queue completes at the script end coordinate', async () => {
  const scene = new SceneLifecycle({
    turns: [
      { id: 'bookmarked', content: 'Bookmarked', characterId: 'mine' },
      { id: 'unrelated', content: 'Do not expose', characterId: 'mine' },
      { id: 'also-unrelated', content: 'Do not expose', characterId: 'mine' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker: new DeferredSpeaker(),
    turnIds: ['bookmarked'],
  });

  await scene.start();
  await scene.next();
  assert.equal(scene.state.phase, 'completed');
  assert.equal(scene.state.turnIndex, 3);
  assert.equal(scene.currentTurn, null);
});

test('only waiting turns advance completion, including a paused actor cue', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [
      { id: 'one', content: 'One', characterId: 'mine' },
      { id: 'two', content: 'Two', characterId: 'mine' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
    turnIds: ['one', 'two'],
  });

  await scene.start();
  await scene.pause();
  await scene.next();
  assert.equal(scene.state.phase, 'paused');
  assert.equal(scene.state.turnIndex, 1);
  assert.deepEqual(scene.state.completedTurnIds, ['one']);
  await scene.goTo(0);
  assert.deepEqual(scene.state.completedTurnIds, ['one'], 'arbitrary jumps do not claim turns');
});

test('automatic partner completion records only the spoken turn before continuing', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [
      { id: 'partner', content: 'Partner', characterId: 'partner' },
      { id: 'actor', content: 'Actor', characterId: 'mine' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });

  void scene.start();
  await flush();
  speaker.finish(0);
  await flush();
  assert.equal(scene.state.phase, 'waiting');
  assert.equal(scene.state.turnIndex, 1);
  assert.deepEqual(scene.state.completedTurnIds, ['partner']);
});

test('a delayed turn barrier waits before waiting and repeated pause retains actor completion eligibility', async () => {
  const speaker = new DeferredSpeaker();
  let releaseBarrier!: () => void;
  let holdBarrier = true;
  const barrier = new Promise<void>(resolve => { releaseBarrier = resolve; });
  const scene = new SceneLifecycle({
    turns: [
      { id: 'one', content: 'One', characterId: 'mine' },
      { id: 'two', content: 'Two', characterId: 'mine' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
    beforeTurnChange: () => {
      if (holdBarrier) {
        holdBarrier = false;
        return barrier;
      }
      return Promise.resolve();
    },
  });

  const start = scene.start();
  await flush();
  assert.equal(scene.state.phase, 'preparing');
  releaseBarrier();
  await start;
  assert.equal(scene.state.phase, 'waiting');

  await scene.pause();
  await scene.pause();
  await scene.next();
  assert.equal(scene.state.phase, 'paused');
  assert.equal(scene.state.turnIndex, 1);
  assert.deepEqual(scene.state.completedTurnIds, ['one']);
});

test('a stale speech completion after pause cannot mark or advance a turn', async () => {
  const speaker = new DeferredSpeaker();
  const scene = new SceneLifecycle({
    turns: [{ id: 'partner', content: 'Partner', characterId: 'partner' }],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker,
  });

  void scene.start();
  await flush();
  await scene.pause();
  speaker.finish(0);
  await flush();
  assert.equal(scene.state.phase, 'paused');
  assert.equal(scene.state.turnIndex, 0);
  assert.deepEqual(scene.state.completedTurnIds, []);
});

test('reset superseded while stop is pending resolves without an unhandled cancellation error', async () => {
  const speaker = new DelayedStopSpeaker();
  const scene = new SceneLifecycle({
    turns: [{ id: 'actor', content: 'Actor', characterId: 'mine' }],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
  });
  await scene.start();
  speaker.delayNextStop();
  const reset = scene.reset();
  await flush();
  const restart = scene.start();
  speaker.releaseStop();
  await reset;
  await restart;
  assert.equal(scene.state.phase, 'waiting');
});

test('dispose preserves a failed stop as a rejecting replacement barrier', async () => {
  const scene = new SceneLifecycle({
    turns: [{ id: 'actor', content: 'Actor', characterId: 'mine' }],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker: {
      stop: async () => { throw new Error('native stop failed'); },
      speak: async () => {},
    },
  });

  await assert.rejects(scene.dispose(), /native stop failed/);
});

test('disposal barriers remain monotonic across a cleaned generation', async () => {
  let releaseA!: () => void;
  const inheritedA = new Promise<void>(resolve => { releaseA = resolve; });
  const events: string[] = [];
  const barrierB = chainDisposalBarrier(inheritedA, async () => {
    events.push('B');
  });
  const barrierC = chainDisposalBarrier(barrierB, async () => {
    events.push('C');
  });

  await Promise.resolve();
  assert.deepEqual(events, []);
  releaseA();
  await barrierC;
  assert.deepEqual(events, ['B', 'C']);
});

test('disposal barriers preserve inherited failures while settling child cleanup', async () => {
  const inheritedError = new Error('A stop failed');
  const barrier = chainDisposalBarrier(
    Promise.reject(inheritedError),
    async () => { throw new Error('B cleanup failed'); },
  );
  await assert.rejects(barrier, error => error === inheritedError);
});

test('replacement invalidates an old handoff before its inherited cleanup settles', async () => {
  let releaseInherited!: () => void;
  const inherited = new Promise<void>(resolve => { releaseInherited = resolve; });
  let releaseHandoff!: () => void;
  const handoff = new Promise<void>(resolve => { releaseHandoff = resolve; });
  const updates: string[] = [];
  let spoken = false;
  const lifecycle = new SceneLifecycle({
    turns: [{ id: 'old', content: 'Old partner', characterId: 'partner' }],
    myRoleIds: [],
    voiceForCharacter: () => voice,
    speaker: { stop: async () => {}, speak: async () => { spoken = true; } },
    beforeTurnChange: () => handoff,
    onChange: state => { updates.push(state.phase); },
  });
  const starting = lifecycle.start();
  await flush();
  assert.equal(lifecycle.state.phase, 'preparing');

  // Same ordering as the hook: disposal invalidates synchronously; only its
  // acknowledgement is chained behind prior generations' teardown.
  const ownDisposal = lifecycle.dispose();
  const barrier = chainDisposalBarrier(inherited, () => ownDisposal);
  updates.length = 0;
  releaseHandoff();
  await starting;
  assert.equal(spoken, false);
  assert.deepEqual(updates, []);
  releaseInherited();
  await barrier;
});

test('turn-change teardown runs after speaker stop for actor transitions and completion', async () => {
  const events: string[] = [];
  const speaker: SceneSpeaker = {
    stop: async () => { events.push('speaker-stop'); },
    speak: async () => {},
  };
  const scene = new SceneLifecycle({
    turns: [
      { id: 'one', content: 'One', characterId: 'mine' },
      { id: 'two', content: 'Two', characterId: 'mine' },
    ],
    myRoleIds: ['mine'],
    voiceForCharacter: () => voice,
    speaker,
    beforeTurnChange: async () => { events.push('turn-change'); },
  });

  await scene.start();
  assert.equal(scene.state.phase, 'waiting');
  assert.deepEqual(events, ['speaker-stop', 'turn-change']);
  await scene.next();
  assert.equal(scene.state.phase, 'waiting');
  assert.deepEqual(events, ['speaker-stop', 'turn-change', 'speaker-stop', 'turn-change']);
  await scene.next();
  assert.equal(scene.state.phase, 'completed');
  assert.deepEqual(events, [
    'speaker-stop', 'turn-change',
    'speaker-stop', 'turn-change',
    'speaker-stop', 'turn-change',
  ]);
});
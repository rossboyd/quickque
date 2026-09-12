import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCommandEffect } from './reducer.ts';

const context = {
  readMode: 'flow' as const,
  sceneEnabled: true,
  isPlaying: false,
  playbackPhase: 'idle',
  flowStatus: 'unsupported',
  activeSectionIdx: 0,
  sectionCount: 3,
  speed: 50,
  fontSize: 48,
};

test('scene starts without Flow or a recognition model from every transport input', () => {
  for (const cmd of [{ type: 'TogglePlay' }, { action: 'playPause' }, { detail: 'toggle' }]) {
    assert.deepEqual(resolveCommandEffect(cmd, context), { type: 'setPlaying', playing: true });
  }
  for (const phase of ['countdown', 'starting', 'playing']) {
    assert.deepEqual(resolveCommandEffect({ action: 'playPause' }, {
      ...context, playbackPhase: phase, isPlaying: true,
    }), { type: 'setPlaying', playing: false });
  }
});

test('scene transport keeps fixed scroll controls disabled without disabling navigation', () => {
  const manualContext = { ...context, readMode: 'manual' as const };
  assert.equal(resolveCommandEffect({ action: 'scrollSpeed', value: 10 }, manualContext), null);
  assert.equal(resolveCommandEffect({ action: 'position', value: 10 }, manualContext), null);
  assert.deepEqual(resolveCommandEffect({ action: 'next' }, context), {
    type: 'jumpToSection', index: 1,
  });
  assert.deepEqual(resolveCommandEffect({ action: 'fontSize', value: 4 }, context), {
    type: 'setFontSize', fontSize: 52,
  });
});
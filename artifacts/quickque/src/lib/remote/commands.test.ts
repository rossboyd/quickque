import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCommandEffect } from './reducer';

describe('Command Reducer', () => {
  const baseContext = {
    readMode: 'manual' as const,
    isPlaying: false,
    flowStatus: 'stopped',
    activeSectionIdx: 0,
    sectionCount: 3,
    speed: 50,
    fontSize: 48
  };

  it('toggles play in manual mode', () => {
    const res = resolveCommandEffect({ action: 'playPause' }, baseContext);
    assert.deepEqual(res, { type: 'setPlaying', playing: true });
    
    const res2 = resolveCommandEffect({ action: 'playPause' }, { ...baseContext, isPlaying: true });
    assert.deepEqual(res2, { type: 'setPlaying', playing: false });
  });

  it('normalizes keyboard command names through the same reducer', () => {
    assert.deepEqual(
      resolveCommandEffect({ type: 'TogglePlay' }, baseContext),
      { type: 'setPlaying', playing: true },
    );
    assert.deepEqual(
      resolveCommandEffect({ type: 'NextSection' }, baseContext),
      { type: 'jumpToSection', index: 1 },
    );
  });

  it('starts and pauses in flow mode', () => {
    const flowContext = { ...baseContext, readMode: 'flow' as const };
    
    const startRes = resolveCommandEffect({ action: 'playPause' }, { ...flowContext, flowStatus: 'ready' });
    assert.deepEqual(startRes, { type: 'flowStart' });
    
    const pauseRes = resolveCommandEffect({ action: 'playPause' }, { ...flowContext, flowStatus: 'listening' });
    assert.deepEqual(pauseRes, { type: 'flowPause' });

    assert.equal(
      resolveCommandEffect({ action: 'scrollSpeed', value: 5 }, flowContext),
      null,
    );
    assert.equal(
      resolveCommandEffect({ action: 'position', value: 40 }, flowContext),
      null,
    );
  });

  it('navigates next and previous', () => {
    const resNext = resolveCommandEffect({ action: 'next' }, baseContext);
    assert.deepEqual(resNext, { type: 'jumpToSection', index: 1 });
    
    const resPrev = resolveCommandEffect({ action: 'previous' }, { ...baseContext, activeSectionIdx: 2 });
    assert.deepEqual(resPrev, { type: 'jumpToSection', index: 1 });
  });

  it('clamps navigation', () => {
    const resNext = resolveCommandEffect({ action: 'next' }, { ...baseContext, activeSectionIdx: 2 });
    assert.equal(resNext, null);
    
    const resPrev = resolveCommandEffect({ action: 'previous' }, baseContext);
    assert.equal(resPrev, null);
  });

  it('adjusts speed and clamps', () => {
    const res = resolveCommandEffect({ action: 'scrollSpeed', value: 10 }, baseContext);
    assert.deepEqual(res, { type: 'setSpeed', speed: 60 });
    
    const resClamp = resolveCommandEffect({ action: 'scrollSpeed', value: 200 }, baseContext);
    assert.deepEqual(resClamp, { type: 'setSpeed', speed: 150 });
  });

  it('adjusts font size and clamps', () => {
    const res = resolveCommandEffect({ action: 'fontSize', value: -4 }, baseContext);
    assert.deepEqual(res, { type: 'setFontSize', fontSize: 44 });
    
    const resClamp = resolveCommandEffect({ action: 'fontSize', value: -100 }, baseContext);
    assert.deepEqual(resClamp, { type: 'setFontSize', fontSize: 16 });
  });

  it('adjusts position', () => {
    const res = resolveCommandEffect({ action: 'position', value: -50 }, baseContext);
    assert.deepEqual(res, { type: 'adjustPosition', delta: -50 });
  });

  it('handles local section and mode controls without exposing them remotely', () => {
    assert.deepEqual(
      resolveCommandEffect({ action: 'jumpToSection', value: 2 }, baseContext),
      { type: 'jumpToSection', index: 2 },
    );
    assert.deepEqual(
      resolveCommandEffect({ action: 'setReadMode', mode: 'flow' }, baseContext),
      { type: 'setReadMode', mode: 'flow' },
    );
  });
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioTrial, audioTrialFor } from './audio-trial.ts';
test('trial accumulates actual playback and does not reset between passages', () => {
  const trial = new AudioTrial();
  assert.equal(trial.remaining(false),30);
  trial.consume(12); trial.consume(8);
  assert.equal(trial.remaining(false),10);
  trial.consume(10); assert.equal(trial.remaining(false),0);
  assert.equal(trial.remaining(true),Infinity);
});
test('invalid durations and paid mode cannot produce extra free time', () => {
  const trial = new AudioTrial();
  trial.consume(-10); trial.consume(NaN); trial.consume(Infinity);
  assert.equal(trial.remaining(false),30);
  trial.consume(50); assert.equal(trial.remaining(false),0);
});
test('reopening audio for the same script retains this session allowance', () => {
  audioTrialFor('same-script').consume(10);
  assert.equal(audioTrialFor('same-script').remaining(false),20);
  assert.equal(audioTrialFor('different-script').remaining(false),30);
});

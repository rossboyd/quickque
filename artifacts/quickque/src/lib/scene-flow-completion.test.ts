import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SceneFlowCompletionMatcher } from './scene-flow-completion.ts';

test('bounded final history fails closed instead of forgetting old repeated phrases', () => {
  const matcher = new SceneFlowCompletionMatcher('one two '.repeat(34));
  for (let i = 0; i < 32; i += 1) matcher.update(`final-${i}`, 'one two', true);
  assert.equal(matcher.state.anchor, 64);
  assert.equal(matcher.update('final-0', 'one two', true).anchor, 64);
  assert.equal(matcher.update('final-32', 'one two', true).uncertain, true);
  assert.equal(matcher.state.completed, false);
});

test('strict scene matcher rejects a matching trailing phrase', () => {
  const matcher = new SceneFlowCompletionMatcher('one two three four five six');
  const state = matcher.update('final-1', 'four five six', true);
  assert.equal(state.completed, false);
  assert.equal(state.anchor, 0);
  assert.equal(state.uncertain, true);
});

test('strict scene matcher rejects fuzzy words and transcript gaps', () => {
  const matcher = new SceneFlowCompletionMatcher('please take the blue folder now');
  assert.equal(matcher.update('final-1', 'please take tha blue folder now', true).completed, false);
  assert.equal(matcher.state.anchor, 0);
  assert.equal(matcher.update('final-2', 'please the blue folder now', true).completed, false);
  assert.equal(matcher.state.anchor, 0);
  // Once a final result is uncertain, explicit Next is the only way forward.
  assert.equal(matcher.update('final-3', 'please take the blue folder now', true).completed, false);
});

test('strict scene matcher handles multipart final utterances and deduplicates ids', () => {
  const matcher = new SceneFlowCompletionMatcher('please take the blue folder now');
  assert.deepEqual(matcher.update('first', 'please take the', true), {
    eligible: true, anchor: 3, completed: false, uncertain: false,
  });
  assert.equal(matcher.update('first', 'blue folder now', true).anchor, 3);
  assert.deepEqual(matcher.update('second', 'blue folder now', true), {
    eligible: true, anchor: 6, completed: true, uncertain: false,
  });
});

test('short and repetitive actor turns remain manual-only', () => {
  const short = new SceneFlowCompletionMatcher('yes no');
  assert.equal(short.update('one', 'yes no', true).eligible, false);
  assert.equal(short.state.completed, false);
  const repeated = new SceneFlowCompletionMatcher('yes yes yes yes');
  assert.equal(repeated.update('one', 'yes yes yes yes', true).eligible, false);
  assert.equal(repeated.state.completed, false);
});

test('partial/interim or stale-reset results cannot complete a fresh turn', () => {
  const matcher = new SceneFlowCompletionMatcher('please take the blue folder now');
  assert.equal(matcher.update('old', 'please take the', false).anchor, 0);
  assert.equal(matcher.update('old', 'please take the', true).anchor, 3);
  matcher.reset();
  assert.equal(matcher.state.anchor, 0);
  assert.equal(matcher.update('late', 'blue folder now', true).completed, false);
  assert.equal(matcher.state.anchor, 0);
});
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNearestReaderAnchor,
  getReaderAnchorOffset,
  restoreReaderScrollTop,
} from './reader-position.ts';

test('selects the copy span nearest the reading guide', () => {
  assert.deepEqual(
    findNearestReaderAnchor([
      { id: 'before', top: 220 },
      { id: 'at-guide', top: 302 },
      { id: 'after', top: 390 },
    ], 300),
    { id: 'at-guide', top: 302 },
  );
});

test('restores a reflowed anchor at its saved viewport offset', () => {
  const savedOffset = getReaderAnchorOffset(300, 300);
  // The anchor moved 140px down in the viewport after wrapping changed.
  assert.equal(
    restoreReaderScrollTop(500, 440, 300, savedOffset, 2000),
    640,
  );
});

test('anchor restoration is clamped to the scrollable copy', () => {
  assert.equal(restoreReaderScrollTop(10, 1000, 300, 0, 500), 500);
  assert.equal(restoreReaderScrollTop(10, -1000, 300, 0, 500), 0);
});
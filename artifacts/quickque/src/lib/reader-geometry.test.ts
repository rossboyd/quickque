import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientDeltaToLogicalScroll,
  getCueInsetPercent,
  getLogicalGuideOffset,
  getLogicalLeadingEdge,
  getLogicalScrollCoordinate,
  getReaderTopPaddingPx,
  getReaderViewportTransform,
  restoreLogicalReaderScrollTop,
} from './reader-geometry.ts';

test('mirror matrix keeps the viewport transform explicit', () => {
  assert.equal(getReaderViewportTransform({ horizontal: false, vertical: false }), undefined);
  assert.equal(getReaderViewportTransform({ horizontal: true, vertical: false }), 'scale(-1, 1)');
  assert.equal(getReaderViewportTransform({ horizontal: false, vertical: true }), 'scale(1, -1)');
  assert.equal(getReaderViewportTransform({ horizontal: true, vertical: true }), 'scale(-1, -1)');
});

test('vertical mirror uses the painted bottom as logical leading edge', () => {
  const rect = { top: 140, bottom: 188 };
  assert.equal(getLogicalLeadingEdge(rect, false), 140);
  assert.equal(getLogicalLeadingEdge(rect, true), 188);
});

test('scroll coordinates use the viewport rather than a padded offset parent', () => {
  const viewport = { top: 100, bottom: 700 };
  assert.equal(getLogicalScrollCoordinate(900, viewport, 280, false), 1080);
  // The same logical 1080 coordinate is painted from the opposite edge.
  assert.equal(getLogicalScrollCoordinate(900, viewport, 520, true), 1080);
});

test('client delta maps to native logical scrolling for every vertical mirror state', () => {
  assert.equal(clientDeltaToLogicalScroll(24, false), 24);
  assert.equal(clientDeltaToLogicalScroll(-24, false), -24);
  assert.equal(clientDeltaToLogicalScroll(24, true), -24);
  assert.equal(clientDeltaToLogicalScroll(-24, true), 24);
});

test('cue guide is clamped and calculated in logical viewport coordinates', () => {
  assert.equal(getCueInsetPercent(4), 10);
  assert.equal(getCueInsetPercent(95), 80);
  assert.equal(getLogicalGuideOffset(600, 30), 180);
});

test('top copy padding follows the reader viewport rather than window vh', () => {
  // At 50%, a compact 320px reader starts at 160px even on a tall display.
  assert.equal(getReaderTopPaddingPx(320, 50), 160);
  assert.equal(getReaderTopPaddingPx(480, 80), 384);
  assert.equal(getReaderTopPaddingPx(-10, 50), 0);
});

test('restoration converts mirrored client correction back to native scrollTop', () => {
  // In the vertically mirrored paint space the anchor is 40px below its
  // desired edge, so logical scroll must decrease by 40px.
  assert.equal(
    restoreLogicalReaderScrollTop(500, 340, 300, 0, 2000, true, true),
    460,
  );
  // Turning the mirror on reverses the prior painted guide-relative offset.
  assert.equal(
    restoreLogicalReaderScrollTop(500, 300, 300, 25, 2000, true, false),
    475,
  );
});
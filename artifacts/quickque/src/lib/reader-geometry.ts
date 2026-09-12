/**
 * Geometry for the reader's transformed copy viewport.
 *
 * `scrollTop` is deliberately never mirrored: it remains the browser's
 * ordinary, logical document coordinate.  CSS mirroring changes only the
 * painted viewport, so all measurements that cross that boundary go through
 * these helpers.  Keeping this policy here prevents the Flow follower,
 * section jumps, and reflow restoration from each inventing subtly different
 * mirror math.
 */
export type ReaderMirror = {
  horizontal: boolean;
  vertical: boolean;
};

export type ReaderRect = {
  top: number;
  bottom: number;
};

export function clampReaderPercent(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function getReaderViewportTransform(mirror: ReaderMirror): string | undefined {
  if (!mirror.horizontal && !mirror.vertical) return undefined;
  return `scale(${mirror.horizontal ? -1 : 1}, ${mirror.vertical ? -1 : 1})`;
}

/**
 * A vertically mirrored element's logical leading edge is its painted bottom.
 * This is the edge that represents the start of copy in reading order.
 */
export function getLogicalLeadingEdge(rect: ReaderRect, verticalMirror: boolean): number {
  return verticalMirror ? rect.bottom : rect.top;
}

/**
 * Map a painted edge back into the same logical document coordinate as native
 * scrollTop. This intentionally avoids HTMLElement.offsetTop: an offsetTop is
 * relative to an offsetParent (often the padded text wrapper), not necessarily
 * the scroll viewport.
 */
export function getLogicalScrollCoordinate(
  scrollTop: number,
  viewportRect: ReaderRect,
  paintedLeadingEdge: number,
  verticalMirror: boolean,
): number {
  return scrollTop + (verticalMirror
    ? viewportRect.bottom - paintedLeadingEdge
    : paintedLeadingEdge - viewportRect.top);
}

/**
 * Convert a painted client-space difference into a change to native
 * `scrollTop`. In a vertical mirror scrollTop increases move painted copy down,
 * not up, hence the inverse sign.
 */
export function clientDeltaToLogicalScroll(
  clientDelta: number,
  verticalMirror: boolean,
): number {
  return verticalMirror ? -clientDelta : clientDelta;
}

export function getCueInsetPercent(cuePosition: number): number {
  return clampReaderPercent(cuePosition, 10, 80);
}

export function getLogicalGuideOffset(viewportHeight: number, cuePosition: number): number {
  return viewportHeight * (getCueInsetPercent(cuePosition) / 100);
}

/**
 * The copy's leading padding must use the scroll viewport, not window vh.
 * Compact windows and reader chrome make window-relative vh visibly drift from
 * the cue's percentage position.
 */
export function getReaderTopPaddingPx(
  viewportHeight: number,
  cuePosition: number,
): number {
  return getLogicalGuideOffset(Math.max(0, viewportHeight), cuePosition);
}

/**
 * Restore a saved guide-relative copy edge through the painted-to-logical
 * boundary. A newly enabled vertical mirror reverses client-space offsets, but
 * does not reverse the browser's `scrollTop` coordinate.
 */
export function restoreLogicalReaderScrollTop(
  currentScrollTop: number,
  currentAnchorEdge: number,
  guideEdge: number,
  savedAnchorOffset: number,
  maxScrollTop: number,
  verticalMirror: boolean,
  savedVerticalMirror: boolean,
): number {
  const desiredOffset = verticalMirror === savedVerticalMirror
    ? savedAnchorOffset
    : -savedAnchorOffset;
  const clientCorrection = currentAnchorEdge - guideEdge - desiredOffset;
  const target = currentScrollTop + clientDeltaToLogicalScroll(
    clientCorrection,
    verticalMirror,
  );
  return Math.max(0, Math.min(Math.max(0, maxScrollTop), target));
}
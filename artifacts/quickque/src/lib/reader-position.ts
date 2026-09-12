export type ReaderAnchorMeasurement = {
  id: string;
  top: number;
};

/**
 * Pick the stable copy span closest to the reading guide. Keeping the span
 * identity (rather than a document percentage) survives uneven line reflow.
 */
export function findNearestReaderAnchor(
  anchors: ReaderAnchorMeasurement[],
  guideTop: number,
): ReaderAnchorMeasurement | null {
  return anchors.reduce<ReaderAnchorMeasurement | null>((nearest, anchor) => {
    if (!nearest) return anchor;
    return Math.abs(anchor.top - guideTop) < Math.abs(nearest.top - guideTop)
      ? anchor
      : nearest;
  }, null);
}

export function getReaderAnchorOffset(anchorTop: number, guideTop: number): number {
  return anchorTop - guideTop;
}

/**
 * Calculate the scrollTop needed to put the same anchor back at its saved
 * viewport offset after its surrounding copy has reflowed.
 */
export function restoreReaderScrollTop(
  currentScrollTop: number,
  currentAnchorTop: number,
  guideTop: number,
  savedAnchorOffset: number,
  maxScrollTop: number,
): number {
  const target = currentScrollTop + currentAnchorTop - guideTop - savedAnchorOffset;
  return Math.max(0, Math.min(Math.max(0, maxScrollTop), target));
}
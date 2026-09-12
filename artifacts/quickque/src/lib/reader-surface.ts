export type ReaderSurfacePresentation = {
  className: string;
  style: {
    backgroundColor: string;
    borderColor: string;
  };
};

export function getReaderSurfacePresentation(
  compactMode: boolean,
  backgroundOpacity: number,
  backgroundColor?: string,
): ReaderSurfacePresentation {
  const opacity = compactMode
    ? Math.min(100, Math.max(0, backgroundOpacity)) / 100
    : 1;

  return {
    className: compactMode
      ? 'fixed inset-0 m-2 rounded-xl border shadow-2xl overflow-hidden'
      : 'h-[100dvh] w-full',
    style: {
      // The alpha belongs to the reader surface only.  Do not use opacity on
      // the root element: that would also fade copy, cues, and controls.
      backgroundColor: backgroundColor
        ? `color-mix(in srgb, ${backgroundColor} ${opacity * 100}%, transparent)`
        : `hsl(var(--background) / ${opacity})`,
      borderColor: compactMode ? 'hsl(var(--border) / 0.5)' : 'transparent',
    },
  };
}
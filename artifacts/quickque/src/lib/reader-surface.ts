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
): ReaderSurfacePresentation {
  const opacity = compactMode
    ? Math.min(100, Math.max(0, backgroundOpacity)) / 100
    : 1;

  return {
    className: compactMode
      ? 'fixed inset-0 m-2 rounded-xl border shadow-2xl overflow-hidden'
      : 'h-[100dvh] w-full',
    style: {
      backgroundColor: `hsl(var(--background) / ${opacity})`,
      borderColor: compactMode ? 'hsl(var(--border) / 0.5)' : 'transparent',
    },
  };
}
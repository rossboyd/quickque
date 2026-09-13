import type { PresentationPreferences, Settings } from './types.ts';
import {
  normalizeFontFamily,
  normalizeTextColor,
  isFontFamily,
  isValidTextColor,
} from './appearance.ts';

export const DEFAULT_PRESENTATION: PresentationPreferences = {
  fontSize: 48,
  speed: 50,
  countdownSeconds: 0,
  targetDurationSeconds: null,
  showTiming: true,
  // Keep the reader's existing playback behaviour when this preference is
  // first introduced.
  hideControlsWhilePlaying: true,
  pauseOnManualScroll: false,
  backgroundOpacity: 85,
  fontFamily: 'system',
  textColor: null,
  // This is the old dark theme surface (#1a1a1a), expressed as an explicit
  // colour now that presentation settings belong to the script.
  backgroundColor: '#1A1A1A',
  lineSpacing: 1.5,
  horizontalMargin: 10,
  mirrorHorizontal: false,
  mirrorVertical: false,
  cueStyle: 'line',
  // The prior reader's `top-[30%]` marker used the active dark primary at
  // 70% opacity. Keep that visual as the default explicit cue.
  cuePosition: 30,
  cueColor: '#FF5349',
  cueOpacity: 70,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberInRange(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= minimum && value <= maximum
    ? value
    : fallback;
}

function booleanOrFallback(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function nullableNumberInRange(
  value: unknown,
  fallback: number | null,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) &&
    value >= minimum && value <= maximum
    ? value
    : fallback;
}

function cueStyleOrFallback(
  value: unknown,
  fallback: PresentationPreferences['cueStyle'],
): PresentationPreferences['cueStyle'] {
  return value === 'hidden' || value === 'line' || value === 'arrows'
    ? value
    : fallback;
}

function hexOrFallback(value: unknown, fallback: string): string {
  return isValidTextColor(value) ? value.toUpperCase() : fallback;
}

/**
 * Builds a complete, bounded preference object. Invalid individual values do
 * not poison an otherwise valid script; they retain the supplied fallback.
 */
export function normalizePresentation(
  value: unknown,
  fallback: PresentationPreferences = DEFAULT_PRESENTATION,
): PresentationPreferences {
  const source = isRecord(value) ? value : {};
  const base = fallback === DEFAULT_PRESENTATION
    ? DEFAULT_PRESENTATION
    : normalizePresentation(fallback, DEFAULT_PRESENTATION);
  return {
    fontSize: numberInRange(source.fontSize, base.fontSize, 16, 120),
    speed: numberInRange(source.speed, base.speed, 1, 150),
    countdownSeconds: numberInRange(
      source.countdownSeconds,
      base.countdownSeconds,
      0,
      30,
    ),
    targetDurationSeconds: nullableNumberInRange(
      source.targetDurationSeconds,
      base.targetDurationSeconds,
      1,
      86_400,
    ),
    showTiming: booleanOrFallback(source.showTiming, base.showTiming),
    hideControlsWhilePlaying: booleanOrFallback(
      source.hideControlsWhilePlaying,
      base.hideControlsWhilePlaying,
    ),
    pauseOnManualScroll: booleanOrFallback(
      source.pauseOnManualScroll,
      base.pauseOnManualScroll,
    ),
    backgroundOpacity: numberInRange(
      source.backgroundOpacity,
      base.backgroundOpacity,
      0,
      100,
    ),
    fontFamily: source.fontFamily === undefined || !isFontFamily(source.fontFamily)
      ? base.fontFamily
      : normalizeFontFamily(source.fontFamily),
    textColor: source.textColor === undefined
      ? base.textColor
      : source.textColor === null || source.textColor === ''
        ? null
        : isValidTextColor(source.textColor)
          ? normalizeTextColor(source.textColor)
          : base.textColor,
    backgroundColor: hexOrFallback(source.backgroundColor, base.backgroundColor),
    lineSpacing: numberInRange(source.lineSpacing, base.lineSpacing, 1, 3),
    horizontalMargin: numberInRange(
      source.horizontalMargin,
      base.horizontalMargin,
      0,
      30,
    ),
    mirrorHorizontal: booleanOrFallback(
      source.mirrorHorizontal,
      base.mirrorHorizontal,
    ),
    mirrorVertical: booleanOrFallback(source.mirrorVertical, base.mirrorVertical),
    cueStyle: cueStyleOrFallback(source.cueStyle, base.cueStyle),
    cuePosition: numberInRange(source.cuePosition, base.cuePosition, 10, 80),
    cueColor: hexOrFallback(source.cueColor, base.cueColor),
    cueOpacity: numberInRange(source.cueOpacity, base.cueOpacity, 0, 100),
  };
}

/** Convert the one-time, global legacy reader settings into a script snapshot. */
export function presentationFromLegacySettings(
  settings: Pick<
    Settings,
    'fontSize' | 'speed' | 'backgroundOpacity' | 'fontFamily' | 'textColor' | 'darkTheme'
  >,
): PresentationPreferences {
  return normalizePresentation({
    fontSize: settings.fontSize,
    speed: settings.speed,
    backgroundOpacity: settings.backgroundOpacity,
    fontFamily: settings.fontFamily,
    textColor: settings.textColor,
    backgroundColor: settings.darkTheme ? '#1A1A1A' : '#FFFFFF',
    // These are the exact hex equivalents of the old theme primary tokens:
    // dark hsl(190 90% 50%), light hsl(190 85% 28%).
    cueColor: settings.darkTheme ? '#FF5349' : '#C83F38',
  });
}

export function isValidPresentation(value: unknown): value is PresentationPreferences {
  if (!isRecord(value)) return false;
  const normalized = normalizePresentation(value);
  return Object.keys(normalized).every(key => (
    value[key] === normalized[key as keyof PresentationPreferences]
  ));
}
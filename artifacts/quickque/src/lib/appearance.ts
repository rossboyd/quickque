import type { FontFamily } from './types.ts';

/**
 * These stacks intentionally contain no web fonts. The reader must remain
 * usable offline, including in the native desktop app.
 */
export const FONT_FAMILY_OPTIONS: ReadonlyArray<{
  value: FontFamily;
  label: string;
  css: string;
}> = [
  {
    value: 'system',
    label: 'System sans',
    css: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  {
    value: 'arial',
    label: 'Arial / Helvetica',
    css: 'Arial, Helvetica, sans-serif',
  },
  {
    value: 'georgia',
    label: 'Georgia',
    css: 'Georgia, "Times New Roman", serif',
  },
  {
    value: 'monospace',
    label: 'Monospace',
    css: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
];

const FONT_FAMILY_VALUES = new Set<FontFamily>(
  FONT_FAMILY_OPTIONS.map(option => option.value),
);

export const THEME_DEFAULT_DARK_PICKER_COLOR = '#FAFAFA';
export const THEME_DEFAULT_LIGHT_PICKER_COLOR = '#171717';

const THEME_DARK_SURFACE_COLOR = '#111827';
const THEME_LIGHT_SURFACE_COLOR = '#F9FAFB';

export function isValidTextColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Return null for the theme default. */
export function normalizeTextColor(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return isValidTextColor(value) ? value.toUpperCase() : null;
}

export function isFontFamily(value: unknown): value is FontFamily {
  return typeof value === 'string' && FONT_FAMILY_VALUES.has(value as FontFamily);
}

export function normalizeFontFamily(value: unknown): FontFamily {
  return isFontFamily(value) ? value : 'system';
}

export function getFontFamilyCss(fontFamily: unknown): string {
  return FONT_FAMILY_OPTIONS.find(option => option.value === normalizeFontFamily(fontFamily))?.css
    ?? FONT_FAMILY_OPTIONS[0].css;
}

/**
 * The actual theme colour is left to CSS so switching themes immediately
 * updates the script. This value is used only for the native picker's
 * required six-digit colour value.
 */
export function getTextColorCss(textColor: unknown): string {
  return normalizeTextColor(textColor) ?? 'hsl(var(--foreground))';
}

export function getThemeDefaultPickerColor(darkTheme: boolean): string {
  return darkTheme
    ? THEME_DEFAULT_DARK_PICKER_COLOR
    : THEME_DEFAULT_LIGHT_PICKER_COLOR;
}

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function hexLuminance(value: string): number {
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

/**
 * This is an advisory check against the normal theme surface. A compact
 * transparent overlay can change the effective surface, so the UI must never
 * block a user's chosen colour based on this estimate.
 */
export function getTextContrastRatio(
  textColor: unknown,
  darkTheme: boolean,
): number | null {
  const normalized = normalizeTextColor(textColor);
  if (!normalized) return null;
  const textLuminance = hexLuminance(normalized);
  const surfaceLuminance = hexLuminance(
    darkTheme ? THEME_DARK_SURFACE_COLOR : THEME_LIGHT_SURFACE_COLOR,
  );
  const lighter = Math.max(textLuminance, surfaceLuminance);
  const darker = Math.min(textLuminance, surfaceLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
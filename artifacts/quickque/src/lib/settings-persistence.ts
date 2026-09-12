import {
  DEFAULT_SETTINGS,
  type FontFamily,
  type Settings,
} from './types.ts';
import {
  normalizeFontFamily,
  normalizeTextColor,
} from './appearance.ts';

export const QUICKQUE_SETTINGS_KEY = 'quickque_settings';

export interface SettingsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumberOrDefault(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Settings have always been best-effort local preferences. Unlike the script
 * library, a malformed preference should not block the user's scripts from
 * loading. Validate new appearance values while preserving the existing
 * preferences and their old storage shape.
 */
export function normalizeSettings(value: unknown): Settings {
  const source = isRecord(value) ? value : {};
  return {
    fontSize: finiteNumberOrDefault(source.fontSize, DEFAULT_SETTINGS.fontSize),
    speed: finiteNumberOrDefault(source.speed, DEFAULT_SETTINGS.speed),
    backgroundOpacity: finiteNumberOrDefault(
      source.backgroundOpacity,
      DEFAULT_SETTINGS.backgroundOpacity,
    ),
    darkTheme: booleanOrDefault(source.darkTheme, DEFAULT_SETTINGS.darkTheme),
    compactMode: booleanOrDefault(source.compactMode, DEFAULT_SETTINGS.compactMode),
    textColor: normalizeTextColor(source.textColor),
    fontFamily: normalizeFontFamily(source.fontFamily),
  };
}

export function parseSettings(value: string | null): Settings {
  if (value === null) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(value));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function loadSettings(storage: SettingsStorageLike | null): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(storage.getItem(QUICKQUE_SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(normalizeSettings(settings));
}

export function persistSettings(
  storage: SettingsStorageLike,
  settings: Settings,
): { ok: true; settings: Settings } | { ok: false; error: string } {
  const nextSettings = normalizeSettings(settings);
  try {
    storage.setItem(QUICKQUE_SETTINGS_KEY, JSON.stringify(nextSettings));
  } catch {
    return { ok: false, error: 'Failed to save settings.' };
  }
  return { ok: true, settings: nextSettings };
}

// Descriptive aliases keep callers/tests from needing to know the storage
// implementation's name.
export const readStoredSettings = loadSettings;
export const writeSettings = persistSettings;

export type { FontFamily };
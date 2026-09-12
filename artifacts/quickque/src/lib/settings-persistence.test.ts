import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
} from './types.ts';
import {
  FONT_FAMILY_OPTIONS,
  getFontFamilyCss,
  getTextContrastRatio,
  getThemeDefaultPickerColor,
  normalizeTextColor,
} from './appearance.ts';
import {
  loadSettings,
  persistSettings,
  QUICKQUE_SETTINGS_KEY,
  serializeSettings,
} from './settings-persistence.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  shouldThrow = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrow) throw new Error('quota');
    this.values.set(key, value);
  }

  put(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test('appearance defaults preserve the existing presentation settings', () => {
  assert.equal(DEFAULT_SETTINGS.textColor, null);
  assert.equal(DEFAULT_SETTINGS.fontFamily, 'system');
  assert.equal(FONT_FAMILY_OPTIONS.length, 4);
  assert.match(getFontFamilyCss(DEFAULT_SETTINGS.fontFamily), /system-ui/);
  assert.equal(getThemeDefaultPickerColor(true), '#FAFAFA');
  assert.equal(getThemeDefaultPickerColor(false), '#171717');
  assert.ok((getTextContrastRatio('#000000', true) ?? 0) < 4.5);
  assert.ok((getTextContrastRatio('#FAFAFA', true) ?? 0) >= 4.5);
});

test('legacy settings load safely and invalid appearance values use defaults', () => {
  const storage = new MemoryStorage();
  storage.put(QUICKQUE_SETTINGS_KEY, JSON.stringify({
    fontSize: 36,
    speed: 70,
    backgroundOpacity: 40,
    darkTheme: false,
    compactMode: true,
    textColor: '#12345',
    fontFamily: 'remote-web-font',
  }));

  const settings = loadSettings(storage);
  assert.equal(settings.fontSize, 36);
  assert.equal(settings.speed, 70);
  assert.equal(settings.backgroundOpacity, 40);
  assert.equal(settings.darkTheme, false);
  assert.equal(settings.compactMode, true);
  assert.equal(settings.textColor, null);
  assert.equal(settings.fontFamily, 'system');
  assert.equal(normalizeTextColor('#a1B2c3'), '#A1B2C3');
  assert.equal(normalizeTextColor('#abc'), null);
});

test('pre-appearance settings and malformed storage retain safe defaults', () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  storage.put(QUICKQUE_SETTINGS_KEY, JSON.stringify({
    fontSize: 40, speed: 25, backgroundOpacity: 60, darkTheme: false, compactMode: false,
  }));
  assert.deepEqual(loadSettings(storage), {
    ...DEFAULT_SETTINGS, fontSize: 40, speed: 25, backgroundOpacity: 60, darkTheme: false,
  });
  for (const raw of ['{', 'null', '[]', '42', '"font"', '{"textColor":123,"fontFamily":{}}']) {
    storage.put(QUICKQUE_SETTINGS_KEY, raw);
    assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  }
  assert.deepEqual(loadSettings({
    getItem() { throw new Error('storage unavailable'); },
    setItem() {},
  }), DEFAULT_SETTINGS);
});

test('appearance settings persist and reset to theme/default font', () => {
  const storage = new MemoryStorage();
  const saved = persistSettings(storage, {
    ...DEFAULT_SETTINGS,
    textColor: '#0a1b2c',
    fontFamily: 'georgia',
  });
  assert.deepEqual(saved, {
    ok: true,
    settings: {
      ...DEFAULT_SETTINGS,
      textColor: '#0A1B2C',
      fontFamily: 'georgia',
    },
  });
  if (!saved.ok) return;
  assert.deepEqual(loadSettings(storage), saved.settings);

  const reset = persistSettings(storage, {
    ...saved.settings,
    textColor: null,
    fontFamily: DEFAULT_SETTINGS.fontFamily,
  });
  assert.equal(reset.ok, true);
  assert.deepEqual(loadSettings(storage), DEFAULT_SETTINGS);
  assert.equal(serializeSettings(DEFAULT_SETTINGS), JSON.stringify(DEFAULT_SETTINGS));
});

test('a failed settings write does not report success', () => {
  const storage = new MemoryStorage();
  storage.shouldThrow = true;
  assert.deepEqual(persistSettings(storage, DEFAULT_SETTINGS), {
    ok: false,
    error: 'Failed to save settings.',
  });
});
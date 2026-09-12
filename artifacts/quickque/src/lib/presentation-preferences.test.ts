import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_PRESENTATION,
  isValidPresentation,
  normalizePresentation,
  presentationFromLegacySettings,
} from './presentation-preferences.ts';
import { DEFAULT_SETTINGS } from './types.ts';

test('presentation normalization bounds fields and preserves a valid fallback', () => {
  const fallback = {
    ...DEFAULT_PRESENTATION,
    fontSize: 60,
    backgroundColor: '#112233',
    cueStyle: 'arrows' as const,
  };
  const value = normalizePresentation({
    fontSize: 121,
    speed: 0,
    backgroundOpacity: -1,
    fontFamily: 'untrusted',
    textColor: '#a1b2c3',
    backgroundColor: '#gggggg',
    lineSpacing: 3.1,
    horizontalMargin: 31,
    mirrorHorizontal: 'true',
    mirrorVertical: true,
    cueStyle: 'outside',
    cuePosition: 9,
    cueColor: '#abc',
    cueOpacity: 101,
  }, fallback);
  assert.equal(value.fontSize, 60);
  assert.equal(value.speed, fallback.speed);
  assert.equal(value.backgroundOpacity, fallback.backgroundOpacity);
  assert.equal(value.fontFamily, fallback.fontFamily);
  assert.equal(value.textColor, '#A1B2C3');
  assert.equal(value.backgroundColor, '#112233');
  assert.equal(value.lineSpacing, fallback.lineSpacing);
  assert.equal(value.horizontalMargin, fallback.horizontalMargin);
  assert.equal(value.mirrorHorizontal, fallback.mirrorHorizontal);
  assert.equal(value.mirrorVertical, true);
  assert.equal(value.cueStyle, 'arrows');
  assert.equal(value.cuePosition, fallback.cuePosition);
  assert.equal(value.cueColor, fallback.cueColor);
  assert.equal(value.cueOpacity, fallback.cueOpacity);
  assert.ok(isValidPresentation(value));
  assert.equal(isValidPresentation({ ...value, cuePosition: 81 }), false);
  assert.equal(normalizePresentation({ speed: 150 }).speed, 150);
  assert.equal(normalizePresentation({ speed: 151 }).speed, DEFAULT_PRESENTATION.speed);
});

test('legacy settings snapshot keeps the old theme surface at migration time', () => {
  const light = presentationFromLegacySettings({
    ...DEFAULT_SETTINGS,
    darkTheme: false,
    fontSize: 36,
    textColor: '#123456',
  });
  assert.equal(light.backgroundColor, '#FFFFFF');
  assert.equal(light.cueColor, '#0B7084');
  assert.equal(light.cuePosition, 30);
  assert.equal(light.fontSize, 36);
  assert.equal(light.textColor, '#123456');
  const dark = presentationFromLegacySettings(DEFAULT_SETTINGS);
  assert.equal(dark.backgroundColor, '#1A1A1A');
  assert.equal(dark.cueColor, '#0DCCF2');
  assert.equal(DEFAULT_PRESENTATION.cuePosition, 30);
});
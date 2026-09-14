import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../dist/server/entry-server.js';
import { loadSiteDataSync } from '../lib/server/content.js';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const data = loadSiteDataSync();

test('unavailable status never exposes DMG URL in hrefs', () => {
  const unavailableData = { ...data, config: { ...data.config, release: { ...data.config.release, status: 'unavailable', downloadUrl: 'https://example.com/dmg' } } };
  const { html } = render('/', {}, unavailableData);
  assert.doesNotMatch(html, /href="https:\/\/example\.com\/dmg"/, 'DMG URL should not be present in an href when release is unavailable');
  assert.match(html, /Open live browser demo/i, 'Prominent demo alternative should be present');
});

test('SSR overlay native range presence and explicit label', () => {
  const { html } = render('/', {}, data);
  assert.match(html, /<input[^>]*type="range"/, 'Should use a native input type="range"');
  assert.match(html, /Illustrative preview/, 'Should have an explicit illustrative preview label');
  
  // Use a simpler approach to count mock-avatars
  // Since we changed it so both have mock-call-grid-full, we expect a total of 12 avatars in the whole file
  const totalAvatars = (html.match(/mock-avatar/g) || []).length;
  assert.equal(totalAvatars, 12, 'Should have exactly 12 avatars (6 before, 6 after) in the comparison component');
});

test('gate Mac UA Intel compatibility token advisory', () => {
  const fileUrl = new URL('../src/components/DownloadGate.tsx', import.meta.url);
  const code = fs.readFileSync(fileUrl, 'utf8');
  assert.match(code, /const architectureValue = `\$\{userAgentData\?\.architecture \|\| ''\} \$\{userAgentData\?\.platform \|\| ''\}`\.toLowerCase\(\);/);
  assert.doesNotMatch(code, /\$\{userAgent\} \$\{platform\}/, 'Should not rely on raw userAgent string which often contains fake Intel mac OS X tokens on Apple Silicon');
});

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('desktop bundle includes a local-network permission purpose for phone remote', () => {
  const nativeRoot = new URL('../../../src-tauri/', import.meta.url);
  const config = JSON.parse(readFileSync(new URL('tauri.conf.json', nativeRoot), 'utf8'));
  assert.equal(config.bundle.macOS.infoPlist, 'Info.plist');
  const plist = readFileSync(new URL(config.bundle.macOS.infoPlist, nativeRoot), 'utf8');
  assert.match(plist, /<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]*phone[^<]*<\/string>/);
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>/);
});
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const manifest = JSON.parse(read('src-tauri/icons/manifest.json'));
for (const [path, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash('sha256').update(read(path)).digest('hex'), expected, `Icon asset changed: ${path}`);
}
assert.equal(createHash('sha256').update(read(`../../${manifest.source}`)).digest('hex'), manifest.sourceSha256);
const config = JSON.parse(read('src-tauri/tauri.conf.json'));
assert.equal(config.identifier, 'com.quickque.desktop', 'Keep the existing application identity');
for (const path of config.bundle.icon) assert.ok(read(`src-tauri/${path}`).length);
assert.ok(config.bundle.icon.includes('icons/icon.icns'));
const icns = read('src-tauri/icons/icon.icns');
assert.equal(icns.toString('ascii', 0, 4), 'icns');
assert.equal(icns.readUInt32BE(4), icns.length);
const sizes = [];
const kinds = [];
for (let offset = 8; offset < icns.length;) {
  kinds.push(icns.toString('ascii', offset, offset + 4));
  const length = icns.readUInt32BE(offset + 4);
  assert.ok(length > 8 && offset + length <= icns.length);
  const png = icns.subarray(offset + 8, offset + length);
  assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
  sizes.push(png.readUInt32BE(16));
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20));
  offset += length;
}
assert.deepEqual(sizes, [16, 32, 64, 128, 256, 512, 1024, 32, 64, 256, 512]);
assert.deepEqual(kinds, ['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']);
const html = read('index.html').toString();
assert.match(html, /href="%BASE_URL%favicon.png"/);
assert.doesNotMatch(html, /fonts\.google|favicon\.svg/);
console.log('Icon checks passed: source, asset hashes, ICNS sizes, bundle inputs and local favicon.');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSiteDataSync, readSiteConfigSync, serializeSiteData, validateProductionOrigin, routePath } from '../lib/server/content.js';
import { render } from '../dist/server/entry-server.js';

const data = loadSiteDataSync();

test('local font assets are actual font binaries, not downloaded error pages', () => {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  for (const [, filename] of css.matchAll(/url\(['"]\/fonts\/([^'"]+)['"]\)/g)) {
    const bytes = fs.readFileSync(new URL(`../public/fonts/${filename}`, import.meta.url));
    const signature = bytes.subarray(0, 4).toString('hex');
    assert.ok(['00010000', '4f54544f', '774f4646', '774f4632'].includes(signature), `Invalid font binary: ${filename}`);
  }
});

test('production origin accepts confirmed published origins but excludes previews', () => {
  assert.equal(validateProductionOrigin(null), null);
  assert.equal(validateProductionOrigin('https://example.org'), 'https://example.org');
  assert.equal(validateProductionOrigin('https://confirmed-project.replit.app'), 'https://confirmed-project.replit.app');
  for (const origin of ['http://example.org', 'https://temporary.replit.dev', 'https://localhost', 'https://127.0.0.1', 'https://example.org/path', 'https://user:secret@example.org', 'https://example.org?query', '']) {
    assert.throws(() => validateProductionOrigin(origin));
  }
});

test('missing, malformed or misleading release configuration fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quickque-config-'));
  try {
    assert.throws(() => readSiteConfigSync(root));
    fs.mkdirSync(path.join(root, 'config'));
    const configFile = path.join(root, 'config/site.json');
    fs.writeFileSync(configFile, '{invalid');
    assert.throws(() => readSiteConfigSync(root));
    for (const release of [null, {}, { status: 'verified' }, { status: 'available' }]) {
      fs.writeFileSync(configFile, JSON.stringify({ ...data.config, release }));
      assert.throws(() => readSiteConfigSync(root));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hydration serialization cannot close its script element', () => {
  const value = { body: '</script><script>alert(1)</script>&\u2028\u2029' };
  const serialized = serializeSiteData(value);
  assert.ok(!serialized.includes('<'));
  assert.deepEqual(JSON.parse(serialized), value);
});

test('base-path boundaries do not capture the app or similar paths', () => {
  assert.equal(routePath('/', data.config), null);
  assert.equal(routePath('/website-other/', data.config), null);
  assert.equal(routePath('/website/guide/scripts/', data.config), '/guide/scripts');
});

test('every public page renders on the server with unique production metadata', () => {
  const publicData = { ...data, config: { ...data.config, productionOrigin: 'https://example.org' } };
  const routes = ['', 'install', 'pricing', 'guide', 'privacy', 'license', ...data.articles.map(a => `guide/${a.slug}`)];
  const titles = new Set();
  for (const route of routes) {
    const context = { isProduction: true };
    const result = render(`/website/${route}?ignored=1`, context, publicData);
    assert.notEqual(context.status, 404);
    assert.ok(result.html.includes('<h1'));
    assert.equal(result.metadata.noindex, false);
    assert.equal(result.metadata.canonical, `https://example.org/website/${route}`);
    assert.equal(result.metadata.openGraph.url, result.metadata.canonical);
    assert.ok(!titles.has(result.metadata.title));
    titles.add(result.metadata.title);
  }
});

test('dummy checkout completion is explicit, private, and never claims payment', () => {
  const publicData = { ...data, config: { ...data.config, productionOrigin: 'https://example.org' } };
  const context = { isProduction: true };
  const result = render('/website/checkout/result?demo=complete', context, publicData);
  assert.notEqual(context.status, 404);
  assert.equal(result.metadata.noindex, true);
  assert.equal(result.metadata.canonical, undefined);
  assert.match(result.html, /Dummy checkout complete/);
  assert.match(result.html, /No payment was made/);
  assert.doesNotMatch(result.html, /Payment confirmed/);
  assert.doesNotMatch(result.html, /Download Quickque/);
});

test('preview remains noindex even with a production origin configured', () => {
  const publicData = { ...data, config: { ...data.config, productionOrigin: 'https://example.org' } };
  const result = render('/website/guide/local-flow/', { isProduction: false }, publicData);
  assert.equal(result.metadata.noindex, true);
  assert.equal(result.metadata.canonical, undefined);
  assert.ok(result.html.includes('Download'));
});

test('unknown routes and unknown article slugs are real not-found states', () => {
  for (const route of ['/website/nope/', '/website/guide/nope/']) {
    const context = { isProduction: true };
    render(route, context, data);
    assert.equal(context.status, 404);
  }
});

test('search exposes keyboard instructions and an atomic live selection announcement', () => {
  const { html } = render('/website/guide', {}, data);
  assert.match(html, /aria-describedby="search-help search-selection"/);
  assert.match(html, /id="search-selection" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /12 articles found/);
  assert.match(html, /Escape clears the search/);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSiteDataSync, readSiteConfigSync, serializeSiteData, validateProductionOrigin, routePath } from '../lib/server/content.js';
import { render } from '../dist/server/entry-server.js';
import { createServer } from '../server.js';

const data = loadSiteDataSync();

test('local font assets are actual font binaries, not downloaded error pages', () => {
  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const premiumCss = fs.readFileSync(new URL('../src/premium.css', import.meta.url), 'utf8');
  const fontUrls = [...css.matchAll(/url\(['"](\/fonts\/[^'"]+)['"]\)/g)].map(([, url]) => url);
  assert.deepEqual(new Set(fontUrls), new Set([
    '/fonts/DMSerifDisplay-Regular.ttf',
    '/fonts/Inter-Variable.ttf',
    '/fonts/manrope-variable.ttf'
  ]));
  for (const url of fontUrls) {
    const filename = url.split('/').at(-1);
    const bytes = fs.readFileSync(new URL(`../public/fonts/${filename}`, import.meta.url));
    const signature = bytes.subarray(0, 4).toString('hex');
    assert.ok(['00010000', '4f54544f', '774f4646', '774f4632'].includes(signature), `Invalid font binary: ${filename}`);
  }
});

test('first-frame HTML owns CSS ordering and only preloads useful local faces', () => {
  const template = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const premiumCss = fs.readFileSync(new URL('../src/premium.css', import.meta.url), 'utf8');
  const stylesheet = template.indexOf('data-site-stylesheet');
  const clientModule = template.indexOf('/src/entry-client.tsx');
  assert.ok(stylesheet >= 0 && stylesheet < clientModule, 'stylesheet must precede the client module');
  assert.match(template, /rel="preload" href="\/fonts\/Inter-Variable\.ttf"[^>]*as="font"/);
  assert.match(template, /rel="preload" href="\/fonts\/manrope-variable\.ttf"[^>]*as="font"/);
  assert.doesNotMatch(template, /preload[^>]+DMSerifDisplay/);

  const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /font-display:\s*swap/);
  assert.match(css, /font-size-adjust:\s*0\.52/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(premiumCss, /@media\s*\(max-width:\s*800px\)/);
});

test('SSR remains readable without JavaScript and has no remote first-frame dependencies', () => {
  const { html } = render('/', {}, data);
  const head = html;
  assert.match(head, /<h1[^>]*>Keep your place\./);
  assert.match(head, /href="\/demo\/read\/seed-1"/);
  assert.match(head, /src="\/images\/library\.webp"/);
  assert.doesNotMatch(head, /https?:\/\/[^"]+\.(?:css|woff2?|ttf)/);
  assert.doesNotMatch(head, /Loading (article|manual)/);
});

test('production revalidates HTML and stable assets while fingerprinted assets are immutable', async (t) => {
  const { httpServer } = await createServer(undefined, true);
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => httpServer.close());
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;

  const htmlResponse = await fetch(`${base}/`);
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  const html = await htmlResponse.text();
  const stylesheet = html.indexOf('rel="stylesheet"');
  const clientModule = html.indexOf('type="module"');
  assert.ok(stylesheet >= 0 && stylesheet < clientModule, 'built SSR head must load CSS before hydration');
  assert.match(html, /<h1[^>]*>Keep your place\./);

  const stylesheetHref = html.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/)?.[1];
  assert.ok(stylesheetHref, 'SSR must advertise a stylesheet');
  const cssResponse = await fetch(new URL(stylesheetHref, base));
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get('content-type') || '', /text\/css/);
  assert.equal(cssResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(await cssResponse.text(), /@font-face/);

  const fontResponse = await fetch(`${base}/fonts/Inter-Variable.ttf`);
  assert.equal(fontResponse.status, 200);
  assert.match(fontResponse.headers.get('content-type') || '', /font|octet-stream/);
  assert.equal(fontResponse.headers.get('cache-control'), 'public, max-age=604800, must-revalidate');

  const imageResponse = await fetch(`${base}/images/library.webp`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('cache-control'), 'public, max-age=604800, must-revalidate');

  const privateResponse = await fetch(`${base}/checkout/result`);
  assert.equal(privateResponse.status, 200);
  assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
  assert.equal(privateResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
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

test('root base path accepts public website routes', () => {
  assert.equal(routePath('/', data.config), '/');
  assert.equal(routePath('/guide/scripts/', data.config), '/guide/scripts');
});

test('every public page renders on the server with unique production metadata', () => {
  const publicData = { ...data, config: { ...data.config, productionOrigin: 'https://example.org' } };
  const routes = ['', 'install', 'pricing', 'guide', 'privacy', 'license', ...data.articles.map(a => `guide/${a.slug}`)];
  const titles = new Set();
  for (const route of routes) {
    const context = { isProduction: true };
    const result = render(`/${route}?ignored=1`, context, publicData);
    assert.notEqual(context.status, 404);
    assert.ok(result.html.includes('<h1'));
    assert.equal(result.metadata.noindex, false);
    assert.equal(result.metadata.canonical, `https://example.org/${route}`);
    assert.equal(result.metadata.openGraph.url, result.metadata.canonical);
    assert.ok(!titles.has(result.metadata.title));
    titles.add(result.metadata.title);
  }
});

test('dummy checkout completion is explicit, private, and never claims payment', () => {
  const publicData = { ...data, config: { ...data.config, productionOrigin: 'https://example.org' } };
  const context = { isProduction: true };
  const result = render('/checkout/result?demo=complete', context, publicData);
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
  const result = render('/guide/local-flow/', { isProduction: false }, publicData);
  assert.equal(result.metadata.noindex, true);
  assert.equal(result.metadata.canonical, undefined);
  assert.ok(result.html.includes('Download'));
});

test('unknown routes and unknown article slugs are real not-found states', () => {
  for (const route of ['/nope/', '/guide/nope/']) {
    const context = { isProduction: true };
    render(route, context, data);
    assert.equal(context.status, 404);
  }
});

test('search exposes keyboard instructions and an atomic live selection announcement', () => {
  const { html } = render('/guide', {}, data);
  assert.match(html, /aria-describedby="search-help search-selection"/);
  assert.match(html, /id="search-selection" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /12 articles found/);
  assert.match(html, /Escape clears the search/);
});

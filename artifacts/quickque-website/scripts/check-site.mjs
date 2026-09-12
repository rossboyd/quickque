import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const here = new URL('../', import.meta.url);
const config = JSON.parse(await fs.readFile(new URL('config/site.json', here), 'utf8'));
const files = (await fs.readdir(new URL('content/guide/', here))).filter(f => f.endsWith('.json'));
const articles = await Promise.all(files.map(async file => JSON.parse(await fs.readFile(new URL(`content/guide/${file}`, here), 'utf8'))));
const required = ['requirements-installation', 'first-presentation', 'scripts', 'document-import', 'backup-restore', 'playback', 'mac-overlay', 'local-flow', 'phone-remote', 'privacy', 'updating-uninstalling', 'contributing'];
assert.deepEqual(articles.map(a => a.slug).sort(), required.sort(), 'Required guide inventory');
assert.equal(config.release.status, 'unavailable', 'Do not enable prebuilt install without a verified installer implementation');
assert.equal(config.repository, 'https://github.com/rossboyd/quickque');
const updateArticle = articles.find(a => a.slug === 'updating-uninstalling');
assert.ok(!updateArticle.body.includes('{{SOURCE_COMMAND}}'), 'Existing-checkout updates must not clone again');
assert.match(updateArticle.body, /git pull --ff-only[\s\S]*pnpm install --frozen-lockfile[\s\S]*desktop:build/, 'Reproducible existing-checkout update sequence');
for (const article of articles) {
  for (const field of ['slug', 'title', 'description', 'category', 'body']) assert.equal(typeof article[field], 'string', `${article.slug}.${field}`);
  assert.ok(article.body.length > 1000, `Complete article: ${article.slug}`);
  assert.match(article.body, /^1\. /m, `Numbered instructions: ${article.slug}`);
  assert.match(article.body, /troubleshoot/i, `Troubleshooting: ${article.slug}`);
  for (const match of article.body.matchAll(/\]\(\/guide\/([^/#)]+)\/?(?:#[^)]*)?\)/g)) {
    assert.ok(required.includes(match[1]), `Unknown article ${match[1]} in ${article.slug}`);
  }
}
execFileSync(process.execPath, [new URL('scripts/sync-readme.mjs', here).pathname, '--check'], { stdio: 'inherit' });
const rootLicense = await fs.readFile(new URL('../../LICENSE', here), 'utf8');
assert.match(rootLicense, /Permission is hereby granted, free of charge/);
assert.match(rootLicense, /THE SOFTWARE IS PROVIDED "AS IS"/);
assert.doesNotMatch(rootLicense, /37signals/);
process.stdout.write(`Content: ${articles.length} complete articles; source-build instructions and license consistent.\n`);

if (!process.argv.includes('--content-only')) {
  // The managed preview is the default. CI supplies a test server URL explicitly.
  const base = new URL(process.env.SITE_CHECK_URL || `http://localhost:80${config.basePath}`);
  const paths = ['', 'install/', 'pricing/', 'checkout/result/', 'guide/', 'privacy/', 'license/', ...articles.map(a => `guide/${a.slug}/`)];
  const pages = new Map();
  const titles = new Set();
  const descriptions = new Set();
  for (const route of paths) {
    const response = await fetch(new URL(route, base));
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/)?.[1];
    assert.ok(title && !titles.has(title), `Unique title: ${route}`);
    assert.ok(description && !descriptions.has(description), `Unique description: ${route}`);
    titles.add(title); descriptions.add(description);
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1, `One h1: ${route}`);
    assert.match(html, /property="og:title"/, `Social metadata: ${route}`);
    assert.match(html, /application\/ld\+json/, `Structured data: ${route}`);
    if (!config.productionOrigin) {
      assert.match(html, /noindex/, `Preview noindex: ${route}`);
      assert.doesNotMatch(html, /rel="canonical"/, `No invented canonical: ${route}`);
    }
    assert.doesNotMatch(html, /Loading (article|manual)|\{\{SOURCE_COMMAND\}\}/, `Initial content: ${route}`);
    if (route.startsWith('guide/') && route !== 'guide/') {
      const article = articles.find(a => route === `guide/${a.slug}/`);
      assert.ok(html.includes(article.title), `Server-rendered title: ${route}`);
      assert.match(html, /Troubleshooting|troubleshooting/, `Server-rendered article body: ${route}`);
      assert.ok(html.includes(`/edit/${config.branch}/artifacts/quickque-website/content/guide/${article.slug}.json`), `Edit source: ${route}`);
    }
    if (route === 'install/') {
      const cloneBlocks = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].filter(m => m[1].includes('git clone'));
      assert.equal(cloneBlocks.length, 1, 'Installation must have one complete clone/build sequence');
    }
    if (route === 'pricing/') {
      assert.ok(html.includes(config.commerce.displayPrice), 'Pricing is server rendered');
      assert.match(html, /major upgrades/i, 'Forever licence excludes promised free major upgrades');
      assert.match(html, /MIT/, 'Paid package does not replace the MIT source licence');
    }
    if (route === 'checkout/result/') {
      assert.match(html, /noindex/, 'Private payment results must never be indexed');
      assert.doesNotMatch(html, /rel="canonical"/, 'Payment results must not have public canonicals');
    }
    pages.set(new URL(route, base).pathname.replace(/\/$/, ''), html);
  }
  const checkedAssets = new Set();
  for (const [pathname, html] of pages) {
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const m of html.matchAll(/<(?:a|img|link)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) {
      const raw = m[1].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:|data:)/.test(raw)) continue;
      const target = new URL(raw, new URL(pathname + '/', base));
      assert.ok(target.pathname.startsWith(config.basePath.replace(/\/$/, '')), `Link escapes artifact: ${raw}`);
      const key = target.pathname.replace(/\/$/, '');
      const targetHtml = pages.get(key);
      if (targetHtml) {
        if (target.hash) {
          const targetIds = key === pathname ? ids : new Set([...targetHtml.matchAll(/\bid="([^"]+)"/g)].map(x => x[1]));
          assert.ok(targetIds.has(decodeURIComponent(target.hash.slice(1))), `Broken anchor: ${raw} from ${pathname}`);
        }
      } else if (!checkedAssets.has(target.href)) {
        const response = await fetch(target);
        assert.equal(response.status, 200, `Broken link/image: ${target.href}`);
        checkedAssets.add(target.href);
      }
    }
  }
  for (const missing of ['missing-page/', 'guide/missing-article/']) {
    const response = await fetch(new URL(missing, base));
    assert.equal(response.status, 404, `Real 404: ${missing}`);
  }
  const robots = await (await fetch(new URL('robots.txt', base))).text();
  assert.match(robots, /User-agent:/);
  const sitemapResponse = await fetch(new URL('sitemap.xml', base));
  assert.equal(sitemapResponse.status, 200);
  const sitemap = await sitemapResponse.text();
  assert.match(sitemap, /urlset/);
  assert.doesNotMatch(sitemap, /\.replit\.dev/);
  process.stdout.write(`HTTP: ${pages.size} initial-HTML pages, metadata, links, images, anchors, robots, sitemap and real 404s passed.\n`);
}
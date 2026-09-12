import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(moduleDirectory, '../..');

export const DEFAULT_BASE_PATH = '/website';

function fail(message) {
  throw new Error(`Quickque website configuration error: ${message}`);
}

export function normalizeBasePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    fail('basePath must be an absolute URL path.');
  }

  if (value.includes('?') || value.includes('#') || value.includes('//')) {
    fail('basePath must not contain a query, fragment, or repeated slash.');
  }

  const withoutTrailingSlash = value.replace(/\/+$/, '');
  if (withoutTrailingSlash === '') return '';

  const segments = withoutTrailingSlash.split('/').slice(1);
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '')) {
    fail('basePath contains an invalid path segment.');
  }

  return withoutTrailingSlash;
}

export function basePathWithSlash(basePath) {
  const normalized = normalizeBasePath(basePath);
  return normalized ? `${normalized}/` : '/';
}

function isDisallowedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    host === 'localhost' ||
    host === 'local' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.replit.dev') ||
    host.endsWith('.repl.co')
  );
}

export function validateProductionOrigin(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    fail('productionOrigin must be null or an absolute HTTPS origin.');
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail('productionOrigin must be a valid absolute HTTPS origin.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    isDisallowedHost(parsed.hostname)
  ) {
    fail('productionOrigin must be HTTPS, host-only, and not a local or temporary preview origin.');
  }

  return parsed.origin;
}

function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    fail('config/site.json must contain a JSON object.');
  }

  if (typeof config.repository !== 'string' || config.repository.trim() === '') {
    fail('repository is required.');
  }
  if (typeof config.branch !== 'string' || config.branch.trim() === '') {
    fail('branch is required.');
  }
  if (typeof config.guideVersion !== 'string' || config.guideVersion.trim() === '') {
    fail('guideVersion is required.');
  }
  if (typeof config.sourceCommand !== 'string' || config.sourceCommand.trim() === '') {
    fail('sourceCommand is required.');
  }
  if (!Object.prototype.hasOwnProperty.call(config, 'productionOrigin')) {
    fail('productionOrigin must be explicitly set to null or a verified HTTPS origin.');
  }
  if (!config.release || typeof config.release !== 'object' || Array.isArray(config.release)) {
    fail('release is required.');
  }
  if (config.release.status !== 'unavailable') {
    fail(`release.status must be "unavailable" (received ${String(config.release.status)}).`);
  }
  const offer = config.commerce;
  if (!offer || offer.amount !== 7700 || offer.currency !== 'gbp' ||
      offer.billing !== 'one-time' || offer.sourceLicence !== 'MIT' ||
      offer.displayPrice !== '£77' || typeof offer.liveEnabled !== 'boolean') {
    fail('commerce must describe the £77 GBP one-time Mac package with MIT source.');
  }
  if (offer.liveEnabled && config.release.status === 'unavailable') {
    fail('Live purchases cannot be enabled without a verified Mac release.');
  }

  const basePath = normalizeBasePath(config.basePath);
  const productionOrigin = validateProductionOrigin(config.productionOrigin);
  return {
    ...config,
    basePath: basePathWithSlash(basePath),
    productionOrigin
  };
}

export function readSiteConfigSync(root = packageDirectory) {
  const configPath = path.resolve(root, 'config/site.json');
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    fail(`unable to read ${configPath}.`);
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    fail('config/site.json is not valid JSON.');
  }
  return validateConfig(config);
}

function readArticle(filePath, config) {
  let article;
  try {
    article = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(`guide article ${path.basename(filePath)} is not valid JSON.`);
  }

  if (
    !article ||
    typeof article !== 'object' ||
    typeof article.slug !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug) ||
    typeof article.title !== 'string' ||
    typeof article.description !== 'string' ||
    typeof article.category !== 'string' ||
    typeof article.body !== 'string'
  ) {
    fail(`guide article ${path.basename(filePath)} is malformed.`);
  }

  const expectedFile = `${article.slug}.json`;
  if (path.basename(filePath) !== expectedFile) {
    fail(`guide article ${path.basename(filePath)} must be named ${expectedFile}.`);
  }

  return {
    ...article,
    // Replacement is deliberately a callback so a `$&` in the configured
    // command cannot be interpreted as a String.replace substitution.
    body: article.body.replace(/\{\{SOURCE_COMMAND\}\}/g, () => config.sourceCommand)
  };
}

export function loadSiteDataSync(root = packageDirectory) {
  const config = readSiteConfigSync(root);
  const guideDirectory = path.resolve(root, 'content/guide');
  let files;
  try {
    files = fs.readdirSync(guideDirectory, { withFileTypes: true });
  } catch {
    fail(`unable to read ${guideDirectory}.`);
  }

  const articles = files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => readArticle(path.join(guideDirectory, entry.name), config))
    .sort((a, b) => {
      const order = ['requirements-installation', 'first-presentation', 'scripts', 'document-import', 'backup-restore', 'playback', 'mac-overlay', 'local-flow', 'phone-remote', 'privacy', 'updating-uninstalling', 'contributing'];
      const rank = (slug) => order.includes(slug) ? order.indexOf(slug) : order.length;
      return rank(a.slug) - rank(b.slug) || a.slug.localeCompare(b.slug);
    });

  if (articles.length === 0) {
    fail('content/guide must contain at least one article.');
  }
  if (new Set(articles.map((article) => article.slug)).size !== articles.length) {
    fail('guide article slugs must be unique.');
  }

  const licenseCandidates = [
    path.resolve(root, '../../LICENSE'),
    path.resolve(root, 'LICENSE')
  ];
  const licensePath = licenseCandidates.find((candidate) => fs.existsSync(candidate));
  if (!licensePath) {
    fail('the repository LICENSE file could not be found.');
  }

  let license;
  try {
    license = fs.readFileSync(licensePath, 'utf8');
  } catch {
    fail('the repository LICENSE file could not be read.');
  }
  if (!license) fail('the repository LICENSE file is empty.');

  return Object.freeze({
    config,
    articles: Object.freeze(articles),
    license
  });
}

export function getBasePath(config) {
  return normalizeBasePath(config.basePath);
}

export function pathWithinBase(pathname, config) {
  const basePath = getBasePath(config);
  return basePath === ''
    ? pathname.startsWith('/')
    : pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function routePath(pathname, config) {
  const basePath = getBasePath(config);
  if (!pathWithinBase(pathname, config)) return null;
  const relative = basePath === '' ? pathname : pathname.slice(basePath.length);
  const withLeadingSlash = relative || '/';
  const normalized = withLeadingSlash.replace(/\/+$/, '');
  return normalized === '' ? '/' : normalized;
}

export function serializeSiteData(siteData) {
  return JSON.stringify(siteData)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
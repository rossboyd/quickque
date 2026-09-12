import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer as createHttpServer } from 'node:http';
import { loadSiteDataSync, getBasePath, pathWithinBase, serializeSiteData } from './lib/server/content.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = __dirname;
const defaultDescription =
  'Quickque is a local-first teleprompter for speaking clearly without sending scripts or voice to the cloud.';

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizedPathname(value) {
  try {
    return new URL(value, 'http://quickque-ssr.invalid').pathname;
  } catch {
    return '/';
  }
}

function safeOrigin(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return null;
    }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host === 'local' ||
      host.endsWith('.local') ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.replit.dev') ||
      host.endsWith('.repl.co')
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function urlForRoute(origin, basePath, route) {
  const base = basePath ? `${basePath}/` : '/';
  const relative = route === '/' ? '' : route.replace(/^\/+/, '');
  return `${origin}${base}${relative}`;
}

function metadataDefaults(isProduction, config, status = 200) {
  const origin = isProduction ? safeOrigin(config.productionOrigin) : null;
  const noindex = !origin || status === 404;
  const title = status === 404 ? 'Page not found - Quickque' : 'Quickque';
  const description = status === 404 ? 'The requested Quickque website page could not be found.' : defaultDescription;
  const canonical = undefined;
  return {
    title,
    description,
    noindex,
    canonical,
    openGraph: {
      type: 'website',
      siteName: 'Quickque',
      title,
      description,
      url: canonical,
      image: undefined
    },
    twitter: {
      card: 'summary',
      title,
      description
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description
    }
  };
}

function renderMetadata(metadata) {
  const openGraph = metadata.openGraph || {};
  const twitter = metadata.twitter || {};
  const jsonLd = metadata.jsonLd || {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: metadata.title,
    description: metadata.description
  };
  const tags = [
    `<title>${htmlEscape(metadata.title || 'Quickque')}</title>`,
    `<meta name="description" content="${htmlEscape(metadata.description || defaultDescription)}">`,
    `<meta name="robots" content="${metadata.noindex ? 'noindex, nofollow' : 'index, follow'}">`,
    `<meta property="og:type" content="${htmlEscape(openGraph.type || 'website')}">`,
    `<meta property="og:site_name" content="${htmlEscape(openGraph.siteName || 'Quickque')}">`,
    `<meta property="og:title" content="${htmlEscape(openGraph.title || metadata.title || 'Quickque')}">`,
    `<meta property="og:description" content="${htmlEscape(openGraph.description || metadata.description || defaultDescription)}">`,
    `<meta name="twitter:card" content="${htmlEscape(twitter.card || 'summary')}">`,
    `<meta name="twitter:title" content="${htmlEscape(twitter.title || metadata.title || 'Quickque')}">`,
    `<meta name="twitter:description" content="${htmlEscape(twitter.description || metadata.description || defaultDescription)}">`,
    `<script id="site-jsonld" type="application/ld+json">${serializeSiteData(jsonLd)}</script>`
  ];
  if (metadata.canonical) {
    tags.push(`<link rel="canonical" href="${htmlEscape(metadata.canonical)}">`);
  }
  if (openGraph.url) {
    tags.push(`<meta property="og:url" content="${htmlEscape(openGraph.url)}">`);
  }
  if (openGraph.image) {
    tags.push(`<meta property="og:image" content="${htmlEscape(openGraph.image)}">`);
  }
  return tags.join('\n');
}

function sendBody(res, body, status, contentType) {
  res.status(status).set('Content-Type', contentType);
  if (res.req.method === 'HEAD') {
    res.set('Content-Length', Buffer.byteLength(body));
    return res.end();
  }
  return res.send(body);
}

function sendJson(res, value, status = 200) {
  const body = JSON.stringify(value);
  return sendBody(res, body, status, 'application/json; charset=utf-8');
}

function sitemapXml(siteData, isProduction) {
  const origin = isProduction ? safeOrigin(siteData.config.productionOrigin) : null;
  const basePath = getBasePath(siteData.config);
  const routes = ['/', '/install', '/guide', '/privacy', '/license', '/pricing'];
  for (const article of siteData.articles) routes.push(`/guide/${article.slug}`);
  const urls = origin
    ? routes.map((route) => `  <url><loc>${xmlEscape(urlForRoute(origin, basePath, route))}</loc></url>`).join('\n')
    : '';
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>'
  ].filter(Boolean).join('\n');
}

function robotsText(siteData, isProduction) {
  const basePath = getBasePath(siteData.config);
  const origin = isProduction ? safeOrigin(siteData.config.productionOrigin) : null;
  if (!origin) return 'User-agent: *\nDisallow: /\n';
  const prefix = basePath ? `${basePath}/` : '/';
  return [
    'User-agent: *',
    'Disallow: /',
    `Allow: ${prefix}`,
    `Sitemap: ${urlForRoute(origin, basePath, '/sitemap.xml')}`,
    ''
  ].join('\n');
}

function packageRootFor(value) {
  if (value && fs.existsSync(path.resolve(value, 'config/site.json'))) return path.resolve(value);
  return packageRoot;
}

export async function createServer(
  root = packageRoot,
  isProd = process.env.NODE_ENV === 'production',
  hmrPort,
  options = {}
) {
  // A validation server may pass options as the third argument when no HMR
  // port is needed.
  if (hmrPort && typeof hmrPort === 'object') {
    options = hmrPort;
    hmrPort = undefined;
  }
  const contentRoot = packageRootFor(root);
  const siteData = loadSiteDataSync(contentRoot);
  const configBasePath = getBasePath(siteData.config);
  const baseRoute = configBasePath || '';
  const sitemapRoutes = [`${baseRoute}/sitemap.xml` || '/sitemap.xml', '/sitemap.xml'];
  const robotsRoutes = [`${baseRoute}/robots.txt` || '/robots.txt', '/robots.txt'];
  const uniqueRoutes = (routes) => [...new Set(routes)];
  const app = express();
  const httpServer = createHttpServer(app);
  let vite;

  if (isProd) {
    if (!fs.existsSync(path.resolve(contentRoot, 'dist/client/index.html'))) {
      throw new Error('Quickque website production client build is missing.');
    }
    if (!fs.existsSync(path.resolve(contentRoot, 'dist/server/entry-server.js'))) {
      throw new Error('Quickque website production server build is missing.');
    }
    const compression = (await import('compression')).default;
    app.use(compression());
  }

  const configRoute = `${baseRoute}/api/config` || '/api/config';
  const guideRoute = `${baseRoute}/api/guide` || '/api/guide';
  app.get(configRoute, (req, res) => sendJson(res, siteData.config));
  app.get(guideRoute, (req, res) => sendJson(res, siteData.articles));
  app.get(`${guideRoute}/:slug`, (req, res) => {
    let slug;
    try {
      slug = decodeURIComponent(req.params.slug);
    } catch {
      return sendJson(res, { error: 'Article not found' }, 404);
    }
    const article = siteData.articles.find((candidate) => candidate.slug === slug);
    return article
      ? sendJson(res, article)
      : sendJson(res, { error: 'Article not found' }, 404);
  });
  app.get(`${baseRoute}/api/license` || '/api/license', (req, res) => sendBody(res, siteData.license, 200, 'text/plain; charset=utf-8'));

  const webhookRoute = `${baseRoute}/api/stripe/webhook` || '/api/stripe/webhook';
  app.post(webhookRoute, (_req, res) =>
    sendJson(res, { error: 'Payment webhooks are disabled while dummy checkout is active.' }, 410)
  );

  app.use(express.json({ limit: '16kb' }));
  const commerceStatusRoute = `${baseRoute}/api/commerce/status` || '/api/commerce/status';
  const commerceCheckoutRoute = `${baseRoute}/api/commerce/checkout` || '/api/commerce/checkout';
  const commerceSessionRoute = `${baseRoute}/api/commerce/session` || '/api/commerce/session';
  app.get(commerceStatusRoute, (_req, res) =>
    sendJson(res, { available: false, mode: 'dummy', message: 'Payment checkout is disabled. The demo runs only in your browser.' }, 410)
  );
  app.post(commerceCheckoutRoute, (_req, res) =>
    sendJson(res, { error: 'Payment checkout is disabled. No purchase can be created.' }, 410)
  );
  app.get(commerceSessionRoute, (_req, res) =>
    sendJson(res, {
      status: 'disabled',
      mode: 'dummy',
      version: null,
      downloadUrl: null,
      message: 'Payment verification is disabled. No payment, licence, or download was created.'
    }, 410)
  );

  // The result page is intentionally never cacheable or indexable. The client
  // page also supplies noindex metadata, while these headers cover direct SSR.
  app.use(`${baseRoute}/checkout/result`, (req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow'
    });
    next();
  });

  const sitemapHandler = (req, res) => sendBody(res, sitemapXml(siteData, isProd), 200, 'application/xml; charset=utf-8');
  const robotsHandler = (req, res) => sendBody(res, robotsText(siteData, isProd), 200, 'text/plain; charset=utf-8');
  app.get(uniqueRoutes(sitemapRoutes), sitemapHandler);
  app.get(uniqueRoutes(robotsRoutes), robotsHandler);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      root: contentRoot,
      logLevel: process.env.VITEST ? 'error' : 'info',
      server: {
        middlewareMode: true,
        watch: {
          usePolling: true,
          interval: 100
        },
        hmr: { server: httpServer, path: `${baseRoute}/vite-hmr`, ...(hmrPort ? { clientPort: hmrPort } : {}) }
      },
      appType: 'custom'
    });
    app.use(vite.middlewares);
  } else {
    app.use(
      configBasePath || '/',
      express.static(path.resolve(contentRoot, 'dist/client'), {
        index: false,
        fallthrough: true
      })
    );
  }

  app.use(async (req, res, next) => {
    const pathname = normalizedPathname(req.originalUrl);
    if (pathname === '/' && configBasePath) {
      return res.redirect(308, `${configBasePath}/`);
    }
    if (!pathWithinBase(pathname, siteData.config)) return next();

    try {
      const templatePath = isProd
        ? path.resolve(contentRoot, 'dist/client/index.html')
        : path.resolve(contentRoot, 'index.html');
      let template = fs.readFileSync(templatePath, 'utf8');
      let render;
      if (!isProd) {
        template = await vite.transformIndexHtml(req.originalUrl, template);
        render = (await vite.ssrLoadModule('/src/entry-server.tsx')).render;
      } else {
        render = (await import(pathToFileURL(path.resolve(contentRoot, 'dist/server/entry-server.js')).href)).render;
      }

      const context = {
        isProduction: Boolean(isProd),
        isPreview: !isProd,
        siteData,
        status: 200
      };
      const rendered = await render(req.originalUrl, context, siteData);
      const status = context.status === 404 ? 404 : 200;
      const metadata = {
        ...metadataDefaults(Boolean(isProd), siteData.config, status),
        ...(rendered.metadata || {})
      };
      if (status === 404) {
        Object.assign(metadata, metadataDefaults(Boolean(isProd), siteData.config, 404));
      }
      template = template
        .replace('<!--app-head-->', `${renderMetadata(metadata)}\n<link rel="icon" type="image/png" href="${htmlEscape(`${baseRoute}/logo.png`)}">`)
        .replace('<!--site-data-->', `<script id="site-data" type="application/json">${serializeSiteData(siteData)}</script>`)
        .replace(
          /<meta name="site-runtime" content="[^"]*"\s*\/?>/,
          `<meta name="site-runtime" content="${isProd ? 'production' : 'development'}">`
        );
      const html = template.replace('<!--app-html-->', rendered.html);
      return sendBody(res, html, status, 'text/html; charset=utf-8');
    } catch (error) {
      if (!isProd && vite) vite.ssrFixStacktrace(error);
      console.error(isProd ? 'Quickque SSR request failed.' : error);
      return sendBody(res, 'Internal server error', 500, 'text/plain; charset=utf-8');
    }
  });

  app.use((req, res) => {
    sendBody(res, 'Not found', 404, 'text/plain; charset=utf-8');
  });

  return { app, httpServer, vite, siteData };
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === path.resolve(fileURLToPath(import.meta.url))) {
  createServer()
    .then(({ httpServer }) => {
      const port = Number(process.env.PORT || 3000);
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`Quickque website listening on port ${port}.`);
      });
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Unable to start Quickque website.');
      process.exitCode = 1;
    });
}
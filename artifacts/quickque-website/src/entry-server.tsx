import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './App';
import { SiteDataProvider, type SiteData } from './lib/site-data';
import { Router } from 'wouter';

function pathnameFromUrl(url: string) {
  try {
    return new URL(url, 'http://quickque-ssr.invalid').pathname;
  } catch {
    return '/';
  }
}

function routeForPath(pathname: string, basePath: string) {
  const normalizedBase = basePath.replace(/\/+$/, '');
  if (normalizedBase && pathname !== normalizedBase && !pathname.startsWith(`${normalizedBase}/`)) {
    return null;
  }
  const relative = normalizedBase ? pathname.slice(normalizedBase.length) : pathname;
  const route = relative.replace(/\/+$/, '');
  return route || '/';
}

function markUnknownRoute(route: string | null, siteData: SiteData | null, context: any) {
  if (!route) {
    context.status = 404;
    return;
  }
  const known = new Set(['/', '/install', '/guide', '/privacy', '/license', '/pricing', '/checkout/result']);
  if (known.has(route)) return;
  if (route.startsWith('/guide/')) {
    const slug = route.slice('/guide/'.length);
    if (siteData?.articles.some((article) => article.slug === slug)) return;
  }
  context.status = 404;
}

export function render(url: string, context: any = {}, suppliedSiteData?: SiteData | null) {
  const siteData = suppliedSiteData ?? context.siteData ?? null;
  const basePath = siteData?.config.basePath || '/website/';
  const pathname = pathnameFromUrl(url).replace(/\/+$/, '') || '/';
  const route = routeForPath(pathname, basePath);
  markUnknownRoute(route, siteData, context);

  const html = renderToString(
    <React.StrictMode>
      <SiteDataProvider data={siteData}>
        <Router base={basePath.replace(/\/+$/, '')} ssrPath={pathname}>
          <App context={context} />
        </Router>
      </SiteDataProvider>
    </React.StrictMode>
  );

  return { html, metadata: context.metadata || {} };
}
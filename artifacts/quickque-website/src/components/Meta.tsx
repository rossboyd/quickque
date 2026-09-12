import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useSiteConfig } from '../hooks/useData';

interface MetaProps {
  title?: string;
  description?: string;
  context?: any;
  noindex?: boolean;
}

const defaultDescription =
  'Quickque is a local-first teleprompter for speaking clearly without sending scripts or voice to the cloud.';

function safeProductionOrigin(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const origin = new URL(value);
    const hostname = origin.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      origin.protocol !== 'https:' ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      hostname === 'localhost' ||
      hostname === 'local' ||
      hostname.endsWith('.local') ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname.endsWith('.replit.dev') ||
      hostname.endsWith('.repl.co')
    ) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

function normalizedRoute(location: string, basePath: string) {
  const withoutQuery = location.split(/[?#]/, 1)[0] || '/';
  const base = basePath.replace(/\/+$/, '');
  const relative = base && withoutQuery.startsWith(`${base}/`)
    ? withoutQuery.slice(base.length)
    : withoutQuery;
  const route = relative.replace(/\/+$/, '');
  return route || '/';
}

function runtimeIsProduction(context?: any) {
  if (typeof context?.isProduction === 'boolean') return context.isProduction;
  if (typeof document === 'undefined') return false;
  return document.querySelector('meta[name="site-runtime"]')?.getAttribute('content') === 'production';
}

function setMeta(attribute: 'name' | 'property', key: string, content: string | undefined) {
  if (typeof document === 'undefined') return;
  let element = document.querySelector(`meta[${attribute}="${key}"]`);
  if (!content) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

export function Meta({ title, description, context, noindex = false }: MetaProps) {
  const { config } = useSiteConfig();
  const [location] = useLocation();
  const production = runtimeIsProduction(context);
  const origin = production ? safeProductionOrigin(config?.productionOrigin) : null;
  const basePath = config?.basePath || '/website/';
  const route = normalizedRoute(location, basePath);
  const routeTitle =
    route === '/install'
      ? 'Install Quickque'
      : route === '/privacy'
        ? 'Privacy at Quickque'
        : title;
  const routeDescription =
    route === '/install'
      ? 'Install Quickque from source on a supported Apple Silicon Mac.'
      : route === '/privacy'
        ? 'How Quickque keeps scripts and voice data local to your device.'
        : description;
  const resolvedTitle = routeTitle ? `${routeTitle} - Quickque` : 'Quickque';
  const fullDescription = routeDescription || defaultDescription;
  const routePath = route === '/' ? '/' : route;
  const canonical = origin && !noindex
    ? `${origin}${basePath.replace(/\/+$/, '')}${routePath === '/' ? '/' : routePath}`
    : undefined;
  const metadata = {
    title: resolvedTitle,
    description: fullDescription,
    noindex: noindex || !canonical,
    canonical,
    openGraph: {
      type: 'website',
      siteName: 'Quickque',
      title: resolvedTitle,
      description: fullDescription,
      url: canonical,
      image: canonical ? `${origin}${basePath.replace(/\/+$/, '')}/logo.png` : undefined
    },
    twitter: {
      card: 'summary',
      title: resolvedTitle,
      description: fullDescription
    },
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: resolvedTitle,
      description: fullDescription,
      ...(canonical ? { url: canonical } : {})
    }
  };

  if (context) {
    context.metadata = metadata;
  }

  useEffect(() => {
    document.title = resolvedTitle;
    setMeta('name', 'description', fullDescription);
    setMeta('name', 'robots', metadata.noindex ? 'noindex, nofollow' : undefined);
    setMeta('property', 'og:type', metadata.openGraph.type);
    setMeta('property', 'og:site_name', metadata.openGraph.siteName);
    setMeta('property', 'og:title', metadata.openGraph.title);
    setMeta('property', 'og:description', metadata.openGraph.description);
    setMeta('property', 'og:url', metadata.openGraph.url);
    setMeta('property', 'og:image', metadata.openGraph.image);
    setMeta('name', 'twitter:card', metadata.twitter.card);
    setMeta('name', 'twitter:title', metadata.twitter.title);
    setMeta('name', 'twitter:description', metadata.twitter.description);

    let jsonLd = document.getElementById('site-jsonld') as HTMLScriptElement | null;
    if (!jsonLd) {
      jsonLd = document.createElement('script');
      jsonLd.id = 'site-jsonld';
      jsonLd.type = 'application/ld+json';
      document.head.appendChild(jsonLd);
    }
    jsonLd.textContent = JSON.stringify(metadata.jsonLd);

    const linkCanonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      linkCanonical?.remove();
    } else {
      const link = linkCanonical || document.createElement('link');
      link.setAttribute('rel', 'canonical');
      link.setAttribute('href', canonical);
      if (!linkCanonical) document.head.appendChild(link);
    }
  }, [
    canonical,
    fullDescription,
    resolvedTitle,
    metadata.jsonLd,
    metadata.noindex,
    metadata.openGraph.description,
    metadata.openGraph.image,
    metadata.openGraph.siteName,
    metadata.openGraph.title,
    metadata.openGraph.type,
    metadata.openGraph.url,
    metadata.twitter.card,
    metadata.twitter.description,
    metadata.twitter.title
  ]);

  return null;
}
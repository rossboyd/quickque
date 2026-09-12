import { useSiteData } from '../lib/site-data';

function articleForSite(article: any, basePath: string) {
  const base = basePath.replace(/\/+$/, '');
  if (!article || !base) return article;
  return {
    ...article,
    // Guide JSON intentionally uses site-relative links. Resolve those links
    // for the mounted website without changing the source content in SiteData.
    body: typeof article.body === 'string'
      ? article.body.replace(/\]\(\/(guide|images)\//g, `](${base}/$1/`)
      : article.body
  };
}

/**
 * Website content is loaded by the server before rendering and serialized into
 * the document for hydration. These hooks intentionally do not fetch: pages
 * have the same data during SSR, hydration, and client-side navigation.
 */
export function useSiteConfig() {
  const siteData = useSiteData();
  const config = siteData?.config ?? null;
  return {
    config,
    error: !config,
    loading: false
  };
}

export function useGuideIndex() {
  const siteData = useSiteData();
  const articles = siteData?.articles.map((article) =>
    articleForSite(article, siteData.config.basePath)
  ) ?? [];
  return {
    articles,
    error: !siteData,
    loading: false
  };
}

export function useGuideArticle(slug: string) {
  const siteData = useSiteData();
  const sourceArticle = siteData?.articles.find((candidate) => candidate.slug === slug) ?? null;
  const article = sourceArticle
    ? articleForSite(sourceArticle, siteData?.config.basePath || '')
    : null;
  return {
    article,
    error: !siteData || !article,
    loading: false
  };
}

export function useLicense() {
  const siteData = useSiteData();
  const license = siteData?.license ?? '';
  return {
    license,
    error: !siteData || !license,
    loading: false
  };
}
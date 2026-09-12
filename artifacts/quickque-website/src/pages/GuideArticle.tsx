import React from 'react';
import { Link, useRoute } from 'wouter';
import { useGuideArticle, useGuideIndex, useSiteConfig } from '../hooks/useData';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Meta } from '../components/Meta';
import { MarkdownView } from './MarkdownView';
import { NotFoundPage } from './NotFound';

export function extractTOC(markdown: string) {
  const headings: { depth: number; text: string; id: string }[] = [];
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    
    const match = line.match(/^(#{2,3})\s+(.*)/);
    if (match) {
      const depth = match[1].length;
      const text = match[2].replace(/[*`_]/g, '');
      const id = text.toLowerCase().replace(/[^\w]+/g, '-');
      headings.push({ depth, text, id });
    }
  }
  return headings;
}

export function GuideArticlePage({ context }: { context?: any }) {
  const [, params] = useRoute('/guide/:slug');
  const slug = params?.slug || '';
  
  const { article, loading, error } = useGuideArticle(slug);
  const { articles } = useGuideIndex();
  const { config } = useSiteConfig();

  if (loading) return <div className="p-8 text-center text-[var(--text-muted)]">Loading article...</div>;
  if (error || !article) return <NotFoundPage context={context} />;

  let prevArticle = null;
  let nextArticle = null;
  if (articles.length > 0) {
    const currentIndex = articles.findIndex(a => a.slug === slug);
    if (currentIndex > 0) prevArticle = articles[currentIndex - 1];
    if (currentIndex < articles.length - 1) nextArticle = articles[currentIndex + 1];
  }

  const toc = extractTOC(article.body || '');
  const editLink = config?.repository ? `${config.repository}/edit/${config.branch || 'main'}/artifacts/quickque-website/content/guide/${slug}.json` : undefined;

  return (
    <div className="max-w-6xl mx-auto w-full px-4 py-16 flex flex-col md:flex-row gap-12 items-start">
      <Meta title={article.title} description={article.description} context={context} />
      
      {/* Sidebar Nav */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col gap-8 sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-4">
        <nav>
          <div className="text-sm font-semibold mb-3 text-[var(--text-muted)] uppercase tracking-wider">Manual</div>
          <div className="flex flex-col gap-1.5 text-sm">
            {articles.map(a => (
              <Link 
                key={a.slug} 
                href={`/guide/${a.slug}`}
                className={`block py-1.5 px-2 -mx-2 rounded transition-colors ${
                  a.slug === slug 
                    ? 'bg-[var(--surface)] text-[var(--accent)] font-medium' 
                    : 'text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)]'
                }`}
              >
                {a.title}
              </Link>
            ))}
          </div>
        </nav>
        
        {toc.length > 0 && (
          <nav aria-label="Table of Contents">
            <div className="text-sm font-semibold mb-3 text-[var(--text-muted)] uppercase tracking-wider">On this page</div>
            <div className="flex flex-col gap-1.5 text-sm">
              {toc.map((h, i) => (
                <a 
                  key={`${h.id}-${i}`} 
                  href={`#${h.id}`}
                  className={`block py-1 transition-colors text-[var(--text-muted)] hover:text-[var(--foreground)] ${h.depth === 3 ? 'pl-4' : ''}`}
                >
                  {h.text}
                </a>
              ))}
            </div>
          </nav>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 max-w-3xl">
        <details className="md:hidden border border-[var(--border)] rounded p-4 mb-6">
          <summary className="cursor-pointer font-medium">Browse the guide</summary>
          <nav aria-label="Guide articles" className="flex flex-col gap-3 mt-4 text-sm">
            {articles.map(a => <Link key={a.slug} href={`/guide/${a.slug}`} aria-current={a.slug === slug ? 'page' : undefined}>{a.title}</Link>)}
          </nav>
        </details>
        <details className="md:hidden border border-[var(--border)] rounded p-4 mb-6">
          <summary className="cursor-pointer font-medium">On this page</summary>
          <nav aria-label="Table of contents" className="flex flex-col gap-3 mt-4 text-sm">
            {toc.map((h, i) => <a key={`${h.id}-${i}`} href={`#${h.id}`}>{h.text}</a>)}
          </nav>
        </details>
        <nav className="mb-6 text-sm text-[var(--text-muted)] flex items-center gap-2 md:hidden" aria-label="Breadcrumb">
          <Link href="/guide" className="hover:text-[var(--foreground)] transition-colors">Manual</Link>
          <span>/</span>
          <span className="text-[var(--foreground)] truncate" aria-current="page">{article.title}</span>
        </nav>

        <nav className="mb-8 text-sm text-[var(--text-muted)] hidden md:flex items-center gap-2" aria-label="Breadcrumb">
          <Link href="/guide" className="hover:text-[var(--foreground)] transition-colors">Manual</Link>
          <span>/</span>
          <span>{article.category}</span>
          <span>/</span>
          <span className="text-[var(--foreground)] truncate" aria-current="page">{article.title}</span>
        </nav>
        
        <div className="mb-12 pb-8 border-b border-[var(--border)]">
          <h1 className="text-4xl font-semibold mb-4">{article.title}</h1>
          <p className="text-xl text-[var(--text-muted)]">{article.description}</p>
          <p className="mt-4 text-sm text-[var(--text-muted)]">{config?.guideVersion}</p>
        </div>

        <MarkdownView content={article.body || ''} basePath={config?.basePath} />

        <div className="mt-16 pt-8 border-t border-[var(--border)] flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex-1 w-full sm:w-auto">
            {prevArticle && (
              <Link href={`/guide/${prevArticle.slug}`} className="flex flex-col group">
                <span className="text-sm text-[var(--text-muted)] flex items-center gap-1 mb-1">
                  <ChevronLeft size={14} /> Previous
                </span>
                <span className="font-medium group-hover:text-[var(--accent)] transition-colors">
                  {prevArticle.title}
                </span>
              </Link>
            )}
          </div>
          
          <div className="flex-1 w-full sm:w-auto text-right">
            {nextArticle && (
              <Link href={`/guide/${nextArticle.slug}`} className="flex flex-col items-end group">
                <span className="text-sm text-[var(--text-muted)] flex items-center gap-1 mb-1">
                  Next <ChevronRight size={14} />
                </span>
                <span className="font-medium group-hover:text-[var(--accent)] transition-colors">
                  {nextArticle.title}
                </span>
              </Link>
            )}
          </div>
        </div>

        {editLink && (
          <div className="mt-12 text-center">
            <a 
              href={editLink}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              Edit this page on GitHub
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
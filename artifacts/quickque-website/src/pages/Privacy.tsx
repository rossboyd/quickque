import React from 'react';
import { useGuideArticle, useSiteConfig } from '../hooks/useData';
import { Meta } from '../components/Meta';
import { MarkdownView } from './MarkdownView';

export function PrivacyPage({ context }: { context?: any }) {
  const { article, loading, error } = useGuideArticle('privacy');
  const { config } = useSiteConfig();

  if (loading) return <div className="p-8 text-center text-[var(--text-muted)]">Loading privacy policy...</div>;
  if (error || !article) return <div className="p-8 text-center text-red-600">Failed to load privacy policy.</div>;

  const editLink = config?.repository ? `${config.repository}/edit/${config.branch || 'main'}/artifacts/quickque-website/content/guide/privacy.json` : undefined;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-16">
      <Meta title="Privacy Policy" description="Quickque's local-first privacy commitments." context={context} />
      <div className="mb-12 border-b border-[var(--border)] pb-8">
        <h1 className="text-4xl font-semibold mb-4">{article.title}</h1>
        <p className="text-xl text-[var(--text-muted)]">{article.description}</p>
      </div>

      <MarkdownView content={article.body || ''} basePath={config?.basePath} />
      
      {editLink && (
        <div className="mt-16 pt-8 border-t border-[var(--border)]">
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
  );
}
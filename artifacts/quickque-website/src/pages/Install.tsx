import React from 'react';
import { useGuideArticle, useSiteConfig } from '../hooks/useData';
import { Meta } from '../components/Meta';
import { MarkdownView } from './MarkdownView';
import { DownloadGate } from '../components/DownloadGate';

export function InstallPage({ context }: { context?: any }) {
  const { article, loading, error } = useGuideArticle('requirements-installation');
  const { config } = useSiteConfig();

  if (loading) return <div className="p-8 text-center text-[var(--text-muted)]">Loading installation guide...</div>;
  if (error || !article) return <div className="p-8 text-center text-red-600">Failed to load installation guide.</div>;

  const editLink = config?.repository ? `${config.repository}/edit/${config.branch || 'main'}/artifacts/quickque-website/content/guide/requirements-installation.json` : undefined;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-16">
      <Meta title="Install Quickque" description="Download the Apple Silicon test DMG or build Quickque from source." context={context} />
      <div className="mb-10 border-b border-[var(--border)] pb-8">
        <h1 className="text-4xl font-semibold mb-4">Install Quickque</h1>
        <p className="text-xl text-[var(--text-muted)]">Get the desktop app for your Mac.</p>
      </div>

      <div className="mb-16">
        <DownloadGate />
      </div>

      <div className="prose mb-12 border-t border-[var(--border)] pt-12">
        <h2 className="!mt-0 mb-6">{article.title}</h2>
        <MarkdownView content={article.body || ''} basePath={config?.basePath} />
      </div>

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
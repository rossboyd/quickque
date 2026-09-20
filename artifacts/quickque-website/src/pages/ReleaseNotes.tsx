import React from 'react';
import { ExternalLink, Github, Wrench } from 'lucide-react';
import { useLocation } from 'wouter';
import { Meta } from '../components/Meta';
import { useSiteConfig } from '../hooks/useData';

export function ReleaseNotesPage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  const [location] = useLocation();
  const isChangelog = location.replace(/\/+$/, '') === '/changelog';
  const release = config?.release;
  const repository = config?.repository || 'https://github.com/rossboyd/quickque';
  const releasesUrl = `${repository.replace(/\/+$/, '')}/releases`;
  const releaseDetailsUrl = release?.downloadPageUrl || releasesUrl;
  const pageTitle = isChangelog ? 'Changelog' : 'Release notes';

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-16">
      <Meta
        title={pageTitle}
        description={isChangelog
          ? 'Quickque project changelog with evidence-backed source, test-build, and public release status.'
          : 'Evidence-backed Quickque source, test-build, and public release status.'}
        context={context}
      />
      <div className="mb-12 border-b border-[var(--border)] pb-8">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)] mb-4">Project history</p>
        <h1 className="text-4xl font-semibold mb-4">{pageTitle}</h1>
        <p className="text-xl text-[var(--text-muted)]">
          Release information is maintained with the Quickque website source. This page separates current source and test-build work from verified public releases.
        </p>
      </div>

      <section className="mb-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex items-start gap-4">
          <Wrench className="mt-1 shrink-0 text-[var(--accent)]" size={24} aria-hidden="true" />
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">Current source</p>
            <h2 className="text-2xl font-semibold mb-3">{config?.guideVersion || 'Current source'}</h2>
            <p className="leading-relaxed text-[var(--text-muted)]">
              The repository is the current source of truth for ongoing work. Building from source is available for contributors who can meet the documented Apple Silicon and macOS requirements; a source build is not the same as a verified public release.
            </p>
          </div>
        </div>
      </section>

      <section className="mb-10 space-y-5">
        <h2 className="text-2xl font-semibold">Verified public releases</h2>
        {release?.status === 'available' ? (
          <p className="leading-relaxed text-[var(--text-muted)]">
            The current verified release is <strong>{release.tag || 'available release'}</strong>. Check GitHub for its release notes and download details.
          </p>
        ) : (
          <p className="leading-relaxed text-[var(--text-muted)]">
            There is no verified public release or prebuilt download at this time. The Mac installer remains unavailable until the release asset is uploaded and native Mac verification is complete.
          </p>
        )}
        <a
          href={releasesUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-[var(--accent)] underline underline-offset-4"
        >
          Browse GitHub Releases <Github size={16} aria-hidden="true" />
        </a>
      </section>

      <section className="mb-10 border-t border-[var(--border)] pt-10">
        <h2 className="text-2xl font-semibold mb-4">Release history</h2>
        <article className="rounded-2xl border border-[var(--border)] p-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-[var(--text-muted)] mb-2">
            {release?.tag || 'Current test build'}
          </p>
          <h3 className="text-xl font-semibold mb-3">Test release in preparation</h3>
          <p className="leading-relaxed text-[var(--text-muted)]">
            This source configuration records a test release being prepared. It is not presented as a verified public release, and no release date or shipped-feature list is inferred here.
          </p>
          {typeof release?.reason === 'string' && release.reason && (
            <p className="mt-4 leading-relaxed text-[var(--text-muted)]">{release.reason}</p>
          )}
          <a
            href={releaseDetailsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-5 inline-flex items-center gap-2 text-[var(--accent)] underline underline-offset-4"
          >
            View GitHub release details <ExternalLink size={15} aria-hidden="true" />
          </a>
        </article>
      </section>
    </div>
  );
}
import React from 'react';
import { ExternalLink, Github, ShieldAlert } from 'lucide-react';
import { Meta } from '../components/Meta';
import { useSiteConfig } from '../hooks/useData';

export function SupportPage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  const repository = config?.repository || 'https://github.com/rossboyd/quickque';
  const issueTracker = `${repository.replace(/\/+$/, '')}/issues`;
  const contributingGuide = `${repository.replace(/\/+$/, '')}/blob/${config?.branch || 'main'}/CONTRIBUTING.md`;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-16">
      <Meta
        title="Support"
        description="Get help with Quickque and report actionable bugs through the Quickque GitHub issue tracker."
        context={context}
      />
      <div className="mb-12 border-b border-[var(--border)] pb-8">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--text-muted)] mb-4">Support</p>
        <h1 className="text-4xl font-semibold mb-4">Get help with Quickque</h1>
        <p className="text-xl text-[var(--text-muted)]">
          Quickque is maintained in the open. Use the issue tracker for bugs, questions, and reproducible problems.
        </p>
      </div>

      <section className="mb-10 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="flex items-start gap-4">
          <Github className="mt-1 shrink-0 text-[var(--accent)]" size={24} aria-hidden="true" />
          <div>
            <h2 className="text-2xl font-semibold mb-3">Ask a question or report a bug</h2>
            <p className="leading-relaxed text-[var(--text-muted)]">
              Open the Quickque GitHub issue tracker and search existing issues before starting a new one. The same route is used for questions and bug reports, so other contributors can find the answer later.
            </p>
            <a
              href={issueTracker}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--foreground)] px-4 py-3 font-medium text-[var(--background)] hover:opacity-90"
            >
              Open Quickque issues <ExternalLink size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section className="mb-10 space-y-5">
        <h2 className="text-2xl font-semibold">What to include</h2>
        <p className="leading-relaxed text-[var(--text-muted)]">
          A useful report explains what you expected, what happened, and the smallest set of steps that reproduces it. Include:
        </p>
        <ul className="list-disc space-y-3 pl-6 leading-relaxed text-[var(--text-muted)]">
          <li>the Quickque route or feature involved, plus the app or source-build version you used;</li>
          <li>your Mac model, Apple Silicon architecture, macOS version, and whether you were using the browser preview or native app;</li>
          <li>numbered reproduction steps, the expected result, and the actual result;</li>
          <li>relevant error text or a redacted console log, with commands and checks you already tried.</li>
        </ul>
        <p className="leading-relaxed text-[var(--text-muted)]">
          Keep reports focused and do not attach private scripts, meeting content, audio, transcripts, pairing URLs, controller tokens, credentials, or other personal data. Use synthetic text when a report needs an example.
        </p>
      </section>

      <section className="mb-10 rounded-2xl border border-[var(--border)] p-6">
        <div className="flex items-start gap-4">
          <ShieldAlert className="mt-1 shrink-0 text-[var(--accent)]" size={24} aria-hidden="true" />
          <div>
            <h2 className="text-2xl font-semibold mb-3">Security and private reports</h2>
            <p className="leading-relaxed text-[var(--text-muted)]">
              Do not publish credentials, private script content, or exploitable details in a public issue. If a report needs information that should not be public, explain that in the issue without posting the sensitive material and follow the repository’s current security guidance.
            </p>
          </div>
        </div>
      </section>

      <p className="text-sm leading-relaxed text-[var(--text-muted)]">
        For contribution and testing context, read the{' '}
        <a href={contributingGuide} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline underline-offset-4">
          contribution guide <ExternalLink size={13} className="inline" aria-hidden="true" />
        </a>
        .
      </p>
    </div>
  );
}
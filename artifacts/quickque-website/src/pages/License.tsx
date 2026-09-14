import React from 'react';
import { useLicense, useSiteConfig } from '../hooks/useData';
import { Meta } from '../components/Meta';

export function LicensePage({ context }: { context?: any }) {
  const { license, loading, error } = useLicense();
  const { config } = useSiteConfig();

  if (loading) return <div className="p-8 text-center text-[var(--text-muted)]">Loading license...</div>;
  if (error || !license) return <div className="p-8 text-center text-red-600">Failed to load license.</div>;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-16">
      <Meta title="License" description="Quickque Free, Monthly and Lifetime terms, and the MIT source licence" context={context} />
      <div className="mb-12 border-b border-[var(--border)] pb-8">
        <h1 className="text-4xl font-semibold mb-4">Licence information</h1>
        <p className="text-xl text-[var(--text-muted)]">Free to use. Optional unlimited Voice Follow and saved AI audio. MIT-licensed source.</p>
      </div>

      <section className="mb-10 space-y-5 leading-relaxed">
        <h2 className="text-2xl font-semibold">Planned Quickque app access</h2>
        <p>Quickque’s Free plan is for personal and commercial use. It includes the script workspace, editing, manual and timed playback, Scene Partner with system voices, voice model setup, recording voice samples, audio generation, and 30-second trials of Voice Follow and AI voice playback. Pausing and resuming does not restart the allowance.</p>
        <p><strong>Monthly:</strong> {config?.commerce?.monthlyDisplayPrice || 'Coming soon'} for each 30-day period for unlimited Voice Follow and the other included Pro features while the subscription is active. Renewal can be cancelled at any time. Access continues through the current paid period, then returns to Free. Cancellation does not delete or lock your scripts.</p>
        <p><strong>Lifetime:</strong> {config?.commerce?.displayPrice} once for permanent access to the included Pro features in Quickque for Mac on up to two devices, with no recurring charge. It includes future Quickque updates when they are released, but does not guarantee that updates, support or compatibility with future operating systems will continue. New paid features may require a separate licence or paid upgrade.</p>
        <p>Both paid plans include cached Chatterbox AI Partner dialogue, optional presentation narration, local listening and audio-only MP4 export. Presentation narration uses the default AI voice and requires an explicit Generate audio action. Your exported files remain yours to keep after a subscription ends; generation remains free; unlimited AI playback and export require Pro access in an eligible version. JSON script backups do not contain generated audio.</p>
        <p>A paid entitlement is for one person on no more than two devices. Monthly access returns to Free after the paid period ends; lifetime access persists on up to two activated devices. You retain ownership of your scripts and other content. No separate commercial-use subscription is required.</p>
        <p><strong>Refunds and cancellation:</strong> Quickque does not voluntarily offer refunds. Monthly renewal may be cancelled at any time, with access continuing until the end of the current 30-day paid period and no prorated refund. This policy does not limit rights that cannot legally be waived.</p>
        <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"><strong>Not live yet:</strong> these are the planned product terms. Checkout and purchase activation aren’t connected yet. Payments are disabled and no verified prebuilt Mac release is currently available. The dummy checkout creates no purchase, subscription, licence, entitlement or download.</p>
        <h2 className="pt-3 text-2xl font-semibold">The source licence is separate</h2>
        <p>Quickque-owned source code and documentation remain under MIT. You can use them for personal or commercial work, modify them, build your own version and redistribute them, subject to the copyright and permission notice below. Buying a paid feature entitlement is optional and does not replace, revoke or restrict these source rights. The official app’s planned Free allowance does not impose a new restriction on MIT-licensed source.</p>
        <p>This summary does not replace the MIT licence below. Third-party code and models retain their own terms.</p>
      </section>
      <div className="bg-[var(--surface)] p-8 rounded-lg border border-[var(--border)] overflow-x-auto">
        <pre className="text-sm text-[var(--foreground)] whitespace-pre-wrap font-mono leading-relaxed">
          {license}
        </pre>
      </div>
      
      <div className="mt-12 text-sm text-[var(--text-muted)]">
        <p className="mb-4">
          The website uses locally served{' '}
          <a href={`${config?.basePath}fonts/OFL-DMSerifDisplay.txt`} className="text-[var(--accent)] underline">DM Serif Display</a>{' '}
          and <a href={`${config?.basePath}fonts/OFL-Inter.txt`} className="text-[var(--accent)] underline">Inter</a>.
          These fonts, and the bundled{' '}
          <a href={`${config?.basePath}fonts/OFL-Manrope.txt`} className="text-[var(--accent)] underline">Manrope</a>{' '}
          font, retain their own SIL Open Font License 1.1 notices.
        </p>
        <p className="mb-4">Every Chatterbox runtime, model and related asset remains subject to its applicable Chatterbox, Resemble AI and third-party licence terms. Quickque’s paid feature entitlement does not replace or expand those rights. Apple speech features use macOS system frameworks and available system assets.</p>
        <p>See the <a href="https://github.com/rossboyd/quickque/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">third-party notices</a> and the <a href="https://github.com/rossboyd/quickque/tree/main/artifacts/quickque/turbo" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Chatterbox runtime licences</a> for component-specific information.</p>
      </div>
    </div>
  );
}

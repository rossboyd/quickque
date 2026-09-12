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
      <Meta title="License" description="Quickque open source license" context={context} />
      <div className="mb-12 border-b border-[var(--border)] pb-8">
        <h1 className="text-4xl font-semibold mb-4">License</h1>
        <p className="text-xl text-[var(--text-muted)]">Quickque is distributed under the MIT License.</p>
      </div>

      <p className="mb-8 leading-relaxed">
        You can use Quickque-owned code and documentation for personal or commercial work,
        modify it, and redistribute it. Keep the copyright and permission notice with
        copies or substantial portions. There is no warranty. This summary does not
        replace the license below.
      </p>
      <p className="mb-8 leading-relaxed">
        The source remains MIT-licensed and available to build yourself. A proposed optional
        packaged Mac distribution is {config?.commerce?.displayPrice} as a one-time purchase; a purchased version is
        intended to remain usable forever, while future major upgrades may cost extra. Live
        purchases are gated because there is no verified release or native Mac validation yet,
        and a sandbox checkout creates no license or download. If enabled, checkout sends
        billing and payment data to <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">Stripe</a>,
        not Quickque scripts or audio; see the <a href="https://github.com/rossboyd/quickque/blob/main/artifacts/quickque-website/docs/COMMERCE.md" target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">commerce runbook</a>.
      </p>
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
        <p className="mb-4">
          Third-party components and models are distributed under their respective licenses.
          FluidAudio is Apache-2.0 licensed. Silero VAD is MIT licensed. Please see the complete{' '}
          <a href="https://github.com/rossboyd/quickque/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
            THIRD_PARTY_NOTICES.md
          </a>{' '}
          and the native{' '}
          <a href="https://github.com/rossboyd/quickque/blob/main/artifacts/quickque/native/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
            THIRD_PARTY_NOTICES.txt
          </a>{' '}
          for exact revisions and license links.
        </p>
        <p>
          <strong>Note:</strong> The optional Parakeet speech recognition weights downloaded by Flow are separately licensed under the 
          <a href="https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline ml-1">
            NVIDIA Open Model License
          </a>, not MIT or Apache-2.0.
        </p>
      </div>
    </div>
  );
}
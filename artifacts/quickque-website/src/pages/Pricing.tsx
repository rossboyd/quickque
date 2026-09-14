import React, { useState } from 'react';
import { Link } from 'wouter';
import { Meta } from '../components/Meta';
import { useSiteConfig } from '../hooks/useData';
import { Check } from 'lucide-react';

export function PricingPage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  const commerce = config?.commerce;
  const [checkingOut, setCheckingOut] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const monthly = commerce?.monthlyDisplayPrice || 'Coming soon';
  const lifetime = commerce?.displayPrice;
  const handleCheckout = () => {
    if (!termsAccepted || checkingOut || typeof window === 'undefined') return;
    setCheckingOut(true);
    const base = (config?.basePath || '/').replace(/\/?$/, '/');
    window.location.assign(`${base}checkout/result?demo=complete`);
  };
  const plans = [
    { name: 'Free', price: '£0', billing: 'No subscription', description: 'Write, present and rehearse.', features: ['Create, import and edit scripts', 'Manual and timed playback', 'Download voice models and record your own voices', 'Generate and save AI rehearsal audio', 'Try Voice Follow and AI playback for 30 seconds'], paid: false },
    { name: 'Monthly', price: monthly, billing: 'per 30-day period', description: 'Keep the included Pro features running.', features: ['Everything in Free', 'Unlimited Voice Follow while subscribed', 'Unlimited saved AI voice playback', 'Export generated audio as an MP4 file', 'Cancel renewal anytime', 'Access continues to the end of the paid period'], paid: true },
    { name: 'Lifetime', price: lifetime || 'Coming soon', billing: 'one payment', description: 'Pay once for permanent access on up to two devices.', features: ['Everything in Free', 'Unlimited Voice Follow', 'Unlimited AI playback', 'Export generated audio as an MP4 file', 'Future Quickque updates when released', 'No recurring subscription'], paid: true },
  ];
  return <div className="min-h-screen bg-[var(--background)] pb-24">
    <Meta title="Pricing" description={`Write, present and try Quickque’s voice features for free. Pro is planned at ${monthly}/month or a one-time lifetime licence. Paid plans are not live yet.`} context={context} />
    <section className="mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
      <p className="mb-4 text-sm font-medium uppercase tracking-widest text-[var(--accent)]">Simple pricing</p>
      <h1 className="font-serif text-5xl sm:text-6xl tracking-tight">Start free.<br />Upgrade when it’s useful.</h1>
      <p className="mt-6 text-lg leading-relaxed text-[var(--text-muted)]">Make yourself at home first. Import a script, set up your voices and try them out. Pro removes the Voice Follow and AI playback timers and lets you export generated audio.</p>
    </section>
    <section aria-label="Quickque plans" className="mx-auto grid max-w-6xl gap-5 px-6 md:grid-cols-3">
      {plans.map(plan => <article key={plan.name} className={`flex flex-col rounded-2xl border bg-[var(--surface)] p-7 ${plan.name === 'Monthly' ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{plan.description}</p>
        <p className="mt-8 font-serif text-5xl">{plan.price}</p><p className="mt-2 text-sm text-[var(--text-muted)]">{plan.billing}</p>
        <ul className="my-8 space-y-4 text-sm leading-relaxed">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2"><Check size={17} className="mt-0.5 shrink-0 text-[var(--accent)]" /><span>{feature}</span></li>)}</ul>
        {plan.paid ? <button disabled className="mt-auto rounded-lg bg-[var(--brand-coral)] px-4 py-3 text-sm font-medium text-black opacity-60">{plan.name} coming soon</button> : <Link href="/install" className="mt-auto rounded-lg border border-[var(--border)] px-4 py-3 text-center text-sm font-medium hover:bg-[var(--surface)]">Get started free</Link>}
      </article>)}
    </section>
    <div className="mx-auto mt-7 max-w-6xl px-6 text-sm leading-relaxed text-[var(--text-muted)]">
      <p><strong>Paid plans are coming soon.</strong> Prices are in GBP. Checkout and purchase activation aren’t connected yet. A free, unsigned Apple Silicon test DMG is available for Macs running macOS 26 or newer.</p>
    </div>
    <section id="licence" className="mx-auto max-w-3xl space-y-8 px-6 pt-16">
      <div><h2 className="text-2xl font-semibold">What stays free?</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Writing, importing, editing, manual reading and timed scrolling stay free. You can also download the voice models, record voice samples and generate rehearsal audio. Try Voice Follow and AI voice playback with a 30-second allowance. When the timer ends, choose a plan or continue with Free. Your scripts, voices and saved audio stay put.</p></div>
      <div><h2 className="text-2xl font-semibold">Monthly or lifetime</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Monthly access costs {monthly} for each 30-day period and renews until you cancel. Cancel renewal anytime; paid access continues to the end of the current period, then Quickque returns to Free without deleting your scripts.</p><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Lifetime is one payment for permanent access to the included Pro features on up to two devices. It includes future Quickque updates when we release them, but it is not a promise that updates, support or compatibility will continue forever. New paid features may require a separate licence or paid upgrade.</p><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Quickque does not voluntarily offer refunds. Cancellation does not create a prorated refund; rights that cannot legally be waived still apply. Read the <Link href="/license" className="text-[var(--accent)] underline">licence information</Link> for the distinction between a paid feature entitlement and the MIT source licence.</p></div>
      <div><h2 className="text-2xl font-semibold">Try the voices before you choose</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Download the local voice model and hear a test line. Use the default voice or record your own sample. Then assign voices to a scene or generate narration for a presentation. Setup and generation are free; Pro gives you unlimited playback and audio export. Chatterbox runtimes and models remain subject to their own Chatterbox and third-party licence terms. Generated audio stays on your Mac and is separate from script backups. Voice features are still being tested on Mac.</p></div>
      <details className="rounded-xl border border-[var(--border)] p-5"><summary className="cursor-pointer font-medium">Preview the dummy checkout</summary><p className="mt-4 text-sm text-[var(--text-muted)]">This demo is not a purchase or subscription. It collects no payment details and creates no licence, entitlement or download.</p><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1" /><span>I understand this is a temporary dummy checkout. It charges no money and provides no licence or download.</span></label><button onClick={handleCheckout} disabled={!termsAccepted || checkingOut} className="mt-4 rounded-lg bg-[var(--brand-coral)] px-5 py-3 text-sm font-medium text-black disabled:opacity-50">{checkingOut ? 'Completing demo…' : 'Complete dummy checkout'}</button></details>
    </section>
  </div>;
}

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
  const monthly = commerce?.monthlyDisplayPrice || '£2.50';
  const lifetime = commerce?.displayPrice;
  const handleCheckout = () => {
    if (!termsAccepted || checkingOut || typeof window === 'undefined') return;
    setCheckingOut(true);
    const base = (config?.basePath || '/').replace(/\/?$/, '/');
    window.location.assign(`${base}checkout/result?demo=complete`);
  };
  const plans = [
    { name: 'Free', price: '£0', billing: 'No subscription', description: 'Write, present and rehearse.', features: ['Create, import and edit scripts', 'Manual and timed playback', 'Download voice models and record your own voices', 'Generate and save AI rehearsal audio', 'Try Voice Follow and AI playback for 30 seconds'], paid: false },
    { name: 'Monthly', price: monthly, billing: 'per month', description: 'Keep the voice features running.', features: ['Everything in Free', 'Unlimited Voice Follow while subscribed', 'Unlimited saved AI voice playback', 'Export generated audio as an MP4 file', 'Cancel renewal anytime', 'Keep your scripts if you cancel'], paid: true },
    { name: 'Lifetime', price: lifetime || 'Coming soon', billing: 'one payment', description: 'Pay once. Keep the versions you buy.', features: ['Everything in Free', 'Unlimited Voice Follow in eligible versions', 'Unlimited AI playback in eligible versions', 'Export generated audio as an MP4 file', 'One year of updates; keep eligible versions forever', 'No recurring subscription'], paid: true },
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
      <div><h2 className="text-2xl font-semibold">Monthly or lifetime: the same paid features</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Monthly access costs {monthly} per month and renews until you cancel. Cancel renewal anytime; unlimited Voice Follow continues to the end of your paid period, then the Free allowance applies. Your scripts remain available.</p><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Lifetime is one payment for Pro, including one year of updates. After that year, keep using any version released during your update period for as long as it runs on your Mac. Newer versions require renewed update coverage. You don’t have to renew to keep using an eligible version.</p><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Paid access is for one person on their own Macs. Read the <Link href="/license" className="text-[var(--accent)] underline">licence information</Link> for the distinction between a paid feature entitlement and the MIT source licence.</p></div>
      <div><h2 className="text-2xl font-semibold">Try the voices before you choose</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Download the local voice model and hear a test line. Use the default voice or record your own sample. Then assign voices to a scene or generate narration for a presentation. Setup and generation are free; Pro gives you unlimited playback and audio export. Generated audio stays on your Mac and is separate from script backups. Voice features are still being tested on Mac.</p></div>
      <details className="rounded-xl border border-[var(--border)] p-5"><summary className="cursor-pointer font-medium">Preview the dummy checkout</summary><p className="mt-4 text-sm text-[var(--text-muted)]">This demo is not a purchase or subscription. It collects no payment details and creates no licence, entitlement or download.</p><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1" /><span>I understand this is a temporary dummy checkout. It charges no money and provides no licence or download.</span></label><button onClick={handleCheckout} disabled={!termsAccepted || checkingOut} className="mt-4 rounded-lg bg-[var(--brand-coral)] px-5 py-3 text-sm font-medium text-black disabled:opacity-50">{checkingOut ? 'Completing demo…' : 'Complete dummy checkout'}</button></details>
    </section>
  </div>;
}

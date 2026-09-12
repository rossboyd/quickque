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
    { name: 'Free', price: '£0', billing: 'No subscription', description: 'Your everyday script workspace.', features: ['Create, import and edit scripts', 'Manual and timed playback', 'Scene Partner with system voices and character colours', 'Voice Follow: 30 seconds per session'], paid: false },
    { name: 'Monthly', price: monthly, billing: 'per month', description: 'Follow your voice without the timer.', features: ['Everything in Free', 'Unlimited Voice Follow while subscribed', 'Saved Chatterbox rehearsal audio', 'Optional script narration and MP4 export', 'Cancel renewal anytime', 'Keep your scripts if you cancel'], paid: true },
    { name: 'Lifetime', price: lifetime || 'Coming soon', billing: 'one payment', description: 'Unlock Voice Follow once. Keep it.', features: ['Everything in Free', 'Permanent unlimited Voice Follow', 'Saved Chatterbox rehearsal audio', 'Optional script narration and MP4 export', 'Future updates to these Quickque features', 'No recurring subscription'], paid: true },
  ];
  return <div className="min-h-screen bg-[var(--background)] pb-24">
    <Meta title="Pricing" description={`Quickque is free to use, with 30 seconds of Voice Follow per session. Planned unlimited Voice Follow: ${monthly}/month or a one-time lifetime licence. Paid plans are not live yet.`} context={context} />
    <section className="mx-auto max-w-3xl px-6 pt-20 pb-12 text-center">
      <p className="mb-4 text-sm font-medium uppercase tracking-widest text-[var(--accent)]">Simple pricing</p>
      <h1 className="font-serif text-5xl sm:text-6xl tracking-tight">Start free.<br />Follow your voice for longer.</h1>
      <p className="mt-6 text-lg leading-relaxed text-[var(--text-muted)]">Write, organise, present and rehearse for free. Choose monthly or lifetime access when you want unlimited Voice Follow and saved AI rehearsal audio.</p>
    </section>
    <section aria-label="Quickque plans" className="mx-auto grid max-w-6xl gap-5 px-6 md:grid-cols-3">
      {plans.map(plan => <article key={plan.name} className={`flex flex-col rounded-2xl border bg-white p-7 ${plan.name === 'Monthly' ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>
        <h2 className="text-xl font-semibold">{plan.name}</h2>
        <p className="mt-2 text-sm text-[var(--text-muted)]">{plan.description}</p>
        <p className="mt-8 font-serif text-5xl">{plan.price}</p><p className="mt-2 text-sm text-[var(--text-muted)]">{plan.billing}</p>
        <ul className="my-8 space-y-4 text-sm leading-relaxed">{plan.features.map(feature => <li key={feature} className="flex items-start gap-2"><Check size={17} className="mt-0.5 shrink-0 text-[var(--accent)]" /><span>{feature}</span></li>)}</ul>
        {plan.paid ? <button disabled className="mt-auto rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white opacity-60">{plan.name} coming soon</button> : <Link href="/install" className="mt-auto rounded-lg border border-[var(--border)] px-4 py-3 text-center text-sm font-medium hover:bg-[var(--surface)]">Get started free</Link>}
      </article>)}
    </section>
    <div className="mx-auto mt-7 max-w-6xl px-6 text-sm leading-relaxed text-[var(--text-muted)]">
      <p><strong>Planned plans, not live billing.</strong> Prices are in GBP. Subscriptions and lifetime activation are not implemented in the current app. Test builds use a Licensed / Unlicensed switch in Settings → Debug, with no purchase verification. The native 30-second session limit is implemented and awaiting Mac verification. Payments are disabled, and a verified prebuilt Mac release is not yet available. You can build the MIT-licensed source today.</p>
    </div>
    <section id="licence" className="mx-auto max-w-3xl space-y-8 px-6 pt-16">
      <div><h2 className="text-2xl font-semibold">What stays free?</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Your workspace, scripts, editing, manual and timed playback, and Scene Partner with system voices stay free for personal and commercial use. The planned Free tier includes 30 seconds of active Voice Follow per presentation or rehearsal session. Pausing and resuming does not reset that allowance. When it runs out, you can continue with manual or timed playback.</p></div>
      <div><h2 className="text-2xl font-semibold">Monthly or lifetime: the same paid features</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Monthly access costs {monthly} per month and renews until you cancel. Cancel renewal anytime; unlimited Voice Follow continues to the end of your paid period, then the Free allowance applies. Your scripts remain available.</p><p className="mt-3 leading-relaxed text-[var(--text-muted)]">A lifetime licence is one payment for permanent unlimited Voice Follow in Quickque for Mac, and saved AI audio features, including future updates to those features. There are no renewal payments. Separate future products or services are not included, and lifetime does not promise support for every future Mac or macOS version.</p><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Paid access is for one person on their own Macs. Read the <Link href="/license" className="text-[var(--accent)] underline">licence information</Link> for the distinction between a paid feature entitlement and the MIT source licence.</p></div>
      <div><h2 className="text-2xl font-semibold">Learn by listening</h2><p className="mt-3 leading-relaxed text-[var(--text-muted)]">Both paid plans include Chatterbox audio prepared after performance edits, optional Generate audio for presentation scripts, saved local playback, and audio-only MP4 export. Only AI Partner lines are generated for performances. Presentation narration uses the default AI voice and is off until you choose to generate it. Generated audio stays on your Mac; JSON backups do not include audio. These features still require Mac validation and licence activation before release.</p></div>
      <details className="rounded-xl border border-[var(--border)] p-5"><summary className="cursor-pointer font-medium">Preview the dummy checkout</summary><p className="mt-4 text-sm text-[var(--text-muted)]">This demo is not a purchase or subscription. It collects no payment details and creates no licence, entitlement or download.</p><label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1" /><span>I understand this is a temporary dummy checkout. It charges no money and provides no licence or download.</span></label><button onClick={handleCheckout} disabled={!termsAccepted || checkingOut} className="mt-4 rounded-lg bg-[var(--accent)] px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{checkingOut ? 'Completing demo…' : 'Complete dummy checkout'}</button></details>
    </section>
  </div>;
}

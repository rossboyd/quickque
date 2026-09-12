import React, { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Meta } from '../components/Meta';
import { useSiteConfig } from '../hooks/useData';
import { Check, AlertCircle, Info, ShieldCheck } from 'lucide-react';

export function PricingPage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  const commerce = config?.commerce;

  const [status, setStatus] = useState<{ available: boolean; mode: string; message: string; csrfToken?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [error, setError] = useState('');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  
  const [isCancelled, setIsCancelled] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('checkout') === 'cancelled') {
        setIsCancelled(true);
      }
      
      setLoading(true);
      setError('');
      fetch(`${config?.basePath || '/'}api/commerce/status`)
        .then(res => {
          if (!res.ok) throw new Error('Checkout availability could not be checked.');
          return res.json();
        })
        .then(data => {
          setStatus(data);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLoading(false);
          setError('Failed to load checkout availability.');
        });
    }
  }, [config?.basePath, availabilityAttempt]);

  const handleCheckout = async () => {
    if (!termsAccepted || !status?.available || checkingOut) return;
    setCheckingOut(true);
    setError('');

    try {
      const res = await fetch(`${config?.basePath || '/'}api/commerce/status`);
      if (!res.ok) throw new Error('Checkout availability could not be checked.');
      const statusData = await res.json();
      setStatus(statusData);

      if (!statusData.available) {
        setError(statusData.message || 'Checkout is currently unavailable.');
        setCheckingOut(false);
        return;
      }

      const checkoutRes = await fetch(`${config?.basePath || '/'}api/commerce/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          termsAccepted: true, 
          csrfToken: statusData.csrfToken 
        })
      });
      
      const checkoutData = await checkoutRes.json();
      
      if (!checkoutRes.ok) {
        throw new Error(checkoutData.message || checkoutData.error || 'Could not open checkout. Please try again.');
      }

      if (checkoutData.url) {
        const destination = new URL(checkoutData.url);
        if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' || destination.username || destination.password) {
          throw new Error('Checkout returned an unexpected destination. Please try again.');
        }
        window.location.assign(destination.href);
      } else {
        throw new Error('No checkout URL received');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during checkout.');
      setCheckingOut(false);
    }
  };

  const isTestMode = status?.mode === 'test';
  const isUnavailable = !status?.available || status?.mode === 'unavailable';
  const displayPrice = commerce?.displayPrice || '';

  return (
    <div className="w-full min-h-screen bg-[#fafbfd] pb-32">
      <Meta 
        title="Pricing"
        description={`${displayPrice} once for the packaged Quickque Mac app. Use the purchased version forever; future major upgrades may cost extra. MIT source remains free.`}
        context={context} 
      />
      
      <section className="max-w-[1000px] mx-auto px-6 pt-24 pb-12 text-center">
        {isCancelled && (
          <div className="mb-12 inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 text-amber-800 border border-amber-200 text-sm font-medium shadow-sm">
            <Info size={18} />
            You returned from checkout. You can try again when you’re ready.
          </div>
        )}
      
        <h1 className="font-serif text-5xl sm:text-6xl tracking-tight text-[var(--foreground)] mb-6">
          Simple, transparent pricing.
        </h1>
        <p className="text-xl text-[var(--text-muted)] max-w-2xl mx-auto font-sans">
          One payment. Permanent use of the version you buy. No subscription.
        </p>
      </section>

      <section className="max-w-4xl mx-auto px-6 relative z-10">
        <div className="bg-white rounded-[2rem] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.08)] border border-[var(--border)] overflow-hidden flex flex-col md:flex-row relative">
          
          {/* Main Pricing Panel */}
          <div className="flex-[1.5] p-8 md:p-12 border-b md:border-b-0 md:border-r border-[var(--border)] relative overflow-hidden">
            <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gradient-to-bl from-[#e6ebfc] to-transparent rounded-full blur-[80px] opacity-40 -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

            <div className="relative z-10">
              <h2 className="text-2xl font-semibold mb-2">{commerce?.name || 'Quickque for Mac'}</h2>
              <p className="text-[var(--text-muted)] mb-8">The packaged Mac app. Prebuilt release not yet available.</p>
              
              <div className="mb-8 flex items-baseline gap-2">
                <span className="font-serif text-6xl tracking-tight text-[var(--foreground)]">{displayPrice}</span>
                <span className="text-lg text-[var(--text-muted)]">{commerce?.billing || 'one-time'}</span>
              </div>

              <div className="space-y-4 mb-10">
                <div className="flex items-start gap-3 text-[var(--text-muted)]">
                  <Check className="text-[var(--accent)] shrink-0 mt-0.5" size={20} />
                  <span><strong>{commerce?.licence}</strong></span>
                </div>
                <div className="flex items-start gap-3 text-[var(--text-muted)]">
                  <Check className="text-[var(--accent)] shrink-0 mt-0.5" size={20} />
                  <span>{commerce?.updates}</span>
                </div>
                <div className="flex items-start gap-3 text-[var(--text-muted)]">
                  <Check className="text-[var(--accent)] shrink-0 mt-0.5" size={20} />
                  <span>Your scripts stay on your device. No account needed to run Quickque.</span>
                </div>
              </div>

              {loading ? (
                <div className="w-full py-4 text-center text-sm text-[var(--text-muted)] border border-transparent rounded-2xl bg-gray-50">
                  Checking availability...
                </div>
              ) : (
                <div className="space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center justify-center mt-0.5">
                      <input 
                        type="checkbox" 
                        checked={termsAccepted} 
                        onChange={(e) => setTermsAccepted(e.target.checked)}
                        className="peer sr-only"
                        disabled={isUnavailable}
                      />
                      <div className="w-5 h-5 border-2 border-[var(--border)] rounded peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-[var(--accent)] peer-checked:bg-[var(--accent)] peer-checked:border-[var(--accent)] peer-disabled:opacity-50 transition-colors"></div>
                      <Check className="absolute text-white opacity-0 peer-checked:opacity-100 peer-disabled:opacity-50 pointer-events-none transition-opacity" size={14} strokeWidth={3} />
                    </div>
                    <span className={`text-sm text-[var(--text-muted)] ${isUnavailable ? 'opacity-50' : ''}`}>
                      I understand that this is a one-time purchase for permanent use of the purchased version, and future major upgrades may cost extra.
                    </span>
                  </label>

                  <button
                    onClick={handleCheckout}
                    disabled={!termsAccepted || checkingOut || isUnavailable}
                    className="w-full py-4 px-6 bg-[var(--accent)] text-white rounded-2xl font-medium hover:bg-[var(--accent-hover)] transition-all shadow-[0_8px_20px_-6px_rgba(51,74,179,0.4)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed text-lg relative overflow-hidden"
                  >
                    {checkingOut ? 'Opening checkout…' : isUnavailable ? 'Not available to buy yet' : isTestMode ? 'Open test checkout' : `Buy Quickque — ${commerce?.displayPrice}`}
                  </button>

                  {error && (
                    <div role="alert" className="p-3 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100 flex items-start gap-2 mt-4">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                  {isUnavailable && <button type="button" onClick={() => setAvailabilityAttempt(value => value + 1)} className="underline text-sm text-[var(--accent)]">Check availability again</button>}

                  {isTestMode && !isUnavailable && (
                    <div className="p-3 bg-blue-50 text-[var(--accent)] text-sm rounded-xl border border-blue-100 flex items-start gap-2 mt-4">
                      <ShieldCheck size={16} className="shrink-0 mt-0.5" />
                      <span><strong>Test checkout only.</strong> No real money will be charged, and no licence or download will be issued. Mac release verification remains outstanding.</span>
                    </div>
                  )}
                  
                  {isUnavailable && status?.message && (
                    <div className="p-3 bg-gray-50 text-[var(--text-muted)] text-sm rounded-xl border border-[var(--border)] flex items-start gap-2 mt-4">
                      <Info size={16} className="shrink-0 mt-0.5" />
                      <span>{status.message}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Secondary Source Panel */}
          <div className="flex-1 bg-[#fafbfd] p-8 md:p-12 flex flex-col justify-center">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-[var(--foreground)] border border-[var(--border)] shadow-sm mb-6">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            </div>
            <h3 className="text-xl font-semibold mb-3">Prefer to build it yourself?</h3>
            <p className="text-[var(--text-muted)] mb-6 text-sm leading-relaxed">
              Quickque's source code remains fully open and available under the {commerce?.sourceLicence || 'MIT'} license. You can always build the application for your Mac for free.
            </p>
            <Link href="/install" className="inline-flex items-center justify-center px-5 py-2.5 bg-white border border-[var(--border)] text-[var(--foreground)] text-sm font-medium rounded-xl hover:bg-[var(--surface-hover)] transition-colors shadow-sm self-start">
              View build instructions
            </Link>
          </div>

        </div>
      </section>
      <section id="licence" className="max-w-3xl mx-auto px-6 pt-16 prose">
        <h2>What “forever” means</h2>
        <p>You can keep using the version you purchase without a subscription or an expiry date. Future major upgrades may cost extra; purchasing does not promise every future version or compatibility with every future macOS release.</p>
        <p>The {displayPrice} purchase covers the packaged Mac app. Quickque-owned source code remains available under the <Link href="/license">MIT licence</Link>, with its existing permission to use, modify, and redistribute it. Payment does not remove or restrict those rights.</p>
        <p>Live sales are closed while the Mac release is verified. Development preview checkout uses Stripe test mode only. See <Link href="/privacy">payment privacy</Link> for what Stripe processes.</p>
      </section>
    </div>
  );
}

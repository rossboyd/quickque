import React, { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Meta } from '../components/Meta';
import { useSiteConfig } from '../hooks/useData';
import { CheckCircle2, XCircle, Loader2, Download, AlertCircle } from 'lucide-react';

export function CheckoutResultPage({ context }: { context?: any }) {
  const { config } = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState<any>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLoading(true);
      setError('');
      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('session_id');

      if (!sessionId) {
        setError('Open this page from your Stripe checkout to verify its result.');
        setLoading(false);
        return;
      }

      fetch(`${config?.basePath || '/'}api/commerce/session?session_id=${encodeURIComponent(sessionId)}`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to verify session');
          return res.json();
        })
        .then(data => {
          setSession(data);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setError('We could not verify this checkout in this browser. If you completed payment, check your Stripe receipt before trying another purchase.');
          setLoading(false);
        });
    }
  }, [config?.basePath, attempt]);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--text-muted)]">
          <Loader2 className="w-12 h-12 animate-spin mb-4 text-[var(--accent)]" />
          <h1 className="text-3xl">Checking your checkout</h1>
          <p className="text-lg mt-4">Only a payment confirmed by Stripe counts as complete.</p>
        </div>
      );
    }

    if (error || !session) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6 shadow-sm border border-red-100">
            <XCircle className="w-10 h-10" />
          </div>
          <h1 className="font-serif text-4xl mb-4 text-[var(--foreground)]">Checkout not verified</h1>
          <p className="text-[var(--text-muted)] max-w-md mx-auto mb-8 text-lg">{error}</p>
          <button onClick={() => setAttempt(value => value + 1)} className="underline text-[var(--accent)] mb-5">Check again</button>
          <Link href="/pricing" className="px-6 py-3 bg-white border border-[var(--border)] text-[var(--foreground)] rounded-xl font-medium hover:bg-[var(--surface-hover)] transition-colors shadow-sm">
            Return to pricing
          </Link>
        </div>
      );
    }

    if (session.status === 'paid') {
      const isTest = session.mode === 'test';
      
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-24 h-24 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-8 shadow-sm border border-green-100">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <h1 className="font-serif text-5xl mb-6 text-[var(--foreground)] tracking-tight">{isTest ? 'Test checkout complete' : 'Payment confirmed'}</h1>
          
          <div className="bg-white p-8 rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] border border-[var(--border)] w-full max-w-lg mb-8">
            <p className="text-[var(--text-muted)] text-lg mb-6">
              {isTest ? 'Stripe confirmed the test payment. This was not a real purchase.' : 'Stripe confirmed your one-time payment for Quickque.'}
            </p>
            
            {isTest ? (
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-[var(--accent)] text-sm flex items-start gap-3 text-left">
                <AlertCircle size={20} className="shrink-0 mt-0.5" />
                <div>
                  <strong>Test complete.</strong>
                  <p className="mt-1">This was a test purchase. No real money was charged, and no purchased download is available.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {session.downloadUrl ? (
                  <a href={session.downloadUrl} className="flex items-center justify-center gap-2 w-full py-4 px-6 bg-[var(--accent)] text-white rounded-2xl font-medium hover:bg-[var(--accent-hover)] transition-all shadow-[0_8px_20px_-6px_rgba(51,74,179,0.4)] text-lg">
                    <Download size={20} />
                    Download Quickque for Mac
                  </a>
                ) : (
                  <div className="p-4 bg-gray-50 border border-[var(--border)] rounded-2xl text-[var(--text-muted)] text-sm">
                    No verified download is available here. Check your purchase details before trying another payment.
                  </div>
                )}
                {session.version && (
                  <p className="text-xs text-[var(--text-muted)]">Version: {session.version}</p>
                )}
              </div>
            )}
          </div>
          
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors underline decoration-transparent hover:decoration-[var(--border)]">
            Return to homepage
          </Link>
        </div>
      );
    }

    if (session.status === 'pending') {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mb-6 shadow-sm border border-amber-100">
            <Loader2 className="w-10 h-10 animate-spin" />
          </div>
          <h1 className="font-serif text-4xl mb-4 text-[var(--foreground)]">Payment not complete</h1>
          <p className="text-[var(--text-muted)] max-w-md mx-auto mb-8 text-lg">
            Stripe has not confirmed a completed payment. Check again if you have just finished checkout. No download or licence has been issued.
          </p>
          <button onClick={() => setAttempt(value => value + 1)} className="underline text-[var(--accent)] mb-5">Check payment again</button>
          <Link href="/" className="px-6 py-3 bg-white border border-[var(--border)] text-[var(--foreground)] rounded-xl font-medium hover:bg-[var(--surface-hover)] transition-colors shadow-sm">
            Return to homepage
          </Link>
        </div>
      );
    }

    // Cancelled or invalid
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-20 h-20 bg-gray-50 text-[var(--text-muted)] rounded-full flex items-center justify-center mb-6 shadow-sm border border-[var(--border)]">
          <XCircle className="w-10 h-10" />
        </div>
        <h1 className="font-serif text-4xl mb-4 text-[var(--foreground)]">Checkout not verified</h1>
        <p className="text-[var(--text-muted)] max-w-md mx-auto mb-8 text-lg">
          This checkout is expired or could not be verified. If you completed payment, check your Stripe receipt before trying again.
        </p>
        <Link href="/pricing" className="px-6 py-3 bg-white border border-[var(--border)] text-[var(--foreground)] rounded-xl font-medium hover:bg-[var(--surface-hover)] transition-colors shadow-sm">
          Return to pricing
        </Link>
      </div>
    );
  };

  return (
    <div className="w-full min-h-[calc(100vh-200px)] bg-[#fafbfd] flex items-center justify-center">
      <Meta 
        title="Checkout status"
        description="Quickque checkout status."
        context={context} 
        noindex={true}
      />
      
      <div className="w-full max-w-3xl mx-auto px-6">
        {renderContent()}
      </div>
    </div>
  );
}

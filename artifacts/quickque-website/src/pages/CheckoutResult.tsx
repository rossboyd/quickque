import React from 'react';
import { Link } from 'wouter';
import { Meta } from '../components/Meta';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export function CheckoutResultPage({ context }: { context?: any }) {
  return (
    <div className="w-full min-h-[calc(100vh-200px)] bg-[var(--background)] flex items-center justify-center">
      <Meta title="Dummy checkout complete" description="Quickque dummy checkout confirmation. No payment was made." context={context} noindex={true} />
      <div className="w-full max-w-3xl mx-auto px-6">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-24 h-24 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-8 shadow-sm border border-green-100">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <h1 className="font-serif text-5xl mb-6 text-[var(--foreground)] tracking-tight">Dummy checkout complete</h1>
          
          <div className="bg-[var(--surface)] p-8 rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.05)] border border-[var(--border)] w-full max-w-lg mb-8">
            <p className="text-[var(--text-muted)] text-lg mb-6">
              You completed the temporary local demo. This was not a purchase and no payment provider was contacted.
            </p>
            
            <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl text-[var(--accent)] text-sm flex items-start gap-3 text-left">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <div>
                <strong>No payment was made.</strong>
                <p className="mt-1">No money was charged, no payment details were collected, and no licence or download was issued.</p>
              </div>
            </div>
          </div>
          
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors underline decoration-transparent hover:decoration-[var(--border)]">
            Return to homepage
          </Link>
        </div>
      </div>
    </div>
  );
}

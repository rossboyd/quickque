import React from 'react';
import { Link } from 'wouter';

export function NotFoundPage({ context }: { context?: any }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-4xl font-semibold mb-4">404</h1>
      <p className="text-[var(--text-muted)] mb-8">This page doesn't exist.</p>
      <Link href="/" className="px-4 py-2 bg-[var(--foreground)] text-[var(--background)] rounded-md font-medium hover:bg-[var(--foreground)]/90 transition-colors">
        Go home
      </Link>
    </div>
  );
}
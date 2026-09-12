import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu, X } from 'lucide-react';
import { useSiteConfig } from '../hooks/useData';

export function Layout({ children }: { children: React.ReactNode }) {
  const { config } = useSiteConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-[var(--background)]">
      {/* Skip to main content link for accessibility */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--foreground)] focus:text-[var(--background)] focus:rounded-md">
        Skip to main content
      </a>

      <header className="px-6 lg:px-12 h-24 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-xl z-40">
        <Link href="/" className="font-serif font-medium text-2xl flex items-center gap-3">
          <img src={`${config?.basePath}logo.png`} alt="" width="28" height="28" className="w-7 h-7 object-contain" />
          <span>Quickque</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8 text-base font-medium">
          <Link href="/pricing" className="hover:text-[var(--accent)] transition-colors">Pricing</Link>
          <Link href="/guide" className="hover:text-[var(--accent)] transition-colors">Manual</Link>
          <Link href="/install" className="hover:text-[var(--accent)] transition-colors">Source</Link>
          <a href={config?.repository} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)] transition-colors">GitHub</a>
        </nav>

        {/* Mobile Nav Toggle */}
        <button 
          className="md:hidden p-2 -mr-2 text-[var(--foreground)]" 
          onClick={() => setMenuOpen(!menuOpen)} 
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label="Toggle menu"
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Nav */}
      {menuOpen && (
        <nav id="mobile-menu" className="md:hidden border-b border-[var(--border)] bg-white px-6 py-6 flex flex-col gap-6 text-lg font-medium shadow-lg absolute top-24 left-0 w-full z-30">
          <Link href="/pricing" className="block py-2">Pricing</Link>
          <Link href="/guide" className="block py-2">Manual</Link>
          <Link href="/install" className="block py-2">Source build</Link>
          <a href={config?.repository} target="_blank" rel="noreferrer" className="block py-2">GitHub</a>
        </nav>
      )}

      <main id="main-content" className="flex-1 flex flex-col" tabIndex={-1}>
        {children}
      </main>

      <footer className="border-t border-[var(--border)] py-12 mt-16 text-center text-[var(--text-muted)] bg-white">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <img src={`${config?.basePath}logo.png`} alt="" width="20" height="20" className="w-5 h-5 object-contain grayscale opacity-50" />
            <p>© {new Date().getFullYear()} Quickque contributors.</p>
          </div>
          <div className="flex gap-6 font-medium">
            <Link href="/privacy" className="hover:text-[var(--foreground)]">Privacy</Link>
            <Link href="/license" className="hover:text-[var(--foreground)]">License</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
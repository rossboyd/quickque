import React, { useState, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import { useGuideIndex } from '../hooks/useData';
import { Search, X } from 'lucide-react';
import { Meta } from '../components/Meta';

export function GuideIndexPage({ context }: { context?: any }) {
  const { articles, loading, error } = useGuideIndex();
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  if (loading) return <div className="p-8 text-center text-[var(--text-muted)]">Loading manual...</div>;
  if (error) return <div className="p-8 text-center text-red-600">Failed to load the manual.</div>;

  const filtered = articles.filter(a => 
    a.title?.toLowerCase().includes(search.toLowerCase()) || 
    a.description?.toLowerCase().includes(search.toLowerCase()) ||
    a.category?.toLowerCase().includes(search.toLowerCase()) ||
    a.body?.toLowerCase().includes(search.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearch('');
      setSelectedIndex(-1);
      return;
    }

    if (e.key === 'Enter') {
      if (filtered.length > 0) {
        const ordered = Object.values(categories).flat();
        const target = ordered[selectedIndex] || ordered[0];
        setLocation(`/guide/${target.slug}`);
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    }
  };

  // Group by category, preserving the intentional inventory order from articles
  const categories: Record<string, any[]> = filtered.reduce((acc, a) => {
    const cat = a.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(a);
    return acc;
  }, {} as Record<string, any[]>);
  const orderedResults = Object.values(categories).flat();
  const activeResult = orderedResults[selectedIndex];

  let globalIndex = 0;

  return (
    <div className="max-w-3xl mx-auto w-full px-4 py-16">
      <Meta title="User Manual" description="Search and read the Quickque user manual." context={context} />
      <h1 className="text-4xl font-semibold mb-6">User Manual</h1>
      <p id="search-help" className="text-sm text-[var(--text-muted)] mb-4">Search titles and full articles. Use Up and Down to choose a result, Enter to open it, or Tab to browse the links. Escape clears the search.</p>
      <p id="search-selection" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {activeResult ? `Selected: ${activeResult.title}. Result ${selectedIndex + 1} of ${orderedResults.length}. Press Enter to open.` : `${orderedResults.length} articles found.`}
      </p>
      
      <div className="relative mb-12">
        <label htmlFor="search-manual" className="sr-only">Search the manual</label>
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-[var(--text-muted)]">
          <Search size={18} aria-hidden="true" />
        </div>
        <input 
          ref={inputRef}
          id="search-manual"
          type="search" 
          value={search}
          onChange={e => {
            setSearch(e.target.value);
            setSelectedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search the manual..." 
          className="w-full bg-[var(--surface)] border border-[var(--border)] rounded-md py-3 pl-10 pr-10 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition-all"
          aria-controls="search-results"
          aria-describedby="search-help search-selection"
        />
        {search && (
          <button 
            onClick={() => { setSearch(''); setSelectedIndex(-1); inputRef.current?.focus(); }}
            className="absolute inset-y-0 right-3 flex items-center text-[var(--text-muted)] hover:text-[var(--foreground)]"
            aria-label="Clear search"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <div id="search-results" aria-live="polite">
        {Object.keys(categories).length === 0 ? (
          <div className="text-center py-12 text-[var(--text-muted)]">
            <p>No articles found matching "{search}".</p>
            <p className="mt-3">Try a shorter term such as “backup”, “microphone”, or “phone”, or clear the search to browse every article.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            {Object.entries(categories).map(([cat, items]: [string, any[]]) => (
              <section key={cat}>
                <h2 className="text-xl font-semibold mb-6 border-b border-[var(--border)] pb-2">{cat}</h2>
                <div className="flex flex-col gap-6">
                  {items.map((a: any) => {
                    const resultIndex = globalIndex;
                    const isSelected = resultIndex === selectedIndex;
                    globalIndex++;
                    return (
                      <Link 
                        key={a.slug} 
                        id={`search-result-${resultIndex}`}
                        href={`/guide/${a.slug}`} 
                        className={`group block p-4 -mx-4 rounded-lg transition-colors ${
                          isSelected ? 'bg-[var(--surface-hover)]' : 'hover:bg-[var(--surface)]'
                        }`}
                      >
                        <h3 className="text-lg font-medium text-[var(--foreground)] group-hover:text-[var(--accent)] transition-colors mb-1 flex items-center gap-2">
                          {a.title}
                          {isSelected && <span className="text-xs font-normal text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded bg-[var(--background)]">↵</span>}
                        </h3>
                        <p className="text-[var(--text-muted)]">
                          {a.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
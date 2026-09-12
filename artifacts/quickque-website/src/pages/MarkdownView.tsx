import React, { useEffect, useMemo } from 'react';
import { marked, Token, Tokens } from 'marked';

export function MarkdownView({ content, basePath }: { content: string; basePath?: string }) {
  const html = useMemo(() => {
    const renderer = new marked.Renderer();
    
    const originalLink = renderer.link.bind(renderer);
    renderer.link = (token: Tokens.Link) => {
      let href = token.href;
      if (href.startsWith('/') && !href.startsWith(`${basePath?.replace(/\/$/, '')}/`)) {
        href = basePath ? `${basePath.replace(/\/$/, '')}${href}` : href;
      }
      return originalLink({ ...token, href });
    };

    const originalImage = renderer.image.bind(renderer);
    renderer.image = (token: Tokens.Image) => {
      let href = token.href;
      if (href.startsWith('/') && !href.startsWith(`${basePath?.replace(/\/$/, '')}/`)) {
        href = basePath ? `${basePath.replace(/\/$/, '')}${href}` : href;
      }
      return originalImage({ ...token, href });
    };

    renderer.heading = (token: Tokens.Heading) => {
      const text = token.text;
      const level = token.depth;
      const escapedText = text.replace(/[*`_]/g, '').toLowerCase().replace(/[^\w]+/g, '-');
      return `<h${level} id="${escapedText}" class="group/heading relative"><a href="#${escapedText}" class="absolute -left-6 top-1/2 -translate-y-1/2 w-6 text-center opacity-0 group-hover/heading:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-[var(--accent)] transition-opacity" aria-label="Link to this section">#</a>${renderer.parser.parseInline(token.tokens)}</h${level}>`;
    };

    renderer.code = (token: Tokens.Code) => {
      const text = token.text;
      const lang = token.lang;
      return `<div class="relative group code-block mb-6 mt-4">
        <pre tabindex="0" class="overflow-x-auto p-4 pt-12 bg-[var(--foreground)] text-[var(--background)] rounded-lg text-sm"><code class="${lang || ''}">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
        <button class="copy-btn absolute top-2 right-2 p-1.5 bg-[#403f3c] text-white border border-[#403f3c] rounded text-xs hover:bg-[#52504c] transition-colors flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" aria-label="Copy code">Copy</button>
        <span class="text-sm aria-live-region" aria-live="polite"></span>
      </div>`;
    };

    // The page shell owns the single H1; source files remain readable on GitHub.
    const body = (content || '').replace(/^# [^\n]+\n+/, '');
    return marked.parse(body, { renderer, gfm: true, breaks: false, async: false }) as string;
  }, [content, basePath]);

  useEffect(() => {
    const preElements = document.querySelectorAll('.code-block');
    
    preElements.forEach((block) => {
      if (block.hasAttribute('data-copy-attached')) return;
      block.setAttribute('data-copy-attached', 'true');
      
      const btn = block.querySelector('.copy-btn');
      const liveRegion = block.querySelector('.aria-live-region');
      const codeEl = block.querySelector('code');
      
      btn?.addEventListener('click', async () => {
        const codeText = codeEl?.innerText || '';
        try {
          await navigator.clipboard.writeText(codeText);
          if (btn) {
            btn.innerHTML = 'Copied';
            (btn as HTMLElement).style.color = '#4ade80';
          }
          if (liveRegion) liveRegion.textContent = 'Code copied to clipboard.';
          setTimeout(() => {
            if (btn) {
              btn.innerHTML = 'Copy';
              (btn as HTMLElement).style.color = '';
            }
          }, 2000);
        } catch (err) {
          if (btn) {
            btn.innerHTML = 'Failed';
            (btn as HTMLElement).style.color = '#f87171';
          }
          if (liveRegion) liveRegion.textContent = 'Copy failed. Text selected for manual copying.';
          const selection = window.getSelection();
          const range = document.createRange();
          if (codeEl) {
            range.selectNodeContents(codeEl);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
          setTimeout(() => {
            if (btn) {
              btn.innerHTML = 'Copy';
              (btn as HTMLElement).style.color = '';
            }
          }, 3000);
        }
      });
    });
  }, [html]);

  return (
    <div 
      className="prose prose-lg w-full max-w-none" 
      dangerouslySetInnerHTML={{ __html: html }} 
    />
  );
}
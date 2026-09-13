import React from 'react';
import { Copy, Check, Terminal } from 'lucide-react';

export function TerminalInstall({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false);
  const [feedback, setFeedback] = React.useState('');
  const codeRef = React.useRef<HTMLElement>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setFeedback('Commands copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setCopied(false);
      const range = document.createRange();
      if (codeRef.current) {
        range.selectNodeContents(codeRef.current);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      setFeedback('Copy was blocked. The commands are selected; use your device’s Copy action.');
    }
  };

  return (
    <div className="mt-8 max-w-2xl mx-auto w-full text-left relative group">
      <div className="bg-[#111111] text-white p-4 rounded-lg shadow-sm border border-[#303030] text-sm font-mono overflow-x-auto">
        <div className="flex items-center gap-2 mb-2 text-[#b0b0b0]">
          <Terminal size={14} />
          <span>Build from source (Mac Apple Silicon)</span>
        </div>
        <pre tabIndex={0} className="whitespace-pre-wrap break-all leading-relaxed pb-10"><code ref={codeRef}>{command}</code></pre>
      </div>
      <button 
        onClick={handleCopy}
        className="absolute top-3 right-3 p-1.5 bg-[#303030] text-white border border-[#303030] rounded text-xs hover:bg-[#444444] transition-colors flex items-center gap-1"
        aria-label="Copy command"
      >
        {copied ? <Check size={14} className="text-[#FF8A82]" /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <p role="status" className="text-sm mt-2 font-sans text-[var(--text-muted)]">{feedback}</p>
    </div>
  );
}


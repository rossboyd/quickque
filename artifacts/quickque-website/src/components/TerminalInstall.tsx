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
      <div className="bg-[#0f1524] text-white p-4 rounded-lg shadow-sm border border-[#232b3d] text-sm font-mono overflow-x-auto">
        <div className="flex items-center gap-2 mb-2 text-[#8b99b0]">
          <Terminal size={14} />
          <span>Build from source (Mac Apple Silicon)</span>
        </div>
        <pre tabIndex={0} className="whitespace-pre-wrap break-all leading-relaxed pb-10"><code ref={codeRef}>{command}</code></pre>
      </div>
      <button 
        onClick={handleCopy}
        className="absolute top-3 right-3 p-1.5 bg-[#232b3d] text-white border border-[#232b3d] rounded text-xs hover:bg-[#323d54] transition-colors flex items-center gap-1"
        aria-label="Copy command"
      >
        {copied ? <Check size={14} className="text-[#6495ed]" /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <p role="status" className="text-sm mt-2 font-sans text-[var(--text-muted)]">{feedback}</p>
    </div>
  );
}


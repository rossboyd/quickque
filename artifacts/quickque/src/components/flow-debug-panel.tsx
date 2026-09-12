import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  clearFlowDebug, formatFlowDebug, getFlowDebugSnapshot, subscribeFlowDebug,
} from '@/lib/flow/diagnostics';

export function FlowDebugPanel({ initiallyOpen = true, onClose }: { initiallyOpen?: boolean; onClose?: () => void }) {
  const entries = useSyncExternalStore(subscribeFlowDebug, getFlowDebugSnapshot, getFlowDebugSnapshot);
  const [open, setOpen] = useState(initiallyOpen);
  const [copyMessage, setCopyMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const output = useRef<HTMLDivElement>(null);
  const last = entries.at(-1);

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => {
    if (open && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [entries, open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        'Quickque Flow diagnostics (in memory; no speech content)\n' +
        entries.map(formatFlowDebug).join('\n'),
      );
      setCopyMessage('Copied');
    } catch {
      setCopyMessage('Copy unavailable — select the green text or take a screenshot.');
    }
  }

  return (
    <section aria-label="Voice Flow debugger" className="shrink-0 border border-green-500/50 rounded-lg bg-[#031108] text-[#77ff9b] font-mono text-[11px] leading-relaxed shadow-lg">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        {onClose ? <span className="font-semibold">FLOW DEBUG</span> : (
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="font-semibold hover:text-white">
            {open ? '−' : '+'} FLOW DEBUG
          </button>
        )}
        {open && (
          <div className="flex gap-3">
            <button type="button" onClick={() => void copy()} className="hover:text-white">Copy</button>
            <button type="button" onClick={() => { clearFlowDebug(); setCopyMessage(''); }} className="hover:text-white">Clear</button>
            {onClose && <button type="button" onClick={onClose} aria-label="Close Flow debug trace" className="hover:text-white">Close</button>}
          </div>
        )}
      </div>
      {open && (
        <>
          <p className="px-3 pb-1 text-green-300">
            Live checkpoints · memory only · no audio or transcripts
          </p>
          <div ref={output} tabIndex={0} aria-label="Debug checkpoint history" className="h-[min(20dvh,12rem)] overflow-auto overscroll-contain px-3 select-text whitespace-pre-wrap break-words">
            {entries.length ? entries.map(entry => (
              <div key={entry.id}>{formatFlowDebug(entry)}</div>
            )) : <div>No checkpoints yet. Open Voice Follow to trace setup.</div>}
          </div>
          <p className="px-3 py-2 border-t border-green-500/20">
            {copyMessage || (last
              ? `Last checkpoint: ${last.code} · ${Math.max(0, Math.floor((now - last.at) / 1000))}s ago`
              : 'Waiting for setup activity…')}
          </p>
        </>
      )}
    </section>
  );
}
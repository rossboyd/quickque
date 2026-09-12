import { useState } from 'react';
import { createPortal } from 'react-dom';
import { isDesktop } from '@/lib/desktop';
import { FlowDebugPanel } from './flow-debug-panel';

const preferenceKey = 'quickque-debug-visible';

export function FlowDebugOverlay() {
  const [visible, setVisible] = useState(() => {
    if (new URLSearchParams(window.location.search).get('flowDebug') === '1') return true;
    try {
      const saved = localStorage.getItem(preferenceKey);
      return saved === null ? isDesktop() : saved === 'true';
    } catch {
      return isDesktop();
    }
  });
  const [preferenceError, setPreferenceError] = useState(false);

  function toggle(next: boolean) {
    setVisible(next);
    try {
      localStorage.setItem(preferenceKey, String(next));
      setPreferenceError(false);
    } catch {
      setPreferenceError(true);
    }
  }

  return createPortal(
    <div
      className="fixed bottom-2 left-2 flex max-w-[calc(100vw-1rem)] flex-col items-start gap-2"
      style={{ zIndex: 2147483647, pointerEvents: 'auto' }}
      data-flow-debug-overlay
      onKeyDown={event => event.stopPropagation()}
    >
      {visible && (
        <div id="quickque-debug-trace" className="w-[min(32rem,calc(100vw-1rem))]">
          <FlowDebugPanel onClose={() => toggle(false)} />
        </div>
      )}
      <button
        type="button"
        aria-label={visible ? 'Hide Flow debug trace' : 'Show Flow debug trace'}
        aria-expanded={visible}
        aria-controls="quickque-debug-trace"
        onClick={() => toggle(!visible)}
        className="flex items-center gap-1.5 rounded-md border border-white/15 bg-[#101820]/90 px-2.5 py-1.5 font-mono text-[10px] text-slate-300 shadow-sm transition-colors hover:bg-[#182630] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-400"
      >
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${visible ? 'bg-green-400' : 'bg-slate-500'}`} />
        DEBUG {visible ? 'ON' : 'OFF'}
      </button>
      {preferenceError && <span className="rounded bg-black px-2 text-xs text-green-300">Toggle preference could not be saved.</span>}
    </div>,
    document.body,
  );
}
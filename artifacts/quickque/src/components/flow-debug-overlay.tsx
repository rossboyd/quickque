import { createPortal } from 'react-dom';
import { FlowDebugPanel } from '@/components/flow-debug-panel';
import { useFlowDebugVisibility } from '@/lib/flow-debug-visibility';

export function FlowDebugOverlay() {
  const visible = useFlowDebugVisibility();

  if (!visible) return null;

  return createPortal(
    <div
      className="fixed bottom-2 left-2 w-[min(32rem,calc(100vw-1rem))]"
      style={{ zIndex: 2147483647, pointerEvents: 'auto' }}
      data-flow-debug-overlay
      onKeyDown={event => event.stopPropagation()}
    >
      <FlowDebugPanel />
    </div>,
    document.body,
  );
}
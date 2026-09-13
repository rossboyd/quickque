import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
export const UPGRADE_EVENT = 'quickque:upgrade';
export function UpgradeDialog({ open, onContinueFree, reason = 'timer' }: { open: boolean; onContinueFree: () => void; reason?: 'timer' | 'export' }) {
  const [message, setMessage] = useState<string | null>(null);
  return <Dialog open={open} onOpenChange={next => { if (!next) onContinueFree(); }}>
    <DialogContent onKeyDown={event => event.stopPropagation()}>
      <DialogTitle>Keep going with Quickque Pro</DialogTitle>
      <DialogDescription>{reason === 'timer' ? 'Your 30 seconds of voice mode are complete for this session. Pro removes the timer.' : 'Exporting generated audio is included with Pro. You can still try voice playback in Quickque.'} Your scripts, voice samples and downloads are kept.</DialogDescription>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setMessage('Monthly checkout is not connected yet. You can continue with Free or activate an existing licence in Settings.')} className="rounded-xl border border-border p-4 text-left hover:bg-muted"><strong className="block">Monthly</strong><span className="block text-lg">£2.50 / month</span><span className="text-xs text-muted-foreground">Unlimited voice modes while subscribed.</span></button>
        <button type="button" onClick={() => setMessage('Lifetime checkout is not connected yet. You can continue with Free or activate an existing licence in Settings.')} className="rounded-xl border border-primary p-4 text-left hover:bg-muted"><strong className="block">Lifetime</strong><span className="block text-lg">£25 once</span><span className="text-xs text-muted-foreground">One year of updates. Keep eligible versions forever.</span></button>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <button type="button" className="rounded-md border border-border px-4 py-2 text-sm" onClick={onContinueFree}>Continue with Free</button>
      <p className="text-xs text-muted-foreground">Continue reading manually. No payment is taken in this build.</p>
    </DialogContent>
  </Dialog>;
}
export function AudioUpgradePrompt() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'timer' | 'export'>('timer');
  useEffect(() => { const show = (event: Event) => { setReason((event as CustomEvent).detail === 'export' ? 'export' : 'timer'); setOpen(true); }; window.addEventListener(UPGRADE_EVENT, show); return () => window.removeEventListener(UPGRADE_EVENT, show); }, []);
  return <UpgradeDialog open={open} reason={reason} onContinueFree={() => { setOpen(false); window.dispatchEvent(new Event('quickque:continue-free')); }} />;
}

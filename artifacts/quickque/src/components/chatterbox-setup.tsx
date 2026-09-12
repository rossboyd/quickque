import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '@/lib/desktop';

type Status = { status: string; downloadedBytes?: number; totalBytes?: number };
export function ChatterboxSetup({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const desktop = isDesktop();
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await invoke<Status>('turbo_status');
        if (active) setStatus(next);
      } catch (reason) {
        if (active) setError(String(reason).replace(/^SCENE_SPEECH_[A-Z_]+:\s*/, ''));
      } finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, [desktop]);
  const busy = installing || status?.status === 'downloading';
  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke('turbo_install');
      setStatus(await invoke<Status>('turbo_status'));
      onReady();
    } catch (reason) {
      setError(String(reason));
      setStatus(null);
    } finally { setInstalling(false); setCancelling(false); }
  };
  const cancel = async () => {
    setCancelling(true);
    try {
      await invoke('turbo_cancel_install');
      setStatus({ status: 'not-installed' });
    } catch (reason) { setError(String(reason)); }
    finally { setCancelling(false); }
  };
  const percent = status?.totalBytes ? Math.min(100, Math.floor((status.downloadedBytes ?? 0) / status.totalBytes * 100)) : 0;
  return <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-xs">
    <p className="font-medium">Chatterbox Turbo · Free local voice</p>
    <p>Default English voice by Resemble AI. One-time model download: 2.99 GB. Runs locally without an account. Allow at least 4 GB of free disk space.</p>
    <p>All characters using Chatterbox share this voice. It uses its natural speaking rate. Preparing each turn can take a while.</p>
    {!desktop ? <p>Open the Quickque Mac app to download and use Chatterbox.</p> : busy ? <>
      <p role="status">{cancelling ? 'Cancelling download…' : `Downloading Chatterbox… ${percent}%`}</p>
      <progress aria-label="Chatterbox download" value={percent} max={100} className="w-full" />
      <button type="button" onClick={() => void cancel()} disabled={cancelling} className="font-medium text-primary">Cancel download</button>
    </> : status?.status === 'ready' ? <p role="status">Chatterbox Default is installed. Preview it before rehearsing.</p> : <button type="button" onClick={() => void install()} className="font-medium text-primary">Download Chatterbox · 2.99 GB</button>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <p className="text-muted-foreground">Chatterbox and Perth © Resemble AI · MIT licence. AI audio includes Perth watermarking.</p>
  </div>;
}

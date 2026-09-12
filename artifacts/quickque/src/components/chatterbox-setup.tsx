import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '@/lib/desktop';

type Status = {
  status: 'not-installed' | 'downloading' | 'ready' | 'failed' | string;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
};

const STATUS_CHANGED_EVENT = 'quickque:chatterbox-status-changed';

function errorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const cleaned = message.replace(/^SCENE_SPEECH_[A-Z_]+:\s*/, '').trim();
  return cleaned || 'Chatterbox setup failed. Check that at least 4 GB is free, then try again.';
}

export function ChatterboxSetup({
  onReady,
  compact = false,
}: {
  onReady?: () => void;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const desktop = isDesktop();

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const next = await invoke<Status>('turbo_status');
      setStatus(next);
      setError(next.status === 'failed' ? next.error || 'The Chatterbox download failed. Check your connection and free disk space, then try again.' : null);
      if (next.status === 'ready') onReady?.();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [desktop, onReady]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await invoke<Status>('turbo_status');
        if (active) {
          setStatus(next);
          setError(next.status === 'failed' ? next.error || 'The Chatterbox download failed. Check your connection and free disk space, then try again.' : null);
        }
      } catch (reason) {
        if (active) setError(errorMessage(reason));
      } finally { pending = false; }
    };
    const handleSharedChange = () => void poll();
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    window.addEventListener(STATUS_CHANGED_EVENT, handleSharedChange);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(STATUS_CHANGED_EVENT, handleSharedChange);
    };
  }, [desktop]);

  const busy = installing || status?.status === 'downloading';
  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await invoke('turbo_install');
      await refresh();
      window.dispatchEvent(new Event(STATUS_CHANGED_EVENT));
    } catch (reason) {
      setError(errorMessage(reason));
      await refresh();
    } finally { setInstalling(false); setCancelling(false); }
  };
  const cancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      await invoke('turbo_cancel_install');
      setStatus({ status: 'not-installed' });
      window.dispatchEvent(new Event(STATUS_CHANGED_EVENT));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setCancelling(false); }
  };
  const percent = status?.totalBytes ? Math.min(100, Math.floor((status.downloadedBytes ?? 0) / status.totalBytes * 100)) : 0;
  return <div className={`rounded-md border border-border bg-muted/30 space-y-2 ${compact ? 'p-3 text-xs' : 'p-4 text-sm'}`}>
    <div className="flex items-center justify-between gap-3">
      <p className="font-medium">Chatterbox Turbo · Free local voice</p>
      {desktop && <span className="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {busy ? 'Downloading' : status?.status === 'ready' ? 'Ready' : error || status?.status === 'failed' ? 'Failed' : status ? 'Unavailable' : 'Checking…'}
      </span>}
    </div>
    <p>Default English voice by Resemble AI. One-time model download: 2.99 GB. Runs locally without an account. Allow at least 4 GB of free disk space.</p>
    <p>All characters using Chatterbox share this voice. It uses its natural speaking rate. Preparing each turn can take a while.</p>
    {!desktop ? <p role="status" className="font-medium">Installation is available in the Quickque Mac app. Open this setup there to download and use Chatterbox.</p> : busy ? <>
      <p role="status">{cancelling ? 'Cancelling download…' : `Downloading Chatterbox… ${percent}%`}</p>
      <progress aria-label="Chatterbox download" value={percent} max={100} className="w-full" />
      <button type="button" onClick={() => void cancel()} disabled={cancelling} className="font-medium text-primary disabled:opacity-50">Cancel download</button>
    </> : status?.status === 'ready' ? <p role="status" className="font-medium text-emerald-600 dark:text-emerald-400">Chatterbox Default is installed and ready for Scene Partner.</p> : <button type="button" onClick={() => void install()} className="font-medium text-primary">Download Chatterbox · 2.99 GB</button>}
    {error && <div role="alert" className="space-y-1 text-destructive">
      <p>{error}</p>
      {desktop && !busy && <p>Make sure your Mac has at least 4 GB free and an internet connection, then retry the download.</p>}
    </div>}
    <p className="text-muted-foreground">Chatterbox and Perth © Resemble AI · MIT licence. AI audio includes Perth watermarking.</p>
  </div>;
}

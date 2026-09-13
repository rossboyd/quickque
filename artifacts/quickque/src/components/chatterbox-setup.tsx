import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from '@/lib/desktop';

type Status = { status: string; downloadedBytes?: number; totalBytes?: number; error?: string; message?: string };
const STATUS_CHANGED_EVENT = 'quickque:chatterbox-status-changed';

export function ChatterboxSetup({ onReady, onInstalledChange, compact = false }: {
  onReady?: () => void; onInstalledChange?: (installed: boolean) => void; compact?: boolean;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const callbacks = useRef({ onReady, onInstalledChange });
  callbacks.current = { onReady, onInstalledChange };
  const refresh = useRef<() => Promise<void>>(async () => {});
  const desktop = isDesktop();
  const installed = status?.status === 'ready';
  useEffect(() => {
    callbacks.current.onInstalledChange?.(installed);
    if (installed) callbacks.current.onReady?.();
  }, [installed]);

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (pending || !active) return;
      clearTimeout(timer);
      pending = true;
      try {
        const next = await invoke<Status>('turbo_status');
        if (!active) return;
        setStatus(next);
        if (next.error || next.status === 'failed') setError(next.message || next.error || 'Download failed. Check your connection and available storage, then retry.');
        // Only an active download needs frequent polling; status checks launch a worker.
        timer = setTimeout(() => void poll(), next.status === 'downloading' ? 1500 : 30000);
      } catch (reason) { if (active) setError(String(reason)); }
      finally { pending = false; }
    };
    refresh.current = poll;
    const changed = () => { clearTimeout(timer); timer = setTimeout(() => void poll(), 100); };
    void poll();
    window.addEventListener(STATUS_CHANGED_EVENT, changed);
    return () => { active = false; clearTimeout(timer); window.removeEventListener(STATUS_CHANGED_EVENT, changed); };
  }, [desktop]);

  const busy = installing || status?.status === 'downloading';
  const install = async () => {
    setInstalling(true); setError(null);
    try {
      const downloading = invoke('turbo_install');
      setStatus({ status: 'downloading' });
      window.dispatchEvent(new Event(STATUS_CHANGED_EVENT));
      await downloading;
      await refresh.current();
    } catch (reason) { setError(String(reason)); setStatus({ status: 'failed' }); }
    finally { setInstalling(false); setCancelling(false); window.dispatchEvent(new Event(STATUS_CHANGED_EVENT)); }
  };
  const cancel = async () => {
    setCancelling(true);
    try { await invoke('turbo_cancel_install'); setStatus({ status: 'not-installed' }); }
    catch (reason) { setError(String(reason)); }
    finally { setCancelling(false); window.dispatchEvent(new Event(STATUS_CHANGED_EVENT)); }
  };
  const percent = status?.totalBytes ? Math.min(100, Math.floor((status.downloadedBytes ?? 0) / status.totalBytes * 100)) : null;
  return <div className={`space-y-3 ${compact ? 'text-xs' : 'text-sm'}`}>
    <div className="flex items-center justify-between gap-3">
      <p className="font-medium">Chatterbox Turbo · English</p>
      {desktop && <span role="status" className="rounded-full bg-muted px-2 py-1 text-xs">{busy ? 'Downloading' : installed ? 'Installed' : error ? 'Needs attention' : status ? 'Not installed' : 'Checking…'}</span>}
    </div>
    <p className="text-muted-foreground">One-time download: 2.99 GB. Keep at least 4 GB free and connect to the internet for setup. Speech generation then runs locally on an Apple Silicon Mac.</p>
    {!desktop ? <p role="status">Open Quickque on your Mac to download AI voices. You can write and read scripts in this browser without a download.</p> : busy ? <>
      <p role="status">{cancelling ? 'Stopping download…' : `Downloading model${percent === null ? '…' : ` · ${percent}%`}`}</p>
      <progress aria-label="Chatterbox download" value={percent ?? undefined} max={100} className="h-2 w-full accent-primary" />
      <p className="text-xs text-muted-foreground">You can leave this setup open or return later while Quickque stays running.</p>
      <button type="button" onClick={() => void cancel()} disabled={cancelling} className="text-primary disabled:opacity-50">Cancel download</button>
    </> : installed ? <p className="text-emerald-700 dark:text-emerald-400">Model files are installed. Test a voice below to check speech and audio output.</p> : <button type="button" onClick={() => void install()} disabled={!status && !error} className="rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-50">{error ? 'Retry download' : 'Download model · 2.99 GB'}</button>}
    {error && <div role="alert" className="space-y-2 text-destructive"><p>{error.replace(/^SCENE_SPEECH_[A-Z_]+:\s*/, '')}</p><button type="button" className="text-xs underline" onClick={() => { setError(null); void refresh.current(); }}>Check installation again</button></div>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Model and licence details</summary><p className="mt-2">Chatterbox and Perth © Resemble AI · MIT licence. Generated speech includes Perth watermarking. The default voice and custom voice references use the same model.</p></details>
  </div>;
}

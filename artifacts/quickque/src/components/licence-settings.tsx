import { useState } from 'react';
import { licenceOperation, useLicence } from '@/lib/licence';
export function LicenceSettings() {
  const { status } = useLicence();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (action: 'activate' | 'refresh' | 'deactivate') => {
    setBusy(true); setMessage(null);
    try { const next = await licenceOperation(action, key.trim()); setKey(''); setMessage(action === 'deactivate' ? 'This Mac has been deactivated.' : next.message); }
    catch (error) { setMessage(String(error)); } finally { setBusy(false); }
  };
  const date = (time: number) => new Date(time * 1000).toLocaleDateString();
  return <section className="space-y-3 rounded-xl border border-border p-4">
    <h3 className="font-semibold">Your licence</h3>
    <p role="status" className="text-sm text-muted-foreground">{status?.message ?? 'Checking saved licence…'}</p>
    {status?.offlineUntil && <p className="text-sm">Offline access until {date(status.offlineUntil)}.</p>}
    {status?.updatesUntil && <p className="text-sm">Updates included through {date(status.updatesUntil)}. Eligible versions remain yours to use.</p>}
    <label className="block space-y-1 text-sm"><span>Licence key</span><input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" spellCheck={false} placeholder="QQ-…" className="w-full rounded-md border border-border bg-background px-3 py-2" /></label>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => void run('activate')} disabled={busy || !status?.configured || !key.trim()} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50">{busy ? 'Working…' : 'Activate licence'}</button>
      {status?.canRefresh && <><button type="button" disabled={busy} onClick={() => void run('refresh')} className="rounded-md border border-border px-3 py-2 text-sm">Check licence online</button><button type="button" disabled={busy} onClick={() => void run('deactivate')} className="rounded-md border border-border px-3 py-2 text-sm">Deactivate this Mac</button></>}
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

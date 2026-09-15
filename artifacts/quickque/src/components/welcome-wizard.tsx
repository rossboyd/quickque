import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { useLocation } from 'wouter';
import { isDesktop } from '@/lib/desktop';
import { BrandMark } from './brand-mark';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';

const steps = ['Welcome', 'Script storage', 'Ready'];

export function WelcomeWizard() {
  const store = useStore();
  const { profile, updateProfile, libraryDirectory, chooseLibraryDirectory, scripts, createScript, setActiveScriptId } = store;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name || '');
  const [folderLoading, setFolderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const desktop = isDesktop();
  useEffect(() => { if (!profile.onboardingComplete) { setOpen(true); setStep(0); } }, [profile.onboardingComplete]);
  useEffect(() => {
    const reopen = () => { setOpen(true); setStep(0); setName(profile.name || ''); setError(null); };
    window.addEventListener('quickque:welcome', reopen);
    return () => window.removeEventListener('quickque:welcome', reopen);
  }, [profile.name]);
  const next = () => {
    if (step === 0 && (!name.trim() || !updateProfile({ name: name.trim() }))) { setError('Enter your name and try again.'); return; }
    if (step === 1 && desktop && !libraryDirectory) return;
    setError(null); setStep(current => Math.min(2, current + 1));
  };
  const finish = () => {
    if (!name.trim() || (desktop && !libraryDirectory)) { setStep(!name.trim() ? 0 : 1); return false; }
    if (!updateProfile({ name: name.trim(), onboardingComplete: true })) { setError('Setup could not be saved. Please try again.'); return false; }
    setOpen(false); return true;
  };
  const choose = async () => {
    setFolderLoading(true); setError(null);
    try { await chooseLibraryDirectory(); } catch (reason) { setError(String(reason)); }
    finally { setFolderLoading(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden flex flex-col" onKeyDown={event => event.stopPropagation()}>
      <div className="border-b border-border px-6 py-5 pr-12">
        <DialogTitle>Welcome setup guide</DialogTitle>
        <DialogDescription className="mt-1">Set up your workspace. Voice features are optional and can be added later.</DialogDescription>
        <ol aria-label="Setup progress" className="mt-4 grid grid-cols-4 gap-2">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} className={`border-t-2 pt-2 text-xs ${index === step ? 'border-primary font-semibold text-foreground' : index < step ? 'border-primary/50 text-muted-foreground' : 'border-border text-muted-foreground'}`}><span className="mr-1">{index + 1}.</span>{label}</li>)}
        </ol>
      </div>
      <div className="min-h-0 overflow-y-auto p-6 space-y-5" key={step}>
        {step === 0 && <>
          <BrandMark className="h-12 w-14" />
          <h2 className="text-2xl font-semibold">A little preparation. A smoother read.</h2>
          <p className="text-sm text-muted-foreground">Write a script, present at your own pace, or rehearse with a speaking partner. Start with the essentials—no model download is needed to read manually.</p>
          <div className="space-y-2"><label htmlFor="welcome-name-input" className="text-sm font-medium">What should we call you?</label><input id="welcome-name-input" value={name} maxLength={80} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim()) next(); }} placeholder="Your name" className="w-full rounded-lg border border-border bg-background px-3 py-3 focus:outline-none focus:ring-2 focus:ring-ring" /></div>
          <p className="text-xs text-muted-foreground">Your name stays in your local profile. No account is needed.</p>
        </>}
        {step === 1 && <>
          <h2 className="text-2xl font-semibold">Keep your scripts safe</h2>
          <p className="text-sm text-muted-foreground">{desktop ? 'Choose a folder for your script library. Quickque saves edits automatically and keeps a backup of the previous save.' : 'Scripts are saved in this browser. Export a backup before clearing browser data or moving to another device.'}</p>
          {desktop ? <div className="space-y-3 rounded-xl border border-border p-4"><p className="break-all text-sm">{libraryDirectory || 'Choose where Quickque saves your scripts.'}</p><button type="button" disabled={folderLoading} onClick={() => void choose()} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{folderLoading ? 'Opening folder picker…' : libraryDirectory ? 'Change folder' : 'Choose script folder'}</button>{libraryDirectory && <p role="status" className="text-xs text-muted-foreground">{store.localSaveStatus}</p>}</div> : <p className="rounded-xl bg-muted p-4 text-sm">Find backups in Settings → Storage & backups. The Mac app also lets you choose a local script folder.</p>}
          <div className="space-y-2 text-sm"><h3 className="font-medium">What is saved where?</h3><p className="text-muted-foreground">Scripts live in {desktop ? 'your chosen folder' : 'this browser'}. In the Mac app, voice samples and generated audio are saved separately in app storage. Script backups do not include audio.</p></div>
        </>}
        {step === 2 && <>
          <h2 className="text-2xl font-semibold">Your workspace is ready, {name.trim()}.</h2>
          <p className="text-sm text-muted-foreground">Start with a script. Any voice setup you skipped is available in Settings → Voices & audio.</p>
          <div className="rounded-xl border border-border p-4 text-sm space-y-2"><p>✓ Profile saved</p><p>✓ {desktop ? 'Script folder selected' : 'Browser storage ready'}</p><p className="text-muted-foreground">Optional audio setup can be checked at any time.</p></div>
          <button type="button" onClick={() => { if (finish()) { createScript(); setLocation('/'); } }} className="w-full rounded-md bg-primary px-4 py-3 font-medium text-primary-foreground">Create a script</button>
          {scripts.some(script => script.id === 'seed-1') && <button type="button" onClick={() => { if (finish()) { setActiveScriptId('seed-1'); setLocation('/read/seed-1'); } }} className="w-full rounded-md border border-border px-4 py-3 text-sm">Try the sample script</button>}
          <p className="text-xs text-muted-foreground">In the reader: Space starts or pauses, arrow keys change sections, and Esc returns to your library.</p>
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
        {step > 0 ? <button type="button" className="text-sm text-muted-foreground" onClick={() => { setStep(value => value - 1); setError(null); }}>Back</button> : <button type="button" className="text-sm text-muted-foreground" onClick={() => setOpen(false)}>Set up later</button>}
        {step < 2 ? <button type="button" disabled={(step === 0 && !name.trim()) || (step === 1 && desktop && (!libraryDirectory || folderLoading))} onClick={next} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Continue</button> : <button type="button" className="text-sm text-primary" onClick={() => { if (finish()) setLocation('/'); }}>Go to my library</button>}
      </div>
    </DialogContent>
  </Dialog>;
}

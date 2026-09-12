import { useEffect, useRef, useState } from 'react';
import type { Script } from '@/lib/types';
import { parseScriptMarkdown, scriptToMarkdown } from '@/lib/script-markdown';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';

export function MarkdownEditor({ script, onSave, onClose }: {
  script: Script;
  onSave: (updates: Partial<Script>) => boolean;
  onClose: () => void;
}) {
  const original = useRef(script);
  const ownSavePending = useRef(false);
  const [baseline, setBaseline] = useState(() => scriptToMarkdown(script));
  const [draft, setDraft] = useState(baseline);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const dirty = draft !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = () => dirty ? setDiscard(true) : onClose();
  const save = () => {
    if (script !== original.current) { setError('This script changed while Markdown was open. Copy your draft, reopen Markdown, then apply your edits to the latest version.'); return; }
    const result = parseScriptMarkdown(draft, script);
    if (!result.ok) { setError(result.error); return; }
    if (!onSave(result.updates)) { setError('The script could not be saved. Your Markdown draft is still here; resolve the library storage error and retry.'); return; }
    setError(''); setBaseline(draft);
    setMessage(result.newCharacters.length ? `Saved. Added ${result.newCharacters.join(', ')} as AI Partner. Set their assignments, colours and voices in Scene Partner.` : 'Saved. Cast assignments, colours and voices are preserved.');
    // The save synchronously commits; the next render supplies that snapshot.
    ownSavePending.current = true;
  };
  useEffect(() => {
    // Accept our own committed revision, but never overwrite a dirty draft.
    if (!dirty) {
      if (!ownSavePending.current && original.current !== script) {
        const latest = scriptToMarkdown(script);
        setDraft(latest);
        setBaseline(latest);
      }
      ownSavePending.current = false;
      original.current = script;
    }
  }, [script, dirty]);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[96vw] max-w-5xl flex-col overflow-hidden p-4 sm:p-6" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader className="pr-6">
        <DialogTitle>Markdown editor</DialogTitle>
        <DialogDescription>Write your entire script in one pane. Save to update the section editor and rehearsal.</DialogDescription>
      </DialogHeader>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">Markup guide</summary>
        <p className="mt-2"><code># Script title</code> · <code>## Section or turn title</code> · <code>**Alex:**</code> starts Alex’s turn · <code>&gt; Stage direction</code> adds a note.</p>
        <p className="mt-1">New character names create AI Partners; assign In Person and choose colours in Scene Partner. Prefix a markup line with a backslash to speak it literally. Other text stays as dialogue; no HTML is rendered.</p>
      </details>
      <textarea aria-label="Script Markdown" spellCheck value={draft}
        onChange={event => { setDraft(event.target.value); setError(''); setMessage(''); setDiscard(false); }}
        className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-muted/20 p-4 font-mono text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="text-sm">{message}</p>}
      {discard ? <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
        <span>Discard unsaved Markdown edits?</span>
        <button onClick={() => setDiscard(false)} className="rounded-md border px-3 py-2">Keep editing</button>
        <button onClick={onClose} className="rounded-md bg-destructive px-3 py-2 text-destructive-foreground">Discard edits</button>
      </div> : <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{dirty ? 'Unsaved changes' : 'Up to date'}</span>
        <div className="flex gap-2">
          <button onClick={close} className="rounded-md border px-3 py-2 text-sm">Back to sections</button>
          <button onClick={save} disabled={!dirty} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Save script</button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}

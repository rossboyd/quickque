import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { isDesktop } from '@/lib/desktop';
import {
  createVoiceLibrary,
  validateRecording,
  validateVoiceName,
  type ClonedVoice,
  type VoiceLibrary,
  type VoiceRecording,
} from '@/lib/voice-library';
import { VoiceRecorder } from './voice-recorder';

export function VoiceLibraryPanel({
  onVoicesChange,
  referencedVoiceIds = [],
}: {
  onVoicesChange?: (voices: ClonedVoice[]) => void;
  referencedVoiceIds?: string[];
}) {
  const library = useMemo(() => createVoiceLibrary(), []);
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewToken = useRef(0);
  useEffect(() => () => { previewToken.current++; void library.stopPreview(); }, [library]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState(false);
  const [reviewed, setReviewed] = useState<VoiceRecording | null>(null);
  const [rerecordingVoiceId, setRerecordingVoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isDesktop()) return;
    setLoading(true);
    try {
      const next = await library.list();
      setVoices(next);
      onVoicesChange?.(next);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, [library, onVoicesChange]);
  useEffect(() => { void load(); }, [load]);

  if (!isDesktop()) {
    return <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground" data-testid="status-voice-library-desktop-only">Voice creation and playback require the Quickque Mac desktop app. Browser speech is not used.</p>;
  }

  const saveRecording = async (reviewing: VoiceRecording) => {
    if (!consent) {
      setMessage('Confirm that you have permission to use this recording before saving.');
      return;
    }
    const error = validateVoiceName(name);
    if (error) { setMessage(error); return; }
    const recordingError = validateRecording(reviewing);
    if (recordingError) {
      setMessage(recordingError);
      return;
    }
    setSaving(true);
    try {
      if (rerecordingVoiceId) {
        await library.rerecord(rerecordingVoiceId, reviewing, true);
      } else {
        await library.create({ name: name.trim(), recording: reviewing, consentConfirmed: true });
      }
      setName('');
      setConsent(false);
      setReviewed(null);
      setRecording(false);
      setRerecordingVoiceId(null);
      setMessage('Voice saved locally on this Mac.');
      await load();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  const preview = async (voice: ClonedVoice) => {
    const token = ++previewToken.current;
    setPreviewing(voice.id); setMessage('Reading and playing saved sample…');
    try { await library.preview({ voiceId: voice.id }); if (token === previewToken.current) setMessage('Sample playback finished.'); }
    catch (error) { if (token === previewToken.current) setMessage(String(error)); }
    finally { if (token === previewToken.current) setPreviewing(null); }
  };
  const verify = async (voice: ClonedVoice) => {
    setMessage('Checking saved recording…');
    try { const info = await library.verify(voice.id); setMessage(`Saved sample verified: ${info.durationSeconds.toFixed(1)}s, ${info.sampleRate / 1000} kHz, ${Math.round(info.bytes / 1024)} KB. WAV and checksum checks passed.`); }
    catch (error) { setMessage(String(error)); }
  };

  const rename = async (voice: ClonedVoice) => {
    const next = window.prompt('Rename voice', voice.name)?.trim();
    if (!next || next === voice.name) return;
    const error = validateVoiceName(next);
    if (error) { setMessage(error); return; }
    try { await library.rename(voice.id, next); await load(); } catch (renameError) { setMessage(String(renameError)); }
  };

  const remove = async (voice: ClonedVoice) => {
    const references = referencedVoiceIds.includes(voice.referenceId) || referencedVoiceIds.includes(voice.id);
    const warning = references
      ? 'This voice is assigned to one or more characters or scripts. Deleting it will mark those assignments unavailable; reassign them before playback. Delete anyway?'
      : 'Delete this local voice and its recording?';
    if (!window.confirm(warning)) return;
    try { await library.delete(voice.id); await load(); } catch (error) { setMessage(String(error)); }
  };

  return (
    <section className="space-y-4" data-testid="voice-library">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">My cloned voices</h3>
          <p className="mt-1 text-sm text-muted-foreground">Voice samples and conditioning data stay in this Mac’s app storage. Script JSON and backups contain only voice IDs and revisions.</p>
        </div>
        {!recording && <button type="button" data-testid="button-add-cloned-voice" onClick={() => { setMessage(null); setReviewed(null); setConsent(false); setRerecordingVoiceId(null); setRecording(true); }} className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New voice</button>}
      </div>
      {recording && (
        <div className="space-y-3">
          <label className="block text-sm font-medium" htmlFor="voice-name-input">{rerecordingVoiceId ? 'Record a replacement reference' : 'Voice name'}</label>
          <input id="voice-name-input" data-testid="input-voice-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="My rehearsal voice" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <VoiceRecorder
            library={library}
            onReviewed={result => {
              setReviewed(result?.complete ? result : null);
            }}
            onCancel={() => {
              setReviewed(null);
              setRecording(false);
              setRerecordingVoiceId(null);
              setConsent(false);
            }}
            onConsentChange={setConsent}
          />
          <p className="text-xs text-muted-foreground">After reviewing, confirm permission above. Saving is enabled once a complete sample and a name are provided.</p>
          {reviewed && (
            <button
              type="button"
              data-testid="button-save-cloned-voice"
              onClick={() => void saveRecording(reviewed)}
              disabled={saving || !consent}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save voice locally'}
            </button>
          )}
        </div>
      )}
      {loading && <p role="status" className="text-sm text-muted-foreground" data-testid="status-voice-library-loading">Loading local voices…</p>}
      {!loading && voices.length === 0 && !recording && <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="empty-voice-library">No cloned voices yet. Record a short reference to create your first one.</p>}
      <div className="space-y-2">
        {voices.map(voice => (
          <div key={voice.id} data-testid={`card-cloned-voice-${voice.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{voice.name}</p>
              <p className="text-xs text-muted-foreground">{voice.durationSeconds.toFixed(1)}s · revision {voice.revision}{voice.available ? '' : ' · recording unavailable'}</p>
              <button type="button" className="mt-1 text-xs text-primary" onClick={() => void verify(voice)}>Verify saved sample</button>
              {previewing === voice.id && <button type="button" className="ml-3 text-xs text-primary" onClick={() => { previewToken.current++; void library.stopPreview(); setPreviewing(null); setMessage('Playback stopped.'); }}>Stop sample</button>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" data-testid={`button-preview-cloned-voice-${voice.id}`} onClick={() => void preview(voice)} disabled={previewing === voice.id} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Preview ${voice.name}`}><Play className="h-4 w-4" /></button>
              <button type="button" data-testid={`button-rerecord-cloned-voice-${voice.id}`} onClick={() => { setName(voice.name); setRerecordingVoiceId(voice.id); setReviewed(null); setConsent(false); setRecording(true); }} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Re-record ${voice.name}`}><Mic className="h-4 w-4" /></button>
              <button type="button" data-testid={`button-rename-cloned-voice-${voice.id}`} onClick={() => void rename(voice)} className="rounded p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Rename ${voice.name}`}><Pencil className="h-4 w-4" /></button>
              <button type="button" data-testid={`button-delete-cloned-voice-${voice.id}`} onClick={() => void remove(voice)} className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${voice.name}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      {message && <p role="status" data-testid="status-voice-library" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}

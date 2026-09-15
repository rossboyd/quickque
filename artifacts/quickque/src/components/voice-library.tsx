import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Mic, Pencil, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
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
import voiceArtwork from '@assets/quickque-performance-artwork.webp';

export function VoiceLibraryPanel({
  onVoicesChange,
  referencedVoiceIds = [],
  recordingContext,
  onVoiceCreated,
}: {
  onVoicesChange?: (voices: ClonedVoice[]) => void;
  referencedVoiceIds?: string[];
  recordingContext?: { characterName: string; emotion?: string; gender?: string; ageRange?: string };
  onVoiceCreated?: (voice: ClonedVoice) => void;
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
  const [profileDrafts, setProfileDrafts] = useState<Record<string, { emotion: string; gender: string; ageRange: string }>>({});
  const [profileSaving, setProfileSaving] = useState<string | null>(null);
  const [suggestionsApproved, setSuggestionsApproved] = useState(false);
  const [suggestionsSkipped, setSuggestionsSkipped] = useState(false);
  const [suggestionDraft, setSuggestionDraft] = useState({ emotion: '', gender: '', ageRange: '' });

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
      let saved: ClonedVoice;
      let profileNotesSaved = true;
      if (rerecordingVoiceId) {
        saved = await library.rerecord(rerecordingVoiceId, reviewing, true);
        if (saved.name !== name.trim()) saved = await library.rename(saved.id, name.trim());
      } else {
        saved = await library.create({ name: name.trim(), recording: reviewing, consentConfirmed: true });
        if (suggestionsApproved && recordingContext) {
          try {
            saved = await library.updateProfile(saved.id, {
              emotion: suggestionDraft.emotion,
              gender: suggestionDraft.gender,
              ageRange: suggestionDraft.ageRange,
            });
          } catch {
            profileNotesSaved = false;
          }
        }
      }
      setName('');
      setConsent(false);
      setReviewed(null);
      setRecording(false);
      setRerecordingVoiceId(null);
      await load();
      onVoiceCreated?.(saved);
      setMessage(profileNotesSaved
        ? (recordingContext ? `Voice saved locally. ${saved.name} is proposed for ${recordingContext.characterName}; use Preview beside the character to listen before rehearsal.` : 'Voice saved locally on this Mac.')
        : `Voice audio was saved and proposed for ${recordingContext?.characterName ?? 'this character'}, but its optional profile notes could not be saved. You can add them from Your Voices.`);
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
  const saveProfile = async (voice: ClonedVoice) => {
    const draft = profileDrafts[voice.id] ?? { emotion: voice.emotion ?? '', gender: voice.gender ?? '', ageRange: voice.ageRange ?? '' };
    setProfileSaving(voice.id);
    try {
      const updated = await library.updateProfile(voice.id, draft);
      setVoices(current => current.map(item => item.id === voice.id ? updated : item));
      setMessage('Profile notes saved locally.');
    } catch (error) { setMessage(String(error)); }
    finally { setProfileSaving(null); }
  };

  const draftFor = (voice: ClonedVoice) => profileDrafts[voice.id] ?? { emotion: voice.emotion ?? '', gender: voice.gender ?? '', ageRange: voice.ageRange ?? '' };

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
        {!recording && <button type="button" data-testid="button-add-cloned-voice" onClick={() => {
          setMessage(null); setReviewed(null); setConsent(false); setRerecordingVoiceId(null);
          setSuggestionsApproved(false); setSuggestionsSkipped(false);
          setSuggestionDraft({ emotion: recordingContext?.emotion ?? '', gender: recordingContext?.gender ?? '', ageRange: recordingContext?.ageRange ?? '' });
          setRecording(true);
        }} className="flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"><Plus className="h-3.5 w-3.5" /> New voice</button>}
      </div>
      {recording && (
        <div className="space-y-3">
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
          {reviewed && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <label className="block text-base font-semibold" htmlFor="voice-name-input">Name this voice <span className="text-destructive">*</span></label>
              <input id="voice-name-input" autoFocus data-testid="input-voice-name" value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="e.g. Brewster rehearsal voice" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
              {!rerecordingVoiceId && recordingContext && (
                <div className="space-y-2 rounded-md bg-muted/40 p-3 text-xs">
                  <strong>Suggested profile notes — from {recordingContext.characterName}’s character setup</strong>
                  <p className="text-muted-foreground">These are copied from explicit setup fields, not inferred from the recording.</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {([['emotion', 'Style / emotion'], ['gender', 'Gender'], ['ageRange', 'Age']] as const).map(([key, label]) => (
                      <label key={key}>{label}
                        <input value={suggestionDraft[key]} maxLength={40} onChange={event => setSuggestionDraft(current => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded border border-border bg-background px-2 py-1" />
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setSuggestionsApproved(true); setSuggestionsSkipped(false); }} className="rounded border px-2 py-1">Approve suggestions</button>
                    <button type="button" onClick={() => { setSuggestionsSkipped(true); setSuggestionsApproved(false); }} className="rounded border px-2 py-1">Skip</button>
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">Confirm permission above, enter a required name, and approve or skip any labelled suggestions.</p>
              <button
              type="button"
              data-testid="button-save-cloned-voice"
              onClick={() => void saveRecording(reviewed)}
              disabled={saving || !consent || !!validateVoiceName(name) || (!!recordingContext && !rerecordingVoiceId && !suggestionsApproved && !suggestionsSkipped)}
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save voice locally'}
              </button>
            </div>
          )}
        </div>
      )}
      {loading && <p role="status" className="text-sm text-muted-foreground" data-testid="status-voice-library-loading">Loading local voices…</p>}
      {!loading && voices.length === 0 && !recording && <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground" data-testid="empty-voice-library">No cloned voices yet. Record a short reference to create your first one.</p>}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {voices.map(voice => (
          <article key={voice.id} data-testid={`card-cloned-voice-${voice.id}`} className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-xl hover:shadow-black/15">
            <div className="relative h-44 overflow-hidden border-b border-border bg-black">
              <img src={voiceArtwork} alt="" className="h-full w-full object-cover grayscale transition duration-500 ease-out group-hover:scale-[1.035]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/10" />
              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.15em] backdrop-blur-sm ${voice.available ? 'border-emerald-300/25 bg-emerald-950/45 text-emerald-200' : 'border-white/20 bg-black/45 text-white/65'}`}>
                  <CheckCircle2 className="h-3 w-3" />
                  {voice.available ? 'Ready' : 'Unavailable'}
                </span>
                <span className="rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[10px] text-white/75 backdrop-blur-sm">{voice.durationSeconds.toFixed(1)}s · rev {voice.revision}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div aria-hidden="true" className="mb-3 flex h-5 items-end gap-1 opacity-55">
                  {[8, 15, 10, 19, 12, 17, 7, 14, 20, 11, 16, 9].map((height, index) => <i key={index} className="w-0.5 rounded-full bg-primary" style={{ height }} />)}
                </div>
                <h3 className="truncate text-xl font-semibold tracking-tight text-white drop-shadow-md">{voice.name}</h3>
              </div>
            </div>
            <div className="flex flex-1 flex-col p-4">
              <div className="flex min-h-6 flex-wrap gap-1.5">{[voice.emotion, voice.gender, voice.ageRange].filter(Boolean).map(tag => <span key={tag} className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">{tag}</span>)}</div>
              <button type="button" className="mt-2 inline-flex w-fit items-center gap-1.5 text-xs text-primary hover:underline" onClick={() => void verify(voice)}><ShieldCheck className="h-3.5 w-3.5" /> Verify saved sample</button>
              <div className="mt-4 grid grid-cols-1 gap-2 border-t border-border/60 pt-4 sm:grid-cols-3">
                {([['emotion', 'Emotion note', 'e.g. grounded, bright'], ['gender', 'Gender note', 'optional'], ['ageRange', 'Age range note', 'e.g. 30s–40s']] as const).map(([key, label, placeholder]) => (
                  <label key={key} className="text-[11px] font-medium text-muted-foreground">{label}
                    <input data-testid={`input-${key}-${voice.id}`} value={draftFor(voice)[key]} onChange={event => setProfileDrafts(current => ({ ...current, [voice.id]: { ...draftFor(voice), [key]: event.target.value } }))} placeholder={placeholder} className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground" />
                  </label>
                ))}
                <button type="button" data-testid={`button-save-profile-${voice.id}`} onClick={() => void saveProfile(voice)} disabled={profileSaving === voice.id} className="sm:col-span-3 justify-self-start rounded-md border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50">{profileSaving === voice.id ? 'Saving…' : 'Save profile notes'}</button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border/60 pt-4 sm:grid-cols-4">
                <button type="button" data-testid={`button-preview-cloned-voice-${voice.id}`} onClick={() => void preview(voice)} disabled={previewing === voice.id} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label={`Preview ${voice.name}`}><Play className="h-3.5 w-3.5" />{previewing === voice.id ? 'Playing…' : 'Preview'}</button>
                <button type="button" data-testid={`button-rerecord-cloned-voice-${voice.id}`} onClick={() => { setName(voice.name); setRerecordingVoiceId(voice.id); setReviewed(null); setConsent(false); setSuggestionsApproved(false); setSuggestionsSkipped(true); setRecording(true); }} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Re-record ${voice.name}`}><Mic className="h-3.5 w-3.5" />Re-record</button>
                <button type="button" data-testid={`button-rename-cloned-voice-${voice.id}`} onClick={() => void rename(voice)} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Rename ${voice.name}`}><Pencil className="h-3.5 w-3.5" />Rename</button>
                <button type="button" data-testid={`button-delete-cloned-voice-${voice.id}`} onClick={() => void remove(voice)} className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${voice.name}`}><Trash2 className="h-3.5 w-3.5" />Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {message && <p role="status" data-testid="status-voice-library" className="text-sm text-muted-foreground">{message}</p>}
    </section>
  );
}

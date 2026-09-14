import { useLicence } from '@/lib/licence';
import { useEffect, useRef, useState } from 'react';
import { FlowDebugPanel } from './flow-debug-panel';
import type { AudioJob } from '@/lib/script-audio';
import type { Script } from '@/lib/types';
import { getScriptPurpose } from '@/lib/script-purpose';
import { audioRequest, scriptAudioEntries, DEFAULT_AUDIO_VOICE } from '@/lib/script-audio-model';
import { AUDIO_CHANGED, AUDIO_JOB_CHANGED, audioJobs, audioEntitlement, audioStatus, generateAudio, cancelAudioGeneration, deleteAudio, exportAudio, PreparedScriptAudio } from '@/lib/script-audio';
import { isDesktop } from '@/lib/desktop';
import { createVoiceLibrary, type ClonedVoice } from '@/lib/voice-library';
import { useStore } from '@/lib/store';

function remainingTime(job: AudioJob | null, now: number) {
  if (!job || job.stage !== 'generation' || job.completed <= 0 || job.completed >= job.total) return null;
  const samples = job.progressSamples ?? [];
  const first = samples[0];
  const last = samples.at(-1);
  const startedAt = job.progressStartedAt;
  if (!startedAt || !last) return null;
  const completedDelta = first && last.completedWork > first.completedWork ? last.completedWork - first.completedWork : last.completedWork;
  const elapsedMs = first && last.completedWork > first.completedWork ? last.at - first.at : last.at - startedAt;
  if (completedDelta <= 0 || elapsedMs <= 0) return null;
  const estimate = Math.ceil(((job.totalWork - job.completedWork) * elapsedMs) / completedDelta / 1000);
  return Math.max(1, estimate - Math.max(0, Math.floor((now - last.at) / 1000)));
}

function friendlyTime(seconds: number) {
  if (seconds < 60) return `About ${seconds} second${seconds === 1 ? '' : 's'} left`;
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} minute${minutes === 1 ? '' : 's'} left`;
}

export function ScriptAudioPanel({ script }: { script: Script }) {
  const { updateScript } = useStore();
  const licence = useLicence();
  const [paid, setPaid] = useState(false);
  const [message, setMessage] = useState('Checking saved audio…');
  const [ready, setReady] = useState(false);
  const [operation, setOperation] = useState<'generate' | 'listen' | 'export' | 'delete' | null>(null);
  const [generating, setGenerating] = useState(false);
  const [job, setJob] = useState<AudioJob | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!generating && operation !== 'generate') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [generating, operation]);
  const busy = operation !== null || generating;
  const operationId = useRef(0);
  const revisionRef = useRef('');
  const [playing, setPlaying] = useState(false);
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const voiceLibrary = useRef(createVoiceLibrary());
  const player = useRef<PreparedScriptAudio | null>(null);
  const aborter = useRef<AbortController | null>(null);
  const version = JSON.stringify([script.id, scriptAudioEntries(script), licence.licensed]);
  const current = useRef(version);
  current.current = version;
  const performance = getScriptPurpose(script) === 'performance';
  useEffect(() => {
    if (!isDesktop()) return;
    void voiceLibrary.current.list().then(setVoices).catch(() => setVoices([]));
  }, [script.id]);

  useEffect(() => {
    let live = true;
    setReady(false);
    setGenerating(false);
    setJob(null);
    setOperation(null);
    operationId.current++;
    setPlaying(false);
    let refreshId = 0;
    const refresh = async () => {
      const id = ++refreshId;
      try {
        const access = await audioEntitlement();
        if (!live || id !== refreshId) return;
        setPaid(access.available ?? access.paid);
        if (!(access.available ?? access.paid)) { setMessage(access.reason || 'Audio generation is available in the Quickque Mac app.'); return; }
        const request = await audioRequest(script);
        if (!live || id !== refreshId) return;
        revisionRef.current = request.revision;
        if (!request.entries.length) { setMessage(performance ? 'Assign a Chatterbox voice to an AI Partner to prepare their lines.' : 'Add script text to generate audio.'); return; }
        const activeJob = audioJobs.get(script.id);
        if (activeJob?.revision === request.revision && activeJob.running) {
          setJob({ ...activeJob }); setGenerating(true); return;
        }
        const status = await audioStatus(request);
        if (!live || id !== refreshId) return;
        setReady(status.status === 'ready');
        const job = audioJobs.get(script.id);
        if (job?.revision === request.revision && job.running) { setGenerating(true); setMessage('Generating audio on this Mac…'); return; }
        setGenerating(false);
        if (job?.revision === request.revision && job.error) { setMessage(job.error); return; }
        setMessage(status.status === 'ready' ? 'Audio saved on this Mac. Ready to listen.' : 'No matching audio saved. Generate audio for this version.');
      } catch (error) { if (live && id === refreshId) setMessage(String(error)); }
    };
    void refresh();
    window.addEventListener(AUDIO_CHANGED, refresh);
    const updateJob = () => {
      const next = audioJobs.get(script.id);
      if (!live || next?.revision !== revisionRef.current) return;
      setJob({ ...next }); setGenerating(next.running); setNow(Date.now());
    };
    window.addEventListener(AUDIO_JOB_CHANGED, updateJob);
    return () => {
      live = false;
      operationId.current++;
      window.removeEventListener(AUDIO_CHANGED, refresh);
      window.removeEventListener(AUDIO_JOB_CHANGED, updateJob);
      aborter.current?.abort();
      void player.current?.dispose();
      player.current = null;
    };
  }, [version]);

  const run = async (kind: 'generate' | 'listen' | 'export' | 'delete', action: (valid: () => boolean) => Promise<void>) => {
    const expected = version;
    const id = ++operationId.current;
    const valid = () => current.current === expected && operationId.current === id;
    setOperation(kind);
    try { await action(valid); } catch (error) { if (valid()) setMessage(String(error)); }
    finally { if (valid()) setOperation(null); }
  };
  const generate = () => run('generate', async valid => {
    setMessage('Generating audio on this Mac…');
    const request = await audioRequest(script);
    if (!valid()) return;
    revisionRef.current = request.revision;
    await generateAudio(request);
  });
  const play = () => run('listen', async valid => {
    const request = await audioRequest(script);
    if (!valid()) return;
    const prepared = new PreparedScriptAudio(request);
    player.current = prepared;
    const controller = new AbortController();
    aborter.current = controller;
    setPlaying(true);
    setMessage('Preparing saved audio…');
    try {
      await prepared.prepare();
      if (!valid()) return;
      setMessage('Playing saved audio…');
       for (const entry of request.entries) await prepared.speak(entry.text, { engine: 'turbo', voiceId: entry.voiceId || DEFAULT_AUDIO_VOICE, rate: entry.rate, voiceRevision: entry.voiceRevision }, controller.signal);
      if (valid()) setMessage('Finished listening.');
    } finally {
      await prepared.dispose();
      if (valid()) setPlaying(false);
    }
  });
  const estimate = remainingTime(job, now);
  const total = job?.total ?? scriptAudioEntries(script).length;
  const totalWork = job?.totalWork ?? total;
  const completedWork = job?.completedWork ?? 0;
  const progress = totalWork ? Math.round((completedWork / totalWork) * 100) : 0;
  const button = 'rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40';
  return <details className="group rounded-2xl border border-border bg-card px-5 py-4 shadow-sm">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
      <span>
        <span className="block text-base font-semibold">Rehearsal audio</span>
        <span className="mt-0.5 block text-sm font-normal text-muted-foreground">Listen to your script and learn it anywhere.</span>
      </span>
      <span aria-hidden="true" className="text-xl text-muted-foreground transition-transform group-open:rotate-45">+</span>
    </summary>
    <div className="mt-5 space-y-4 text-sm">
      {performance && <p className="text-muted-foreground">Quickque will speak your AI Partner’s lines. Your lines and notes stay silent.</p>}
      {!performance && <div className="space-y-1">
         <label htmlFor={`narrator-voice-${script.id}`} className="text-sm font-medium">Choose a voice</label>
         {isDesktop() ? <select id={`narrator-voice-${script.id}`} data-testid="select-narrator-voice" value={script.narratorVoice?.voiceId ?? ''} onChange={event => {
           const voice = voices.find(item => item.referenceId === event.target.value);
           updateScript(script.id, {
             narratorVoice: voice
               ? { engine: 'turbo', voiceId: voice.referenceId, rate: 1, voiceRevision: voice.revision }
               : null,
           });
          }} className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
            <option value="">Quickque voice</option>
           {script.narratorVoice?.voiceId && !voices.some(voice => voice.referenceId === script.narratorVoice?.voiceId) && <option value={script.narratorVoice.voiceId}>Saved voice unavailable — choose another</option>}
           {voices.map(voice => <option key={voice.id} value={voice.referenceId}>{voice.name} (revision {voice.revision})</option>)}
         </select> : <p className="text-xs text-muted-foreground" data-testid="status-narrator-desktop-only">Narrator voices require the Quickque Mac desktop app. Browser speech is not used.</p>}
      </div>}
       {(generating || operation === 'generate') ? <div className="space-y-3 rounded-2xl bg-muted/60 p-4" role="status" data-testid="audio-generation-progress">
         <div className="flex items-start justify-between gap-3">
           <span>
             <span className="block font-medium">{job?.stage === 'model_load' ? 'Getting ready…' : job?.stage === 'voice_prepare' ? 'Preparing the voice…' : job?.stage === 'generation' ? 'Creating your rehearsal audio…' : 'Getting ready…'}</span>
             <span className="mt-1 block text-xs text-muted-foreground">{job?.stage === 'generation' ? (estimate ? friendlyTime(estimate) : 'Working out the time remaining…') : 'The first time may take a little longer.'}</span>
           </span>
           {job?.stage === 'generation' && <span className="shrink-0 text-sm font-medium">{progress}%</span>}
        </div>
         <progress aria-label="Audio generation progress" className="h-2 w-full overflow-hidden rounded-full accent-primary" max={totalWork || 1} value={job?.stage === 'generation' ? completedWork : undefined} />
         <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => { void cancelAudioGeneration().catch(error => setMessage(String(error))); }}>Stop</button>
       </div> : <p role="status" className="rounded-xl bg-muted/50 px-4 py-3 text-sm text-muted-foreground">{message}</p>}
      <div className="flex flex-wrap gap-2">
         <button type="button" className={`${button} border-primary bg-primary text-primary-foreground hover:bg-primary/90`} disabled={!paid || busy || !scriptAudioEntries(script).length} onClick={generate}>{ready ? 'Create new audio' : 'Create rehearsal audio'}</button>
         <button type="button" className={button} disabled={!paid || !ready || busy} onClick={play}>Listen</button>
        <button type="button" className={button} disabled={!paid || !ready || busy} onClick={() => run('export', async valid => { const request = await audioRequest(script); if (!valid()) return; const path = await exportAudio(request); if (path && valid()) setMessage('MP4 exported.'); })}>Export MP4</button>
        {playing && <button type="button" className={button} onClick={() => { aborter.current?.abort(); }}>Stop listening</button>}
      </div>
       <details className="rounded-xl border border-border px-3 py-2.5">
         <summary className="cursor-pointer text-xs text-muted-foreground">More options</summary>
         <div className="mt-3 space-y-3">
           <p className="text-xs text-muted-foreground">Audio stays on this Mac and is not included in script backups.</p>
           {isDesktop() && <button type="button" className={button} disabled={busy} onClick={() => run('delete', () => deleteAudio(script.id))}>Remove saved audio</button>}
           <details>
             <summary className="cursor-pointer text-xs text-muted-foreground">Troubleshooting details</summary>
             <div className="mt-2"><FlowDebugPanel /></div>
           </details>
         </div>
       </details>
    </div>
  </details>;
}

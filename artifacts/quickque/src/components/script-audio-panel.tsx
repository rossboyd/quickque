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
import { Download, Headphones, MoreHorizontal, Play, RefreshCw, Sparkles, Square, Trash2, Volume2 } from 'lucide-react';
import { ChatterboxSetup } from './chatterbox-setup';

const needsChatterboxSetup = (error: unknown) => /SCENE_SPEECH_TURBO_(UNAVAILABLE|OFFLINE|MODEL_LOAD)/.test(String(error));
function audioFailureMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const code = /^([A-Z_]+):/.exec(raw)?.[1];
  if (code === 'SCRIPT_AUDIO_CANCELLED') return 'Audio preparation was cancelled. Your script and voice assignments were not changed.';
  if (code === 'SCENE_SPEECH_TURBO_UNAVAILABLE' || code === 'SCENE_SPEECH_TURBO_OFFLINE' || code === 'SCENE_SPEECH_TURBO_MODEL_LOAD') {
    return 'Chatterbox is not ready. Open Chatterbox setup, complete or retry the local model download, then prepare audio again.';
  }
  if (code === 'SCRIPT_AUDIO_STALE') return 'This script or one of its voices changed. Prepare audio again for the current version.';
  if (/disk|space|write|save/i.test(raw)) return 'Quickque could not save the audio. Check available storage and folder access, then try again.';
  if (/read|decode|WAV|saved audio/i.test(raw)) return 'Quickque could not read the saved audio. Prepare it again; your script and voice assignments are unchanged.';
  return raw.replace(/^[A-Z_]+:\s*/, '') || 'Audio preparation failed. Try again or open troubleshooting details.';
}

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
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
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
  const [playback, setPlayback] = useState({ elapsed: 0, duration: 0 });
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
    setPlayback({ elapsed: 0, duration: 0 });
    setError(null);
    setShowSetup(false);
    let refreshId = 0;
    const refresh = async () => {
      const id = ++refreshId;
      setMessage('Checking saved audio for this version…');
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
        if (job?.revision === request.revision && job.error) {
          const failure = audioFailureMessage(job.error);
          setMessage(failure);
          setError(failure);
          setShowSetup(needsChatterboxSetup(job.error));
          return;
        }
        setError(null);
        setMessage(status.status === 'ready' ? 'Audio saved on this Mac. Ready to listen.' : 'No matching audio saved. Generate audio for this version.');
      } catch (error) {
        if (live && id === refreshId) {
          const failure = audioFailureMessage(error);
          setMessage(failure);
          setError(failure);
          setShowSetup(needsChatterboxSetup(error));
        }
      }
    };
    void refresh();
    window.addEventListener(AUDIO_CHANGED, refresh);
    const updateJob = () => {
      const next = audioJobs.get(script.id);
      if (!live || next?.revision !== revisionRef.current) return;
      setJob({ ...next }); setGenerating(next.running); setNow(Date.now());
      if (next.stage === 'failed' || next.stage === 'cancelled') {
        const failure = audioFailureMessage(next.error ?? 'Audio preparation stopped.');
        setMessage(failure);
        setError(next.stage === 'failed' ? failure : null);
        setShowSetup(needsChatterboxSetup(next.error));
      }
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
    setError(null);
    try { await action(valid); } catch (caught) {
      if (kind === 'listen' && /Audio playback cancelled/.test(String(caught))) {
        if (valid()) {
          setMessage('Playback stopped. Play starts again from the beginning.');
          setPlayback({ elapsed: 0, duration: player.current?.durationSeconds ?? 0 });
        }
        return;
      }
      const error = caught;
      if (valid()) {
        const failure = audioFailureMessage(error);
        setMessage(failure);
        setError(failure);
        setShowSetup(needsChatterboxSetup(error));
      }
    }
    finally { if (valid()) setOperation(null); }
  };
  const generate = () => run('generate', async valid => {
    setMessage('Queued on this Mac…');
    const request = await audioRequest(script);
    if (!valid()) return;
    revisionRef.current = request.revision;
    await generateAudio(request);
  });
  const stopGeneration = async () => {
    operationId.current++;
    setOperation(null);
    setMessage('Stopping audio preparation…');
    try {
      await cancelAudioGeneration();
      setGenerating(false);
      setMessage('Audio preparation was cancelled. Your script and voice assignments were not changed.');
    } catch (caught) {
      const failure = audioFailureMessage(caught);
      setError(failure);
      setMessage(failure);
    }
  };
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
      setPlayback({ elapsed: 0, duration: prepared.durationSeconds });
      setMessage('Playing saved audio…');
      let elapsedBefore = 0;
      for (const entry of request.entries) {
        const voice = { engine: 'turbo' as const, voiceId: entry.voiceId || DEFAULT_AUDIO_VOICE, rate: entry.rate, voiceRevision: entry.voiceRevision };
        await prepared.speak(
          entry.text,
          voice,
          controller.signal,
          undefined,
          (elapsed, duration) => setPlayback({ elapsed: elapsedBefore + elapsed, duration: prepared.durationSeconds }),
        );
        elapsedBefore += prepared.durationFor(entry.text, voice);
      }
      if (valid()) setMessage('Finished listening.');
    } finally {
      await prepared.dispose();
      if (valid()) {
        setPlaying(false);
        if (controller.signal.aborted) setPlayback({ elapsed: 0, duration: prepared.durationSeconds });
      }
    }
  });
  const estimate = remainingTime(job, now);
  const total = job?.total ?? scriptAudioEntries(script).length;
  const totalWork = job?.totalWork ?? total;
  const completedWork = job?.completedWork ?? 0;
  const progress = totalWork ? Math.round((completedWork / totalWork) * 100) : 0;
  const quiet = Boolean(job?.running && now - job.startedAt >= 20_000 && (!job.progressSamples?.length || now - (job.progressSamples.at(-1)?.at ?? job.startedAt) >= 20_000));
  const playbackPercent = playback.duration > 0 ? Math.min(100, (playback.elapsed / playback.duration) * 100) : 0;
  const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  const button = 'rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40';
  return <section aria-labelledby={`script-audio-title-${script.id}`} className="space-y-4">
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 id={`script-audio-title-${script.id}`} className="text-base font-semibold">Rehearsal audio</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Listen to your script and learn it anywhere.</p>
      </div>
      {ready && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Ready
      </span>}
    </div>
    <div className="space-y-4 text-sm">
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
      {(generating || operation === 'generate') ? <div className="space-y-3 rounded-2xl border border-border bg-muted/60 p-4" role="status" data-testid="audio-generation-progress">
         <div className="flex items-start justify-between gap-3">
           <span>
              <span className="block font-medium">{quiet ? 'Still preparing…' : !job || job.stage === 'queued' ? 'Queued…' : job.stage === 'checking' ? 'Checking audio setup…' : job.stage === 'model_load' ? 'Loading Chatterbox…' : job.stage === 'voice_prepare' ? 'Preparing the voice…' : job.stage === 'generation' ? 'Creating your rehearsal audio…' : job.stage === 'saving' ? 'Saving and checking audio…' : 'Getting ready…'}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{quiet ? 'No new progress signal has arrived yet. Quickque is still waiting for the local job; you can stop it or open diagnostics.' : job?.stage === 'generation' ? (estimate ? friendlyTime(estimate) : 'Working out the time remaining…') : 'Time remaining is not available for this stage.'}</span>
           </span>
           {job?.stage === 'generation' && <span className="shrink-0 text-sm font-medium">{progress}%</span>}
        </div>
          <progress aria-label="Audio generation progress" className="h-2 w-full overflow-hidden rounded-full accent-primary motion-reduce:animate-none" max={totalWork || 1} value={job?.stage === 'generation' ? completedWork : undefined} />
          <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => void stopGeneration()}>Stop</button>
      </div> : ready ? <div data-testid="audio-ready-player" className="overflow-hidden rounded-2xl bg-[#18181b] text-white shadow-lg shadow-black/10">
        <div className="flex items-center gap-3 p-3 sm:p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/55 shadow-inner">
            <Volume2 className="h-5 w-5" />
          </div>
          <button
            type="button"
            disabled={busy && !playing}
            onClick={() => playing ? aborter.current?.abort() : play()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 disabled:opacity-40"
            aria-label={playing ? 'Stop saved audio' : 'Play saved audio'}
          >
             {playing ? <Square className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{script.title}</p>
             <p role="status" className="mt-0.5 truncate text-xs text-white/60">{playing ? `Playing · ${formatClock(playback.elapsed)} / ${formatClock(playback.duration)}` : `${total} saved ${total === 1 ? 'passage' : 'passages'} · On this Mac`}</p>
             <div role="progressbar" aria-label="Saved audio playback progress" aria-valuemin={0} aria-valuemax={playback.duration || 0} aria-valuenow={playback.elapsed} className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
               <div className="h-full rounded-full bg-white motion-reduce:transition-none" style={{ width: `${playbackPercent}%` }} />
            </div>
             {playing && <p className="mt-1 text-[10px] text-white/50">Stop returns playback to the beginning.</p>}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => run('export', async valid => { const request = await audioRequest(script); if (!valid()) return; const path = await exportAudio(request); if (path && valid()) setMessage('MP4 exported.'); })}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-40"
            aria-label="Export MP4"
            title="Export MP4"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div> : <div data-testid="audio-missing-cta" className="flex flex-col gap-4 rounded-2xl border border-dashed border-primary/35 bg-primary/[0.045] p-5 sm:flex-row sm:items-center">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Headphones className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Prepare audio for this script</p>
          <p role="status" className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
        <button type="button" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40" disabled={!paid || busy || !scriptAudioEntries(script).length} onClick={generate}>
          <Sparkles className="h-4 w-4" />
          Prepare audio
        </button>
      </div>}
       {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
         <p>{error}</p>
         <button type="button" className="mt-2 underline underline-offset-4" disabled={busy} onClick={generate}>Try preparing again</button>
       </div>}
       {showSetup && <div className="rounded-xl border border-border p-3"><ChatterboxSetup compact onReady={() => setShowSetup(false)} /></div>}
      <details className="rounded-xl border border-border px-3 py-2.5">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" />
            More options
          </summary>
         <div className="mt-3 space-y-3">
           <p className="text-xs text-muted-foreground">Audio stays on this Mac and is not included in script backups.</p>
            <div className="flex flex-wrap gap-2">
              {ready && <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={!paid || busy || !scriptAudioEntries(script).length} onClick={generate}><RefreshCw className="h-3.5 w-3.5" />Prepare new audio</button>}
              {isDesktop() && ready && <button type="button" className={`${button} inline-flex items-center gap-2`} disabled={busy} onClick={() => run('delete', () => deleteAudio(script.id))}><Trash2 className="h-3.5 w-3.5" />Remove saved audio</button>}
            </div>
           <details>
             <summary className="cursor-pointer text-xs text-muted-foreground">Troubleshooting details</summary>
             <div className="mt-2"><FlowDebugPanel /></div>
           </details>
         </div>
       </details>
    </div>
  </section>;
}

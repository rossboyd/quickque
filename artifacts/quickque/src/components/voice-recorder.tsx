import { useEffect, useRef, useState } from 'react';
import { Check, Mic, RotateCcw, Square, Volume2, X } from 'lucide-react';
import {
  MIN_REFERENCE_SECONDS,
  MAX_REFERENCE_SECONDS,
  TARGET_REFERENCE_SECONDS,
  VOICE_RECORDING_PROMPT,
  type VoiceLibrary,
  type VoiceRecording,
  validateRecording,
} from '@/lib/voice-library';

type RecorderState = 'prepare' | 'ready' | 'countdown' | 'recording' | 'review';

export function VoiceRecorder({
  library,
  onReviewed,
  onConsentChange,
  onCancel,
}: {
  library: VoiceLibrary;
  onReviewed?: (recording: VoiceRecording | null) => void;
  onConsentChange?: (confirmed: boolean) => void;
  onCancel?: () => void;
}) {
  const [state, setState] = useState<RecorderState>('prepare');
  const [session, setSession] = useState<Awaited<ReturnType<VoiceLibrary['startRecording']>> | null>(null);
  const [recording, setRecording] = useState<VoiceRecording | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<Awaited<ReturnType<VoiceLibrary['startRecording']>> | null>(null);
  const countdownGeneration = useRef(0);
  const startedAt = useRef(0);
  const mounted = useRef(true);

  const clearTimers = () => {
    if (timer.current) clearInterval(timer.current);
    if (stopTimer.current) clearTimeout(stopTimer.current);
    timer.current = null;
    stopTimer.current = null;
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      countdownGeneration.current++;
      clearTimers();
      if (sessionRef.current) void sessionRef.current.cancel().catch(() => {});
      void library.stopPreview().catch(() => {});
    };
  }, [library]);

  const prepare = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await library.requestMicrophonePermission();
      if (mounted.current) setState('ready');
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const begin = async () => {
    const generation = ++countdownGeneration.current;
    setState('countdown');
    for (const value of [3, 2, 1]) {
      if (!mounted.current || generation !== countdownGeneration.current) return;
      setCountdown(value);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!mounted.current || generation !== countdownGeneration.current) return;
    setBusy(true);
    setMessage(null);
    onReviewed?.(null);
    try {
      const next = await library.startRecording();
      if (!mounted.current) { await next.cancel(); return; }
      setSession(next);
      sessionRef.current = next;
      setSeconds(0);
      setLevel(0);
      startedAt.current = performance.now();
      setState('recording');
      timer.current = setInterval(() => {
        const failure = next.currentFailure();
        if (failure) {
          clearTimers();
          sessionRef.current = null;
          setSession(null);
          setMessage(failure);
          setState('ready');
          return;
        }
        setSeconds((performance.now() - startedAt.current) / 1000);
        setLevel(next.currentLevel());
      }, 100);
      stopTimer.current = setTimeout(() => { void finish(next); }, MAX_REFERENCE_SECONDS * 1000);
    } catch (error) {
      setMessage(String(error));
      setState('ready');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (activeSession = session) => {
    if (!activeSession || sessionRef.current !== activeSession) return;
    sessionRef.current = null;
    clearTimers();
    setBusy(true);
    setMessage(null);
    try {
      const result = await activeSession.stop();
      setRecording(result);
      onReviewed?.(result);
      setState('review');
      const validation = validateRecording(result);
      if (validation) setMessage(validation);
    } catch (error) {
      setMessage(String(error));
      setState('ready');
      setSession(null);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    countdownGeneration.current++;
    await library.stopPreview();
    if (sessionRef.current) await sessionRef.current.cancel().catch(() => {});
    setRecording(null);
    onReviewed?.(null);
    setSession(null);
    sessionRef.current = null;
    setConsent(false);
    onConsentChange?.(false);
    setMessage(null);
    setState('ready');
  };

  const cancel = async () => {
    countdownGeneration.current++;
    clearTimers();
    if (session) await session.cancel().catch(() => {});
    setSession(null);
    sessionRef.current = null;
    setRecording(null);
    setState('prepare');
    onCancel?.();
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="voice-recorder">
      <div>
        <h3 className="font-semibold">Record a voice reference</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Record only yourself or someone who has given permission. The reference stays on this Mac. Aim for {TARGET_REFERENCE_SECONDS} seconds; new samples must be {MIN_REFERENCE_SECONDS}–{MAX_REFERENCE_SECONDS} seconds.
        </p>
      </div>
      <blockquote className="rounded-lg bg-muted/50 p-3 text-sm leading-relaxed" data-testid="text-voice-recording-prompt">
        “{VOICE_RECORDING_PROMPT}”
      </blockquote>
      {state === 'prepare' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">First, Quickque will ask for microphone access. Recording will not start after permission is granted.</p>
          <button type="button" data-testid="button-prepare-voice-recording" onClick={() => void prepare()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
            <Mic className="h-4 w-4" /> {busy ? 'Checking microphone…' : 'Allow microphone and prepare'}
          </button>
        </div>
      )}
      {state === 'countdown' && (
        <div role="status" aria-live="assertive" data-testid="status-voice-countdown" className="rounded-lg border border-primary/30 bg-primary/10 p-6 text-center">
          <p className="text-sm text-muted-foreground">Recording begins in</p>
          <strong className="text-5xl text-primary">{countdown}</strong>
        </div>
      )}
      {state === 'recording' && (
        <div className="space-y-3" data-testid="status-voice-recording">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-destructive"><Mic className="h-4 w-4 animate-pulse" /> Recording</span>
            <span>{Math.min(seconds, MAX_REFERENCE_SECONDS).toFixed(1)} / {MAX_REFERENCE_SECONDS}s</span>
          </div>
          <p role="status" className={`text-xs ${seconds >= MIN_REFERENCE_SECONDS ? 'text-emerald-600' : 'text-muted-foreground'}`}>
            {seconds >= MIN_REFERENCE_SECONDS ? 'Minimum reached. Stop when ready.' : `${Math.max(0, MIN_REFERENCE_SECONDS - seconds).toFixed(1)} seconds until the minimum.`}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, seconds / MAX_REFERENCE_SECONDS * 100)}%` }} />
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Input level</span>
              <span>{level < 0.02 ? 'Too quiet' : level > 0.95 ? 'Too loud' : 'Good'}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-label="Live microphone input level">
              <div
                className={`h-full transition-all ${level > 0.95 ? 'bg-destructive' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, level * 100)}%` }}
              />
            </div>
          </div>
          <button type="button" data-testid="button-stop-voice-recording" onClick={() => void finish()} disabled={busy || seconds < MIN_REFERENCE_SECONDS} className="flex w-full items-center justify-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground disabled:opacity-50">
            <Square className="h-4 w-4 fill-current" /> Stop and review
          </button>
        </div>
      )}
      {state === 'review' && recording && (
        <div className="space-y-3" data-testid="voice-recording-review">
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Reference sample</span>
              <strong>{recording.durationSeconds.toFixed(1)} seconds</strong>
            </div>
            {recording.levelPeak !== undefined && <p className="mt-1 text-xs text-muted-foreground">Input level captured successfully.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="button-preview-voice-recording" onClick={() => { setMessage(null); setPreviewing(true); void library.previewRecording(recording).catch(error => setMessage(String(error))).finally(() => setPreviewing(false)); }} disabled={busy || previewing} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
              <Volume2 className="h-4 w-4" /> {previewing ? 'Playing sample…' : 'Listen'}
            </button>
            <button type="button" data-testid="button-retry-voice-recording" onClick={() => void retry()} disabled={busy} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">
              <RotateCcw className="h-4 w-4" /> Record again
            </button>
          </div>
          {previewing && <button type="button" onClick={() => void library.stopPreview()} className="text-xs text-primary">Stop sample</button>}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" data-testid="input-voice-consent" checked={consent} onChange={event => { setConsent(event.target.checked); onConsentChange?.(event.target.checked); }} className="mt-0.5" />
            <span>I have permission to use this recording, and understand it stays on this Mac for my Quickque voices.</span>
          </label>
          <p className="text-xs text-muted-foreground">Review the sample before saving. Quickque does not upload voice recordings or include them in scripts and backups.</p>
          {validateRecording(recording) === null && consent && (
            <p role="status" className="flex items-center gap-1 text-xs text-emerald-600"><Check className="h-3.5 w-3.5" /> Recording is ready to save.</p>
          )}
        </div>
      )}
      {state === 'ready' && (
        <button type="button" data-testid="button-start-voice-recording" onClick={() => void begin()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          <Mic className="h-4 w-4" /> Record with 3-2-1 countdown
        </button>
      )}
      {message && <p role="alert" data-testid="status-voice-recorder-error" className="text-sm text-destructive">{message}</p>}
      {onCancel && <button type="button" data-testid="button-cancel-voice-recording" onClick={() => void cancel()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /> Cancel</button>}
    </div>
  );
}

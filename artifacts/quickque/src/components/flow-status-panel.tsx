import { FlowState } from "@/hooks/use-local-flow";
import { NativeErrorDetails } from "@/components/native-error-details";
import { NATIVE_SAMPLE_RATE } from "@/lib/flow/native-errors";

interface FlowStatusPanelProps {
  flow: FlowState;
  onCancelMode: () => void;
  onOpenWizard?: () => void;
}

export function FlowStatusPanel({ flow, onCancelMode, onOpenWizard }: FlowStatusPanelProps) {
  const warning = flow.warning ? <AudioDropWarning flow={flow} /> : null;

  if (flow.status === 'limit-reached') {
    return <div role="status" className="absolute inset-x-4 bottom-24 max-w-md mx-auto rounded-xl border border-border bg-card p-5 shadow-lg z-50">
      <h3 className="font-semibold">This session’s free Voice Follow is complete</h3>
      <p className="my-3 text-sm text-muted-foreground">You’ve used 30 seconds of active listening. Keep rehearsing or presenting in manual mode. Unlimited Voice Follow is included with £2.50/month or £25 lifetime; checkout is currently a demo.</p>
      <button onClick={onCancelMode} className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Continue in manual mode</button>
    </div>;
  }

  if (flow.error && !['needs-model', 'unsupported', 'downloading'].includes(flow.status)) {
    return (
      <>
        {warning}
        <div role="alert" className={`absolute ${flow.warning ? 'top-36' : 'top-20'} inset-x-4 max-w-lg mx-auto bg-destructive/90 text-destructive-foreground px-4 py-3 rounded-lg shadow-lg z-50 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-4`}>
          <span className="text-sm font-medium">{flow.error}</span>
          <button
            onClick={() => flow.start()}
            className="bg-white/20 px-2 py-1 rounded text-xs hover:bg-white/30 transition-colors"
          >
            Retry listening
          </button>
          <button onClick={onCancelMode} className="text-xs underline">Use manual mode</button>
          {onOpenWizard && (
            <button onClick={onOpenWizard} className="text-xs underline ml-auto">Setup Guide</button>
          )}
          {flow.errorDetails && (
            <NativeErrorDetails details={flow.errorDetails} onClear={flow.clearErrorDetails} />
          )}
        </div>
      </>
    );
  }

  if (flow.status === 'needs-model' || flow.status === 'unsupported') {
    return (
      <>
        {warning}
        <div className="absolute inset-x-0 bottom-24 max-w-md mx-auto bg-card border border-border rounded-xl p-5 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4">
          <h3 className="font-bold text-lg mb-2 text-foreground">Voice Following (Apple on-device speech)</h3>
          {flow.status === 'unsupported' ? (
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              {flow.downloadMessage || "Voice Follow runs in the installed Quickque app on macOS Tahoe 26 or later on Apple Silicon. This browser preview supports manual reading only."}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                Voice Follow uses Apple’s on-device SpeechAnalyzer and SpeechTranscriber on macOS Tahoe 26 or later.
                If Apple’s managed language assets are missing, download them once before listening.
              </p>
              <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
                Apple processes microphone audio on your Mac in temporary memory—not saved as recordings, added to backups, or uploaded. There is no cloud fallback. Pause stops capture; 30 seconds without speech stops listening.
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Apple language assets are managed by macOS. Downloading is explicit, shows available progress, and does not start the microphone.
              </p>
              {flow.error && <p className="text-sm text-destructive mb-4 font-medium">{flow.error}</p>}
              {flow.errorDetails && (
                <NativeErrorDetails details={flow.errorDetails} onClear={flow.clearErrorDetails} />
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={onCancelMode}
                  className="px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5 rounded transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={flow.download}
                  className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded font-medium shadow-sm hover:bg-primary/90 transition-colors"
                >
                  Download language assets
                </button>
              </div>
            </>
          )}
          <div className="mt-4 flex justify-between items-center">
            {flow.status === 'unsupported' ? (
              <button onClick={onCancelMode} className="text-sm text-primary underline">Return to manual reading</button>
            ) : <div />}
            {onOpenWizard && (
              <button onClick={onOpenWizard} className="text-xs text-primary hover:underline font-medium">
                Setup Guide
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  if (flow.status === 'downloading') {
    const percent = flow.progress === null ? null : Math.min(100, Math.max(0, Math.round(flow.progress * 100)));

    return (
      <>
        {warning}
        <div className="absolute inset-x-0 bottom-24 max-w-md mx-auto bg-card border border-border rounded-xl p-5 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4">
          <h3 className="font-bold text-sm mb-3 text-foreground">Downloading Apple language assets…</h3>
          <div role="progressbar" aria-label="Apple language asset download" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100} className="w-full bg-secondary h-2.5 rounded-full overflow-hidden mb-3">
            <div className={`bg-primary h-full transition-all duration-300${percent === null ? " animate-pulse" : ""}`} style={{ width: percent === null ? "35%" : `${percent}%` }} />
          </div>
          <div className="flex justify-between items-center text-xs font-medium">
            <span className="text-muted-foreground">
              {percent === null ? "Waiting…" : `${percent}%`}
              {flow.downloadMessage && ` - ${flow.downloadMessage}`}
            </span>
            <button
              onClick={flow.cancelDownload}
              className="text-destructive hover:underline"
            >
              Stop waiting
            </button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Apple may finish a requested download in the background.</p>
        </div>
      </>
    );
  }

  if (['ready', 'silence-stopped'].includes(flow.status)) {
    return (
      <>
        {warning}
        <div role="status" className="absolute inset-x-4 bottom-24 max-w-md mx-auto bg-card border border-border rounded-xl p-4 shadow-lg z-50 text-sm">
          <p className="font-medium mb-2">{flow.status === 'silence-stopped' ? 'Listening stopped after 30 seconds without speech.' : 'Apple on-device speech is ready. Start when you are ready to speak.'}</p>
          <p className="text-muted-foreground mb-3">Audio is processed in temporary memory on your Mac, never saved or uploaded. There is no cloud fallback. Another person reading matching words can move the script—pause when needed.</p>
          <div className="flex items-center justify-between mt-1">
            {onOpenWizard ? (
              <button onClick={onOpenWizard} className="text-xs text-primary hover:underline font-medium">
                Setup Guide
              </button>
            ) : <div />}
            <button onClick={flow.start} className="px-3 py-2 bg-primary text-primary-foreground rounded font-medium shadow-sm hover:bg-primary/90 transition-colors">
              {flow.status === 'silence-stopped' ? 'Restart listening' : 'Start microphone'}
            </button>
          </div>
        </div>
      </>
    );
  }
  return warning;
}

function formatAudioDuration(seconds: number): string {
  if (seconds < 1) return `${Math.round(seconds * 1000)} ms`;
  return `${seconds.toFixed(1)} s`;
}

function AudioDropWarning({ flow }: { flow: FlowState }) {
  if (!flow.warning) return null;
  const droppedSeconds = flow.warning.droppedFrames / NATIVE_SAMPLE_RATE;
  const queuedSeconds = flow.warning.queuedFrames / NATIVE_SAMPLE_RATE;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-20 inset-x-4 max-w-lg mx-auto rounded-lg border border-amber-400/40 bg-amber-50/95 px-3 py-2 text-xs text-amber-950 shadow-md dark:bg-amber-950/95 dark:text-amber-50 z-40"
    >
      <span className="font-medium">Audio catch-up: </span>
      Dropped {formatAudioDuration(droppedSeconds)} ({flow.warning.droppedFrames.toLocaleString()} frames cumulative).
      {queuedSeconds > 0
        ? ` ${formatAudioDuration(queuedSeconds)} queued to catch up.`
        : " Queue caught up."}
      {" Listening continues."}
    </div>
  );
}

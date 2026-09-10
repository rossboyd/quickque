import { FlowState } from "@/hooks/use-local-flow";

interface FlowStatusPanelProps {
  flow: FlowState;
  onCancelMode: () => void;
}

export function FlowStatusPanel({ flow, onCancelMode }: FlowStatusPanelProps) {
  if (flow.error && !['needs-model', 'unsupported', 'downloading'].includes(flow.status)) {
    return (
      <div role="alert" className="absolute top-20 inset-x-4 max-w-lg mx-auto bg-destructive/90 text-destructive-foreground px-4 py-3 rounded-lg shadow-lg z-50 flex flex-wrap items-center gap-3 animate-in fade-in slide-in-from-top-4">
        <span className="text-sm font-medium">{flow.error}</span>
        <button 
          onClick={() => flow.start()} 
          className="bg-white/20 px-2 py-1 rounded text-xs hover:bg-white/30 transition-colors"
        >
          Retry listening
        </button>
        <button onClick={flow.download} className="bg-white/20 px-2 py-1 rounded text-xs hover:bg-white/30">Reinstall model</button>
        <button onClick={onCancelMode} className="text-xs underline">Use manual mode</button>
      </div>
    );
  }

  if (flow.status === 'needs-model' || flow.status === 'unsupported') {
    return (
      <div className="absolute inset-x-0 bottom-24 max-w-md mx-auto bg-card border border-border rounded-xl p-5 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4">
        <h3 className="font-bold text-lg mb-2 text-foreground">Voice Following (Flow)</h3>
        {flow.status === 'unsupported' ? (
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            {flow.downloadMessage || "Flow runs locally in the installed Quickque app on an Apple Silicon Mac. This browser preview supports manual reading only."}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              Download Parakeet Realtime EOU and its speech detector once, then use Flow offline.
              The download size and progress will be shown during setup.
            </p>
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              Microphone audio and recognised words are processed in temporary memory—not saved as recordings, added to backups, or uploaded. Pause stops capture; 30 seconds without speech stops listening.
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Parakeet weights use the <a href="https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/" target="_blank" rel="noreferrer" className="text-primary underline">NVIDIA Open Model License</a>. Downloading does not start the microphone.
            </p>
            {flow.error && <p className="text-sm text-destructive mb-4 font-medium">{flow.error}</p>}
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
                Download & Install
              </button>
            </div>
          </>
        )}
        {flow.status === 'unsupported' && <button onClick={onCancelMode} className="text-sm text-primary underline">Return to manual reading</button>}
      </div>
    );
  }

  if (flow.status === 'downloading') {
    const percent = Math.min(100, Math.max(0, Math.round((flow.progress || 0) * 100)));
    const mb = flow.totalBytes ? (flow.totalBytes / 1024 / 1024).toFixed(1) + " MB" : "";

    return (
      <div className="absolute inset-x-0 bottom-24 max-w-md mx-auto bg-card border border-border rounded-xl p-5 shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4">
        <h3 className="font-bold text-sm mb-3 text-foreground">Downloading Model...</h3>
        <div role="progressbar" aria-label="Model download" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="w-full bg-secondary h-2.5 rounded-full overflow-hidden mb-3">
          <div className="bg-primary h-full transition-all duration-300" style={{ width: `${percent}%` }} />
        </div>
        <div className="flex justify-between items-center text-xs font-medium">
          <span className="text-muted-foreground">
            {percent}% {mb && `of ${mb}`}
            {flow.downloadMessage && ` - ${flow.downloadMessage}`}
          </span>
          <button 
            onClick={flow.cancelDownload} 
            className="text-destructive hover:underline"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (['ready', 'silence-stopped'].includes(flow.status)) {
    return (
      <div role="status" className="absolute inset-x-4 bottom-24 max-w-md mx-auto bg-card border border-border rounded-xl p-4 shadow-lg z-50 text-sm">
        <p className="font-medium mb-2">{flow.status === 'silence-stopped' ? 'Listening stopped after 30 seconds without speech.' : 'Local model ready. Start when you are ready to speak.'}</p>
        <p className="text-muted-foreground mb-3">Audio is processed in temporary memory on your Mac, never saved or uploaded. Another person reading matching words can move the script—pause when needed.</p>
        <button onClick={flow.start} className="px-3 py-2 bg-primary text-primary-foreground rounded font-medium">
          {flow.status === 'silence-stopped' ? 'Restart listening' : 'Start microphone'}
        </button>
      </div>
    );
  }
  return null;
}

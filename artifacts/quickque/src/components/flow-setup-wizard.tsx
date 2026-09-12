import { useState, useEffect } from 'react';
import { FlowState } from '@/hooks/use-local-flow';
import { openMicrophoneSettings } from '@/lib/desktop';
import { NativeErrorDetails } from '@/components/native-error-details';
import { isRecoverableOverrunCode } from '@/lib/flow/native-errors';
import { Mic, Download, ShieldCheck, CheckCircle2, AlertCircle, Loader2, Settings, X } from 'lucide-react';

interface FlowSetupWizardProps {
  flow: FlowState;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 'intro' | 'download' | 'microphone' | 'success';

export function FlowSetupWizard({ flow, onComplete, onCancel }: FlowSetupWizardProps) {
  const [step, setStep] = useState<Step>('intro');
  const [settingsError, setSettingsError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'download') {
      if (['ready', 'stopped', 'silence-stopped'].includes(flow.status)) {
        setStep('microphone');
      }
    } else if (step === 'microphone') {
      if (flow.status === 'listening') {
        setStep('success');
      }
    }
  }, [step, flow.status]);

  const handleIntroContinue = () => {
    if (['needs-model', 'downloading', 'unsupported'].includes(flow.status)) {
      setStep('download');
    } else if (flow.status === 'listening') {
      setStep('success');
    } else {
      setStep('microphone');
    }
  };

  const isCheckingStatus = flow.status === 'loading' && !flow.error;
  const microphoneDenied = flow.error?.startsWith('[microphone_denied]') ?? false;
  const microphoneUnavailable = flow.error?.startsWith('[microphone_unavailable]') ?? false;
  const shouldRetryListening = isRecoverableOverrunCode(flow.errorCode) ||
    ['audio_input', 'engine_start', 'permission_start', 'transcription'].includes(flow.errorCode || '');
  const handleOpenSettings = async () => {
    setSettingsError(null);
    try {
      await openMicrophoneSettings();
    } catch {
      setSettingsError('Could not open System Settings. Open Privacy & Security → Microphone manually.');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300" role="dialog" aria-label="Voice Follow setup" onKeyDown={event => event.stopPropagation()}>
      <div className="bg-card w-full max-w-xl max-h-[calc(100dvh-2rem)] rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/30">
          <h2 className="font-semibold text-sm text-foreground uppercase tracking-wider">Voice Follow Setup</h2>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Cancel Setup"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto min-h-0">
          {step === 'intro' && (
            <div className="flex flex-col items-center text-center space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Private by Design</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Voice Follow listens to you speak and automatically scrolls the script.
                  It uses Apple’s SpeechAnalyzer and SpeechTranscriber, running <strong>entirely on your Mac</strong>.
                  Quickque Voice Follow requires macOS Tahoe 26 or later on Apple Silicon.
                </p>
              </div>
              <div className="text-sm text-muted-foreground bg-muted/30 border border-border/50 p-4 rounded-xl w-full text-left space-y-3">
                <p className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  No audio is ever recorded or saved.
                </p>
                <p className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  No data is uploaded to the cloud.
                </p>
                <p className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  Works completely offline after setup.
                </p>
              </div>
              <div className="w-full pt-2">
                <button
                  onClick={handleIntroContinue}
                  disabled={isCheckingStatus}
                  className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm disabled:cursor-wait disabled:opacity-60"
                >
                  {isCheckingStatus ? 'Checking local setup…' : 'Continue'}
                </button>
                {isCheckingStatus && flow.downloadMessage && <p className="mt-2 text-xs text-muted-foreground">{flow.downloadMessage}</p>}
                {flow.error && (
                  <>
                    <p role="alert" className="mt-2 text-xs text-destructive">{flow.error}</p>
                    {flow.errorDetails && (
                      <NativeErrorDetails details={flow.errorDetails} onClear={flow.clearErrorDetails} />
                    )}
                    <button
                      type="button"
                      onClick={() => flow.start()}
                      className="mt-2 px-3 py-1.5 bg-secondary text-secondary-foreground text-xs font-medium rounded hover:bg-secondary/80"
                    >
                      Retry listening
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {step === 'download' && (
            <div className="flex flex-col items-center text-center space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <Download className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Apple language assets</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Apple manages the on-device speech language assets. If they are missing,
                  download them explicitly before listening; there is no cloud fallback.
                </p>
              </div>

              <div className="w-full pt-2 min-h-[120px] flex flex-col justify-center">
                {flow.status === 'unsupported' ? (
                  <div className="p-4 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 flex flex-col gap-3 text-left">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <p className="text-sm font-medium leading-relaxed">{flow.downloadMessage || "Voice Follow runs in the installed Quickque app on macOS Tahoe 26 or later on Apple Silicon. This browser preview supports manual reading only."}</p>
                    </div>
                  </div>
                ) : flow.status === 'needs-model' ? (
                  <button
                    onClick={() => flow.download()}
                    className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    Download language assets
                  </button>
                ) : flow.status === 'downloading' ? (
                  <div className="w-full space-y-3 bg-muted/30 p-4 rounded-xl border border-border/50">
                    <div className="flex justify-between text-sm font-medium text-foreground">
                      <span>{flow.downloadMessage || 'Downloading…'}</span>
                      <span>{flow.progress === null ? "Waiting…" : `${Math.round(flow.progress * 100)}%`}</span>
                    </div>
                    <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                      <div
                        className={`bg-primary h-full transition-all duration-300 ease-out${flow.progress === null ? " animate-pulse" : ""}`}
                        style={{ width: flow.progress === null ? "35%" : `${Math.max(0, Math.min(100, flow.progress * 100))}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-xs font-medium text-muted-foreground">
                      <span>Apple-managed assets</span>
                      <button onClick={() => flow.cancelDownload()} className="text-destructive hover:text-destructive/80 hover:underline transition-colors">
                        Stop waiting
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Apple may finish a requested download in the background.</p>
                  </div>
                ) : flow.error ? (
                  <div className="p-4 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 flex flex-col gap-4 text-left">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <p className="text-sm font-medium">{flow.error}</p>
                    </div>
                     {flow.errorDetails && (
                       <NativeErrorDetails details={flow.errorDetails} onClear={flow.clearErrorDetails} />
                     )}
                    <button
                      onClick={() => shouldRetryListening ? flow.start() : flow.download()}
                      className="self-end px-4 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-lg hover:bg-destructive/90 transition-colors shadow-sm"
                    >
                      {shouldRetryListening ? 'Retry listening' : 'Retry asset download'}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 text-primary font-medium py-4">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span className="text-sm">Preparing Apple on-device speech…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'microphone' && (
            <div className="flex flex-col items-center text-center space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <Mic className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">Microphone Access</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Quickque needs to use your microphone to hear you read. Your Mac may prompt you to grant permission.
                </p>
              </div>

              <div className="w-full pt-2 min-h-[80px] flex flex-col justify-center">
                {flow.error && flow.status !== 'downloading' && flow.status !== 'needs-model' ? (
                  <div className="p-4 bg-destructive/10 text-destructive rounded-xl border border-destructive/20 flex flex-col gap-4 text-left mb-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="space-y-1.5">
                        <p className="text-sm font-medium">{flow.error}</p>
                        <p className="text-xs text-foreground/70">
                          {microphoneDenied
                            ? 'Enable Quickque, return here, then try again.'
                            : microphoneUnavailable
                              ? 'Connect or select a microphone in macOS Sound settings, then try again.'
                              : 'Stop other apps that may be using the microphone, then retry.'}
                        </p>
                      </div>
                    </div>
                     {flow.errorDetails && (
                       <NativeErrorDetails details={flow.errorDetails} onClear={flow.clearErrorDetails} />
                     )}
                    <div className="flex justify-end gap-2">
                      {(microphoneDenied || microphoneUnavailable) && (
                        <button
                          onClick={() => void handleOpenSettings()}
                          className="inline-flex items-center gap-1.5 px-3 py-2 border border-destructive/30 bg-background text-foreground text-sm font-medium rounded-lg hover:bg-accent transition-colors"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          Open Settings
                        </button>
                      )}
                      <button
                        onClick={() => flow.start()}
                        className="px-4 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-lg hover:bg-destructive/90 transition-colors shadow-sm"
                      >
                        {isRecoverableOverrunCode(flow.errorCode) ? 'Retry listening' : 'Retry Microphone'}
                      </button>
                    </div>
                    {settingsError && (
                      <p role="alert" className="text-xs text-foreground/80">{settingsError}</p>
                    )}
                  </div>
                ) : flow.status === 'loading' ? (
                  <div className="w-full py-2.5 bg-secondary text-secondary-foreground font-semibold rounded-lg flex items-center justify-center gap-2 opacity-80 cursor-not-allowed border border-border/50">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Preparing Apple speech…</span>
                  </div>
                ) : (
                  <button
                    onClick={() => flow.start()}
                    className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                  >
                    Start Microphone
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center text-center space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
              <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold mb-2">You are set</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Voice Follow is active. Read naturally from the script, and the prompter will follow your words.
                </p>
              </div>
              <div className="text-sm text-muted-foreground bg-muted/30 border border-border/50 p-4 rounded-xl w-full text-left space-y-2.5">
                <p className="flex gap-2"><span className="text-foreground font-bold shrink-0 mt-[1px]">•</span> Speak clearly to guide the prompter.</p>
                <p className="flex gap-2"><span className="text-foreground font-bold shrink-0 mt-[1px]">•</span> Pause reading, and the prompter pauses.</p>
                <p className="flex gap-2"><span className="text-foreground font-bold shrink-0 mt-[1px]">•</span> After 30 seconds of silence, listening stops automatically.</p>
              </div>
              <div className="w-full pt-2">
                <button
                  onClick={onComplete}
                  className="w-full py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                >
                  Finish Setup
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

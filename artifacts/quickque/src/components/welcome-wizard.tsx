import { useState, useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { useLocation } from 'wouter';
import { isDesktop } from '@/lib/desktop';
import { FlowSetupWizard } from '@/components/flow-setup-wizard';
import { useLocalFlow } from '@/hooks/use-local-flow';
import { tokenize } from '@/lib/flow/tokenize';
import { BrandMark } from '@/components/brand-mark';
import { ChatterboxSetup } from '@/components/chatterbox-setup';
import {
  Play,
  FolderOpen, Mic, BookOpen, Keyboard, X, Volume2,
  CheckCircle2, Loader2, AlertCircle
} from 'lucide-react';

export function WelcomeWizard() {
  const store = useStore();
  const profile = store.profile || { name: '', onboardingComplete: false };
  const { updateProfile, libraryDirectory, chooseLibraryDirectory, scripts, createScript, setActiveScriptId } = store;

  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile.name || '');
  const [showVoiceSetup, setShowVoiceSetup] = useState(false);
  const [, setLocation] = useLocation();

  const [folderLoading, setFolderLoading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.onboardingComplete) {
      setIsOpen(true);
      setStep(0);
    }
  }, [profile.onboardingComplete]);

  useEffect(() => {
    const handleOpen = () => {
      setIsOpen(true);
      setStep(0);
      setName(store.profile?.name || '');
    };
    window.addEventListener('quickque:welcome', handleOpen);
    return () => window.removeEventListener('quickque:welcome', handleOpen);
  }, [store.profile]);

  const setupTokens = useMemo(() => {
    let globalIdx = 0;
    return tokenize("Testing microphone permissions for Quickque Voice Follow.").map(t => ({
      ...t,
      sectionIdx: 0,
      globalTokenIdx: globalIdx++
    }));
  }, []);

  const setupFlow = useLocalFlow({ tokens: setupTokens, enabled: showVoiceSetup });

  if (!isOpen) return null;

  const handleFinish = () => {
    if (!name.trim() || (isDesktop() && !libraryDirectory)) {
      setStep(!name.trim() ? 0 : 1);
      return false;
    }
    if (!updateProfile({ onboardingComplete: true, name: name.trim() })) {
      setProfileError('Your setup could not be saved. Please try again.');
      return false;
    }
    setIsOpen(false);
    return true;
  };

  const handleReadWalkthrough = () => {
    if (!handleFinish()) return;
    const seedScript = scripts.find((s) => s.id === 'seed-1');
    if (seedScript) {
      setActiveScriptId(seedScript.id);
      setLocation(`/read/${seedScript.id}`);
    }
  };

  const handleCreateFirst = () => {
    if (!handleFinish()) return;
    createScript();
    setLocation('/');
  };

  const handleNotNow = () => {
    // Dismissing never marks unfinished name/folder setup complete.
    setIsOpen(false);
  };

  const handleChooseFolder = async () => {
    try {
      setFolderLoading(true);
      setFolderError(null);
      await chooseLibraryDirectory();
    } catch (err) {
      setFolderError(err instanceof Error ? err.message : 'Failed to choose folder');
    } finally {
      setFolderLoading(false);
    }
  };

  const canGoNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1 && isDesktop()) return !!libraryDirectory && !folderLoading && !folderError;
    return true;
  };

  const steps = [
    { id: 'intro', title: 'Welcome' },
    { id: 'storage', title: 'Storage' },
    { id: 'voice', title: 'Voice Follow' },
    { id: 'chatterbox', title: 'Chatterbox Turbo' },
    { id: 'tour', title: 'Controls' },
    { id: 'finish', title: 'Finish' }
  ];

  const nextStep = () => {
    if (!canGoNext()) return;
    if (step === 0 && !updateProfile({ name: name.trim() })) {
      setProfileError('Your name could not be saved. Please try again.');
      return;
    }
    setProfileError(null);
    setStep(s => s + 1);
  };

  return (
    <>
      {!showVoiceSetup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300" role="dialog" aria-label="Welcome setup guide" onKeyDown={event => event.stopPropagation()}>
          <div className="bg-card w-full max-w-lg max-h-[calc(100dvh-2rem)] rounded-2xl shadow-2xl border border-border overflow-y-auto flex flex-col relative">
            <button
              onClick={handleNotNow}
              className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-secondary/50 transition-colors"
              title="Set up later"
              aria-label="Close welcome guide"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-8 pb-6">
              {step === 0 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                  <div className="w-20 h-20 bg-white border border-border rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4">
                    <BrandMark className="w-12 h-10" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">Welcome to Quickque</h3>
                    <p className="text-muted-foreground text-sm">The intelligent teleprompter for creators. Let's get you set up.</p>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="welcome-name-input" className="text-sm font-medium text-foreground">What should we call you?</label>
                    <input
                      id="welcome-name-input"
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') nextStep();
                      }}
                      className="w-full bg-background border border-border rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-2 focus:ring-primary/50 transition-shadow"
                      placeholder="Your name"
                      maxLength={80}
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                  <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                    <FolderOpen className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">Where to save?</h3>
                    {isDesktop() ? (
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        Choose a folder on your Mac. Quickque saves your scripts together in a local JSON library file, with a backup of the previous save. No audio or transcripts are saved.
                      </p>
                    ) : (
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        Your scripts are saved in this browser. Choosing a local folder is available in the desktop app.
                      </p>
                    )}
                  </div>

                  {isDesktop() ? (
                    <div className="bg-muted/30 border border-border rounded-xl p-5 flex flex-col items-center gap-4">
                      <div className="text-sm font-medium text-foreground text-center break-all">
                        {libraryDirectory || 'No folder selected'}
                      </div>

                      <button
                        onClick={handleChooseFolder}
                        disabled={folderLoading}
                        className="px-5 py-2.5 bg-secondary text-secondary-foreground font-semibold rounded-lg hover:bg-secondary/80 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {folderLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Choose Folder...
                      </button>

                      {folderError && (
                        <div className="text-destructive text-sm flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          <span>{folderError}</span>
                        </div>
                      )}
                      {libraryDirectory && <p role="status" className="text-xs text-muted-foreground">{store.localSaveStatus}</p>}
                    </div>
                  ) : (
                    <div className="bg-primary/5 text-primary text-sm p-5 rounded-xl border border-primary/20 text-center leading-relaxed">
                       Clearing browser data may remove your scripts. Use Settings → Export Backup to keep a copy, or choose a folder in the macOS app.
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                  <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                    <Mic className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">Voice Follow</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      Quickque can automatically scroll the prompter as you speak, using Apple’s on-device SpeechAnalyzer and SpeechTranscriber on macOS Tahoe 26 or later with Apple Silicon. Speech stays on your Mac with no cloud fallback.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 pt-2">
                    <button
                      onClick={() => setShowVoiceSetup(true)}
                      className="w-full py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      {isDesktop() ? 'Set up Voice Follow' : 'View desktop setup requirements'}
                    </button>
                    <button
                      onClick={() => setStep(3)}
                      className="w-full py-3 bg-secondary text-secondary-foreground font-medium rounded-lg hover:bg-secondary/80 transition-colors"
                    >
                      Skip for now
                    </button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                  <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                    <Volume2 className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">Chatterbox Turbo</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      Chatterbox gives Scene Partner characters a free local AI voice. It is separate from Voice Follow, which listens to your microphone to scroll the prompter.
                    </p>
                  </div>
                  <ChatterboxSetup />
                  <button
                    type="button"
                    onClick={() => setStep(4)}
                    className="w-full py-3 bg-secondary text-secondary-foreground font-medium rounded-lg hover:bg-secondary/80 transition-colors"
                  >
                    {isDesktop() ? 'Skip for now' : 'Continue in browser'}
                  </button>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                  <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
                    <Keyboard className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">Controls</h3>
                    <p className="text-muted-foreground text-sm">Quickly navigate the prompter using your keyboard.</p>
                  </div>

                  <div className="bg-muted/30 border border-border rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">Play / Pause</span>
                      <kbd className="font-mono bg-background px-2.5 py-1 rounded-md border border-border shadow-sm text-sm font-semibold">Space</kbd>
                    </div>
                   <p className="text-sm text-muted-foreground leading-relaxed">
                     Click <strong>Present</strong> to open a script. Use the reader toolbar to choose Manual or Voice Follow, adjust text size and speed, or enable the desktop compact overlay. The subtle <strong>DEBUG</strong> toggle stays in the bottom-left corner.
                   </p>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">Next Section</span>
                      <kbd className="font-mono bg-background px-2.5 py-1 rounded-md border border-border shadow-sm text-sm font-semibold">Right ➔</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">Previous Section</span>
                      <kbd className="font-mono bg-background px-2.5 py-1 rounded-md border border-border shadow-sm text-sm font-semibold">Left ⬅</kbd>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">Exit Reader</span>
                      <kbd className="font-mono bg-background px-2.5 py-1 rounded-md border border-border shadow-sm text-sm font-semibold">Esc</kbd>
                    </div>
                  </div>
                </div>
              )}

              {step === 5 && (
                <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300">
                  <div className="w-16 h-16 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">You're all set, {name}!</h3>
                    <p className="text-muted-foreground text-sm">Your Quickque workspace is ready.</p>
                  </div>

                  <div className="flex flex-col gap-3 pt-4">
                    {scripts.some(script => script.id === 'seed-1') && <button
                      onClick={handleReadWalkthrough}
                      className="w-full py-3 flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      Try Welcome Walkthrough
                    </button>}
                    <button
                      onClick={handleCreateFirst}
                      className="w-full py-3 flex items-center justify-center gap-2 bg-secondary text-secondary-foreground font-medium rounded-lg hover:bg-secondary/80 transition-colors"
                    >
                      <BookOpen className="w-4 h-4" />
                      {scripts.some(script => script.id !== 'seed-1') ? 'Create a New Script' : 'Create My First Script'}
                    </button>
                    <button onClick={() => { if (handleFinish()) setLocation('/'); }} className="py-2 text-sm text-muted-foreground hover:text-foreground">
                      Go to my library
                    </button>
                  </div>
                </div>
              )}
            </div>
            {profileError && <p role="alert" className="px-6 pb-3 text-sm text-destructive">{profileError}</p>}

            {step < 5 && (
              <div className="p-6 pt-0 flex items-center justify-between mt-auto">
                <div className="flex gap-1.5">
                  {steps.map((s, i) => (
                    <div key={s.id} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary/40' : 'w-1.5 bg-border'}`} />
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  {step > 0 && (
                    <button
                      onClick={() => setStep(s => s - 1)}
                      className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Back
                    </button>
                  )}
                  {step !== 2 && step !== 3 && (
                    <button
                      onClick={nextStep}
                      disabled={!canGoNext()}
                      className="px-6 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                    >
                      Next
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showVoiceSetup && (
        <FlowSetupWizard
          flow={setupFlow}
          onComplete={() => {
            try {
              localStorage.setItem('quickque-flow-setup-done', 'true');
            } catch {
              setProfileError('Voice Follow worked, but its setup preference could not be saved.');
            }
            setShowVoiceSetup(false);
            setupFlow.stop();
            setStep(3);
          }}
          onCancel={() => {
            setShowVoiceSetup(false);
            setupFlow.stop();
          }}
        />
      )}
    </>
  );
}

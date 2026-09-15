import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Loader2, Play, RefreshCw, Users, Volume2 } from 'lucide-react';
import { Link } from 'wouter';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createVoiceLibrary, type ClonedVoice } from '@/lib/voice-library';
import { createSceneSpeech, voiceFailureMessage } from '@/lib/scene-speech';
import { audioRequest } from '@/lib/script-audio-model';
import { currentAudioReadiness } from '@/lib/script-audio';
import {
  getScriptFingerprint,
  getScriptReadiness,
  getSetupSteps,
  getDeliverySuggestions,
  clearSetupCheckpoint,
  loadSetupCheckpoint,
  saveSetupCheckpoint,
  type ReadinessOptions,
  type SetupStep,
} from '@/lib/script-readiness';
import type { ActorCharacter, CharacterRoleAssignment, Script } from '@/lib/types';
import { getScriptPurpose } from '@/lib/script-purpose';

const labels: Record<SetupStep, string> = {
  'add-script': 'Add script',
  'review-script-and-cast': 'Review script and cast',
  'choose-your-role': 'Choose your role',
  'set-up-partners': 'Set up partners',
  'prepare-and-test': 'Prepare and test',
  ready: 'Ready',
};

export function ScriptSetupWizard({
  script,
  onChange,
  onClose,
  onReady,
  voiceFollowSelected = false,
  microphoneReady = false,
  onOpenCastSetup,
}: {
  script: Script;
  onChange: (updates: Partial<Script>) => boolean;
  onClose: () => void;
  onReady?: () => void;
  voiceFollowSelected?: boolean;
  microphoneReady?: boolean;
  onOpenCastSetup?: () => void;
}) {
  const voiceLibrary = useMemo(() => createVoiceLibrary(), []);
  const checkpoint = loadSetupCheckpoint(script.id, script);
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [mode, setMode] = useState<'partner-audio' | 'practice-without-partner-audio'>(
    checkpoint?.mode ?? (script.actor?.enabled ? 'partner-audio' : 'practice-without-partner-audio'),
  );
  const steps = useMemo(() => getSetupSteps(getScriptPurpose(script)), [script]);
  const [stepIndex, setStepIndex] = useState(() => {
    const saved = checkpoint?.currentStep;
    const index = steps.indexOf(saved ?? getScriptReadiness(script).currentStep);
    return index >= 0 ? index : 0;
  });
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const activeStep = steps[stepIndex] ?? 'ready';
  const speech = useRef(createSceneSpeech());
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const refreshVoices = async () => {
    setLoadingVoices(true);
    setVoiceError(null);
    try {
      setVoices(await voiceLibrary.list());
    } catch (reason) {
      setVoiceError(voiceFailureMessage(reason));
      setVoices([]);
    } finally {
      if (mounted.current) setLoadingVoices(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refreshVoices();
    return () => {
      mounted.current = false;
      void speech.current.stop().catch(() => {});
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const refreshAudio = async () => {
      try {
        const request = await audioRequest(script);
        const result = await currentAudioReadiness(request);
        if (!cancelled) setAudioReady(result.status === 'ready');
      } catch {
        if (!cancelled) setAudioReady(false);
      }
    };
    void refreshAudio();
    return () => { cancelled = true; };
  }, [script]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [activeStep, Boolean(error)]);

  const usedCharacters = useMemo(() => {
    const ids = new Set(script.sections.map(section => section.characterId).filter(Boolean));
    return (script.actor?.characters ?? []).filter(character => ids.has(character.id));
  }, [script.sections, script.actor?.characters]);
  const options: ReadinessOptions = {
    availableVoices: voices.map(voice => ({ referenceId: voice.referenceId, revision: voice.revision })),
    audioReady: usedCharacters.some(character => script.actor?.roleAssignments?.[character.id] === 'computer-partner')
      ? audioReady : true,
    microphoneReady,
    voiceFollowSelected,
    mode,
  };
  const readiness = getScriptReadiness(script, options);
  const deliverySuggestions = useMemo(() => getDeliverySuggestions(script), [script]);
  const stepIssues = readiness.issues.filter(issue => issue.step === activeStep);
  const persistCheckpoint = (nextStep: SetupStep = activeStep) => {
    saveSetupCheckpoint({
      scriptId: script.id,
      scriptFingerprint: getScriptFingerprint(script),
      currentStep: nextStep,
      completedSteps: readiness.completedSteps,
      mode,
      roleAssignments: script.actor?.roleAssignments ?? {},
    });
  };

  const updateActor = (character: ActorCharacter, assignment: CharacterRoleAssignment) => {
    if (!script.actor) return;
    const roleAssignments = { ...(script.actor.roleAssignments ?? {}), [character.id]: assignment };
    const myRoleIds = assignment === 'my-role'
      ? [...new Set([...script.actor.myRoleIds.filter(id => id !== character.id), character.id])]
      : script.actor.myRoleIds.filter(id => id !== character.id);
    onChange({ actor: { ...script.actor, roleAssignments, myRoleIds } });
    setError(null);
  };

  const setPartnerVoice = (character: ActorCharacter, voiceId: string) => {
    const voice = voices.find(item => item.referenceId === voiceId);
    if (!script.actor) return;
    onChange({
      actor: {
        ...script.actor,
        characters: script.actor.characters.map(item => item.id === character.id ? {
          ...item,
          voice: { ...item.voice, engine: 'turbo', voiceId, voiceRevision: voice?.revision },
        } : item),
      },
    });
    setError(null);
  };

  const previewVoice = async (character: ActorCharacter) => {
    if (!character.voice.voiceId) {
      setError(`${character.name}: choose a voice before previewing it.`);
      return;
    }
    await speech.current.stop().catch(() => {});
    if (previewing === character.id) {
      setPreviewing(null);
      return;
    }
    setPreviewing(character.id);
    try {
      await speech.current.speak(
        'This is a preview of the selected local voice.',
        { engine: 'turbo', voiceId: character.voice.voiceId, rate: character.voice.rate, voiceRevision: character.voice.voiceRevision },
        new AbortController().signal,
      );
    } catch (reason) {
      if (mounted.current) setError(voiceFailureMessage(reason));
    } finally {
      if (mounted.current) setPreviewing(null);
    }
  };

  const checkAudio = async () => {
    setError(null);
    try {
      const request = await audioRequest(script);
      const result = await currentAudioReadiness(request);
      setAudioReady(result.status === 'ready');
      if (result.status !== 'ready') setError('Partner audio is not prepared for this script yet. Prepare it in the editor, then check again.');
    } catch (reason) {
      setAudioReady(false);
      setError(reason instanceof Error ? reason.message : 'Could not check local partner audio.');
    }
  };

  const close = () => {
    persistCheckpoint();
    onClose();
  };
  const next = () => {
    if (activeStep === 'prepare-and-test' && readiness.issues.length) {
      setError(readiness.issues[0]?.message ?? 'Finish preparation before continuing.');
      return;
    }
    const nextIncomplete = steps.findIndex((step, index) =>
      index > stepIndex && (step === 'ready' || !readiness.completedSteps.includes(step)),
    );
    const nextIndex = nextIncomplete >= 0 ? nextIncomplete : steps.length - 1;
    persistCheckpoint(steps[nextIndex]);
    setStepIndex(nextIndex);
  };
  const complete = () => {
    if (!readiness.ready) {
      const first = readiness.issues[0];
      const index = first ? steps.indexOf(first.step) : stepIndex;
      setStepIndex(Math.max(0, index));
      setError(first?.message ?? 'Complete setup before rehearsing.');
      return;
    }
    clearSetupCheckpoint(script.id);
    onReady?.();
  };

  return (
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="flex max-h-[min(760px,92vh)] w-[min(680px,calc(100vw-24px))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>Set up {script.title || 'your script'}</DialogTitle>
          <DialogDescription>Save and leave at any step. Quickque keeps this setup checkpoint on this device.</DialogDescription>
          <ol aria-label="Performance setup progress" className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {steps.map((step, index) => <li key={step} aria-current={step === activeStep ? 'step' : undefined} className={`border-t-2 pt-1 text-[11px] ${index <= stepIndex ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}><span className="mr-1">{index + 1}.</span>{labels[step]}</li>)}
          </ol>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {activeStep === 'add-script' && <div className="space-y-4">
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Add your script</h2>
            <p className="text-sm text-muted-foreground">Your script is saved locally. Return to the editor to add a title or dialogue if anything is missing.</p>
            <div className="rounded-lg border border-border p-4 text-sm"><strong>{script.sections.length}</strong> {script.sections.length === 1 ? 'section' : 'sections'} · <strong>{script.sections.filter(section => section.content.trim()).length}</strong> with dialogue</div>
          </div>}
          {activeStep === 'review-script-and-cast' && <div className="space-y-4">
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Review script and cast</h2>
            <p className="text-sm text-muted-foreground">Check the imported turns and confirm that every used character is present. Nothing is silently assigned.</p>
            <div className="rounded-lg border border-border p-4 text-sm"><strong>{usedCharacters.length}</strong> used {usedCharacters.length === 1 ? 'character' : 'characters'} · <strong>{script.sections.length}</strong> turns</div>
            {readiness.issues.some(issue => issue.code === 'cast-empty') && onOpenCastSetup && <button type="button" onClick={() => { close(); onOpenCastSetup(); }} className="rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10">Open cast setup</button>}
            <p className="text-xs text-muted-foreground">Need to change dialogue, notes, or cast? Close this guide and edit the script; your checkpoint will remain.</p>
          </div>}
          {activeStep === 'choose-your-role' && <div className="space-y-4">
            <div><h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Choose your role</h2><p className="mt-1 text-sm text-muted-foreground">Confirm one responsibility for every character used in this script.</p></div>
            <div className="space-y-3">
              {usedCharacters.map(character => {
                const assignment = script.actor?.roleAssignments?.[character.id];
                return <div key={character.id} className="rounded-lg border border-border p-3" role="group" aria-label={`Who performs ${character.name}?`}>
                  <div className="mb-2 flex items-center justify-between gap-2"><strong>{character.name}</strong>{assignment && <span className="text-xs text-emerald-600"><Check className="mr-1 inline h-3.5 w-3.5" />Confirmed</span>}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {([['my-role', 'My role'], ['another-person', 'Another person'], ['computer-partner', 'Computer partner']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={assignment === value} onClick={() => updateActor(character, value)} className={`rounded-md border px-2 py-2 text-xs font-medium ${assignment === value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}>{label}</button>)}
                  </div>
                </div>;
              })}
            </div>
          </div>}
          {activeStep === 'set-up-partners' && <div className="space-y-4">
            <div><h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Set up partners</h2><p className="mt-1 text-sm text-muted-foreground">Choose a local voice for each computer partner. Another person does not need a voice.</p></div>
            <div className="space-y-3">{readiness.computerPartners.map(character => <div key={character.id} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /><strong>{character.name}</strong><span className="ml-auto text-xs text-muted-foreground">Computer partner</span></div>
              <div className="flex gap-2"><select aria-label={`Voice for ${character.name}`} value={character.voice.voiceId} onChange={event => setPartnerVoice(character, event.target.value)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-sm" disabled={loadingVoices || !voices.length}>
                <option value="">{loadingVoices ? 'Loading local voices…' : voices.length ? 'Choose a local voice…' : 'No local voices found'}</option>
                {voices.map(voice => <option key={voice.referenceId} value={voice.referenceId}>{voice.name} · revision {voice.revision}</option>)}
              </select><button type="button" aria-label={`Preview voice for ${character.name}`} onClick={() => void previewVoice(character)} className="rounded-md border border-border px-3 text-primary hover:bg-muted"><Play className={`h-4 w-4 ${previewing === character.id ? 'animate-pulse' : ''}`} /></button></div>
              <div className="mt-2 flex items-center justify-between text-xs"><span className="text-muted-foreground">{character.voice.voiceId ? `Selected: ${character.voice.voiceId}` : 'Needs your choice'}</span><Link href="/voices" onClick={close} className="text-primary hover:underline">Change or create voice</Link></div>
              {deliverySuggestions.filter(suggestion => suggestion.characterId === character.id).map(suggestion => <div key={`${character.id}-${suggestion.sourceExcerpt}`} className="mt-3 rounded-md border border-border/70 bg-muted/30 p-2 text-xs"><strong>Suggested delivery</strong>{suggestion.tags.length ? ` · ${suggestion.tags.join(', ')}` : ''}<span className="mt-1 block italic text-muted-foreground">Source note: “{suggestion.sourceExcerpt}”</span><span className="mt-1 block text-muted-foreground">{suggestion.explanation}</span></div>)}
            </div>)}</div>
            {voiceError && <p role="alert" className="text-sm text-destructive">{voiceError}</p>}
            <button type="button" onClick={() => void refreshVoices()} disabled={loadingVoices} className="inline-flex items-center gap-2 text-xs text-primary hover:underline"><RefreshCw className={`h-3.5 w-3.5 ${loadingVoices ? 'animate-spin' : ''}`} />Refresh local voices</button>
          </div>}
          {activeStep === 'prepare-and-test' && <div className="space-y-4">
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Prepare and test</h2>
            <p className="text-sm text-muted-foreground">Readiness is checked again each time you start. Deleted or changed local assets reopen this step.</p>
            <div className="rounded-lg border border-border p-4">
              <label className="flex items-start gap-3"><input type="radio" name="setup-mode" checked={mode === 'partner-audio'} onChange={() => { setMode('partner-audio'); onChange({ actor: script.actor ? { ...script.actor, enabled: true } : undefined }); }} /><span><strong>Use partner audio</strong><span className="block text-xs text-muted-foreground">Computer partners speak with prepared local audio.</span></span></label>
              <label className="mt-3 flex items-start gap-3"><input type="radio" name="setup-mode" checked={mode === 'practice-without-partner-audio'} onChange={() => { setMode('practice-without-partner-audio'); onChange({ actor: script.actor ? { ...script.actor, enabled: false } : undefined }); }} /><span><strong>Practise without partner audio</strong><span className="block text-xs text-muted-foreground">Human roles can rehearse without generated partner audio.</span></span></label>
            </div>
            {mode === 'partner-audio' && readiness.computerPartners.length > 0 && <button type="button" onClick={() => void checkAudio()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"><Volume2 className="h-4 w-4" />Check prepared partner audio</button>}
            {voiceFollowSelected && <p className="text-sm text-amber-600">Voice Follow microphone setup is required only when Voice Follow is selected.</p>}
          </div>}
          {activeStep === 'ready' && <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"><Check className="h-6 w-6" /></div>
            <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold outline-none">Ready for your first rehearsal</h2>
            <p className="text-sm text-muted-foreground">Your choices are saved. Quickque will check local voices and audio again when you start.</p>
          </div>}
          {stepIssues.map(issue => <p key={`${issue.code}-${issue.characterId ?? issue.sectionId ?? ''}`} role="alert" className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{issue.message}</p>)}
          {error && <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button type="button" onClick={close} className="text-sm text-muted-foreground hover:text-foreground">Save and leave</button>
          <div className="flex items-center gap-2">
            <button type="button" disabled={stepIndex === 0} onClick={() => { setStepIndex(index => Math.max(0, index - 1)); setError(null); }} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"><ChevronLeft className="h-4 w-4" />Back</button>
            {stepIndex < steps.length - 1 ? <button type="button" onClick={next} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">Continue<ChevronRight className="h-4 w-4" /></button> : <button type="button" onClick={complete} className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground">{readiness.ready ? 'Ready' : 'Complete setup'}<Check className="h-4 w-4" /></button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChatterboxSetup } from './chatterbox-setup';
import { VoiceLibraryPanel } from './voice-library';
import { FlowDebugPanel } from './flow-debug-panel';
import { createSceneSpeech, voiceFailureMessage } from '@/lib/scene-speech';
import { isDesktop } from '@/lib/desktop';

export function AudioSetup({ referencedVoiceIds = [] }: { referencedVoiceIds?: string[] }) {
  const [installed, setInstalled] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'playing' | 'heard' | 'verified'>('idle');
  const [error, setError] = useState<string | null>(null);
  const speech = useMemo(() => createSceneSpeech(), []);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); void speech.stop().catch(() => {}); }; }, [speech]);
  const test = async () => {
    const active = new AbortController(); controller.current = active;
    setTestState('playing'); setError(null);
    try {
      await speech.speak('Welcome to Quickque. If you can hear this, your local voice is working.', { engine: 'turbo', voiceId: 'chatterbox-turbo:default-en', rate: 1 }, active.signal);
      if (mounted.current && !active.signal.aborted) setTestState('heard');
    } catch (reason) {
      if (mounted.current && !active.signal.aborted) { setError(voiceFailureMessage(reason)); setTestState('idle'); }
    }
  };
  return <div className="space-y-4" data-testid="audio-setup">
    <p className="text-sm text-muted-foreground">AI voices read scripts aloud and speak Scene Partner lines. Setup is optional; manual reading works without it.</p>
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="font-semibold">1. Download the voice model</h3>
      <ChatterboxSetup onInstalledChange={setInstalled} />
    </section>
    {isDesktop() && <>
      <section className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="font-semibold">2. Check that you can hear speech</h3>
        <p className="text-sm text-muted-foreground">Use the default voice first. The first test loads the model and can take a while. Check your Mac’s output volume.</p>
        {!installed && <p className="text-xs text-muted-foreground">Available after the model download finishes.</p>}
        <button type="button" disabled={!installed || testState === 'playing'} onClick={() => void test()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{testState === 'playing' ? 'Preparing and playing test…' : 'Test AI voice'}</button>
        {testState === 'playing' && <button type="button" className="ml-3 text-sm text-primary" onClick={() => { controller.current?.abort(); setTestState('idle'); }}>Stop test</button>}
        {testState === 'heard' && <div role="status" className="space-y-2 text-sm"><p>The test finished. Did you hear the spoken sentence?</p><button type="button" className="rounded-md border border-border px-3 py-2" onClick={() => setTestState('verified')}>Yes, I heard it</button><button type="button" className="ml-3 text-primary" onClick={() => { setTestState('idle'); setError('Check the selected sound output and volume in macOS, then run the test again.'); }}>I didn’t hear anything</button></div>}
        {testState === 'verified' && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Speech and audio output checked. Your AI voice is ready to use.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <details><summary className="cursor-pointer text-xs text-muted-foreground">Troubleshooting & audio trace</summary><div className="mt-2"><FlowDebugPanel /></div></details>
      </section>
      <details className="rounded-xl border border-border p-4">
        <summary className="cursor-pointer font-semibold">3. Add your own voice <span className="font-normal text-muted-foreground">· Optional</span></summary>
        <p className="my-3 text-sm text-muted-foreground">Record 6–10 seconds, listen to the sample, then save it. Use “Verify saved sample” to check the file on disk. Choose the saved voice in your script’s narrator or character settings.</p>
        <VoiceLibraryPanel referencedVoiceIds={referencedVoiceIds} />
      </details>
      <p className="text-xs text-muted-foreground">Voice recordings and generated audio stay in this Mac’s app storage. Script backups do not include them.</p>
    </>}
  </div>;
}

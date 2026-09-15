import { useLicence } from '@/lib/licence';
import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { isDesktop } from '@/lib/desktop';
import { getScriptPurpose } from '@/lib/script-purpose';
import { audioRequest, scriptAudioEntries } from '@/lib/script-audio-model';
import { AUDIO_CHANGED, currentAudioReadiness } from '@/lib/script-audio';
import type { Script } from '@/lib/types';

/** Observes committed library state, never the editor's uncommitted Markdown draft. */
export function SavedScriptAudio() {
  const { scripts } = useStore();
  const licence = useLicence();
  const latest = useRef(scripts);
  latest.current = scripts;
  useEffect(() => {
    if (!isDesktop() || !licence.loaded) return;
    const timer = setTimeout(() => {
      void Promise.all(latest.current
        .filter(script => getScriptPurpose(script) === 'performance' && scriptAudioEntries(script).length)
        .map(async script => {
          try { await currentAudioReadiness(await audioRequest(script)); } catch { /* Entry surfaces own actionable status. */ }
        }))
        .finally(() => window.dispatchEvent(new Event(AUDIO_CHANGED)));
    }, 1500);
    return () => clearTimeout(timer);
  }, [scripts, licence.loaded, licence.licensed]);
  return null;
}

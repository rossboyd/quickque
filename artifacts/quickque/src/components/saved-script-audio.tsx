import { useLicence } from '@/lib/licence';
import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';
import { isDesktop } from '@/lib/desktop';
import { getScriptPurpose } from '@/lib/script-purpose';
import { audioRequest, scriptAudioEntries } from '@/lib/script-audio-model';
import { AUDIO_CHANGED, audioEntitlement, audioStatus, generateAudio } from '@/lib/script-audio';
import type { Script } from '@/lib/types';

/** Observes committed library state, never the editor's uncommitted Markdown draft. */
export function SavedScriptAudio() {
  const { scripts } = useStore();
  const licence = useLicence();
  const latest = useRef(scripts);
  latest.current = scripts;
  const seen = useRef(new Map<string, string>());
  const queue = useRef(new Map<string, Script>());
  const working = useRef(false);
  useEffect(() => { seen.current.clear(); }, [licence.licensed]);
  useEffect(() => {
    if (!isDesktop() || !licence.loaded) return;
    const timer = setTimeout(() => {
      for (const script of latest.current) {
        if (getScriptPurpose(script) !== 'performance') continue;
        const signature = JSON.stringify(scriptAudioEntries(script));
        if (seen.current.get(script.id) === signature) continue;
        seen.current.set(script.id, signature);
        queue.current.set(script.id, script);
      }
      const drain = async () => {
        if (working.current) return;
        working.current = true;
        try {
          while (queue.current.size) {
            const [id] = queue.current.entries().next().value!;
            queue.current.delete(id);
            const script = latest.current.find(item => item.id === id);
            if (!script || getScriptPurpose(script) !== 'performance') continue;
            try {
              const access = await audioEntitlement();
              if (!(access.available ?? access.paid)) continue;
              const request = await audioRequest(script);
              if (request.entries.length && (await audioStatus(request)).status !== 'ready') await generateAudio(request);
            } catch {
              // Explicit generation in Edit remains available to retry. No live fallback.
              window.dispatchEvent(new Event(AUDIO_CHANGED));
            }
          }
        } finally { working.current = false; }
      };
      void drain();
    }, 1500);
    return () => clearTimeout(timer);
  }, [scripts, licence.loaded, licence.licensed]);
  return null;
}

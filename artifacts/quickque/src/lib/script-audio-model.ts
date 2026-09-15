import type { Script } from './types.ts';
import { getScriptPurpose } from './script-purpose.ts';
import { isComputerPartner } from './script-readiness.ts';

export const DEFAULT_AUDIO_VOICE = 'chatterbox-turbo:default-en';
export type AudioEntry = {
  id: string;
  text: string;
  voiceId: string;
  rate: number;
  /** Stable recording revision; omitted for the bundled Turbo default. */
  voiceRevision?: number;
};
export type AudioRequest = { scriptId: string; revision: string; entries: AudioEntry[] };

/** Titles, stage directions, notes and in-person lines never enter the TTS model. */
export function scriptAudioEntries(script: Script): AudioEntry[] {
  const performance = getScriptPurpose(script) === 'performance';
  if (performance && !script.actor?.enabled) return [];
  const narrator = script.narratorVoice?.engine === 'turbo' &&
    script.narratorVoice.voiceId
    ? script.narratorVoice
    : null;
  return script.sections.flatMap(section => {
    if (!section.content.trim()) return [];
    if (!performance) {
      return [{
        id: section.id,
        text: section.content,
        voiceId: narrator?.voiceId ?? DEFAULT_AUDIO_VOICE,
        rate: narrator?.rate ?? 1,
        ...(narrator?.voiceRevision === undefined ? {} : { voiceRevision: narrator.voiceRevision }),
      }];
    }
    const character = script.actor?.characters.find(item => item.id === section.characterId);
    if (!character || !isComputerPartner(script.actor!, character.id) || character.voice.engine !== 'turbo') return [];
    return [{
      id: section.id,
      text: section.content,
      voiceId: character.voice.voiceId,
      rate: character.voice.rate,
      ...(character.voice.voiceRevision === undefined ? {} : { voiceRevision: character.voice.voiceRevision }),
    }];
  });
}

export async function audioRequest(script: Script): Promise<AudioRequest> {
  const entries = scriptAudioEntries(script);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)));
  const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { scriptId: script.id, revision, entries };
}

export function audioEntryIdentity(
  text: string,
  voiceId: string,
  rate: number,
  voiceRevision?: number,
): string {
  return JSON.stringify([text, voiceId, rate, voiceRevision ?? null]);
}

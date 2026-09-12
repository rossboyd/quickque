import type { Script } from './types.ts';
import { getScriptPurpose } from './script-purpose.ts';

export const DEFAULT_AUDIO_VOICE = 'chatterbox-turbo:default-en';
export type AudioEntry = { id: string; text: string; voiceId: string; rate: number };
export type AudioRequest = { scriptId: string; revision: string; entries: AudioEntry[] };

/** Titles, stage directions, notes and in-person lines never enter the TTS model. */
export function scriptAudioEntries(script: Script): AudioEntry[] {
  const performance = getScriptPurpose(script) === 'performance';
  if (performance && !script.actor?.enabled) return [];
  return script.sections.flatMap(section => {
    if (!section.content.trim()) return [];
    if (!performance) return [{ id: section.id, text: section.content, voiceId: DEFAULT_AUDIO_VOICE, rate: 1 }];
    const character = script.actor?.characters.find(item => item.id === section.characterId);
    if (!character || script.actor!.myRoleIds.includes(character.id) || character.voice.engine !== 'turbo') return [];
    return [{ id: section.id, text: section.content, voiceId: character.voice.voiceId, rate: character.voice.rate }];
  });
}

export async function audioRequest(script: Script): Promise<AudioRequest> {
  const entries = scriptAudioEntries(script);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entries)));
  const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { scriptId: script.id, revision, entries };
}

export function audioEntryIdentity(text: string, voiceId: string, rate: number): string {
  return JSON.stringify([text, voiceId, rate]);
}

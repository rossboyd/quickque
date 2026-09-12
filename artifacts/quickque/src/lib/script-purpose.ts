import type { Script, ScriptPurpose } from './types.ts';

/** Legacy scene scripts retain their intent; new saves keep an explicit purpose. */
export function getScriptPurpose(script: Pick<Script, 'purpose' | 'actor'>): ScriptPurpose {
  return script.purpose ?? (script.actor?.enabled ? 'performance' : 'presentation');
}

export function isValidScriptPurpose(value: unknown): boolean {
  return value === undefined || value === 'presentation' || value === 'performance';
}

export type SceneSetupIssue = { message: string; sectionId?: string; characterId?: string; focusDialogue?: boolean };

/** Available IDs are supplied only after local voice discovery has completed. */
export function getSceneSetupIssues(script: Script, availableVoiceIds?: ReadonlySet<string>): SceneSetupIssue[] {
  if (getScriptPurpose(script) !== 'performance' || !script.actor?.enabled) return [];
  const issues: SceneSetupIssue[] = [];
  const actor = script.actor;
  const assigned = new Set<string>();
  if (!actor.characters.length) issues.push({ message: 'Add your cast in Scene Partner setup.' });
  if (!script.sections.length) issues.push({ message: 'Add a dialogue turn before rehearsing.' });
  script.sections.forEach((section, index) => {
    const character = actor.characters.find(c => c.id === section.characterId);
    if (!character) issues.push({ sectionId: section.id, message: `Turn ${index + 1}: assign a character.` });
    else assigned.add(character.id);
    if (!section.content.trim()) issues.push({ sectionId: section.id, focusDialogue: true, message: `Turn ${index + 1}: add dialogue or remove the empty turn.` });
  });
  actor.characters.forEach(character => {
    if (!assigned.has(character.id) || actor.myRoleIds.includes(character.id)) return;
    if (character.voice.engine !== 'system' || !character.voice.voiceId ||
      (availableVoiceIds && !availableVoiceIds.has(character.voice.voiceId))) {
      issues.push({ characterId: character.id, message: `${character.name}: choose an available local voice in Scene Partner setup.` });
    }
  });
  return issues;
}

export function getPerformanceSummary(script: Script): string {
  const actor = script.actor;
  const names = actor?.characters.filter(c => actor.myRoleIds.includes(c.id)).map(c => c.name) ?? [];
  return `${names.length ? `Your role: ${names.join(', ')}` : 'Full read-through'} · ${script.sections.length} turns`;
}

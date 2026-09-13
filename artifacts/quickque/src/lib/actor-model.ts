import type { ActorCharacter, ActorMode, ActorVoice, Script, ScriptSection } from './types.ts';
import { getScriptPurpose } from './script-purpose.ts';
import { isCharacterColor } from './actor-colors.ts';
import { generateId } from './utils.ts';
import { normalizePresentation } from './presentation-preferences.ts';

/**
 * Actor metadata is deliberately bounded independently of the dialogue body.
 * These limits keep a malformed export from turning a cast description into a
 * storage or rendering denial of service while leaving useful room for
 * free-form descriptions.
 */
export const MAX_ACTOR_CHARACTERS = 100;
export const MAX_ACTOR_ID_LENGTH = 200;
export const MAX_ACTOR_NAME_LENGTH = 200;
export const MAX_ACTOR_AGE_LENGTH = 200;
export const MAX_ACTOR_GENDER_LENGTH = 200;
export const MAX_ACTOR_STYLE_LENGTH = 500;
export const MAX_ACTOR_VOICE_ID_LENGTH = 200;
export const MAX_ACTOR_ROLES = 100;
export const MAX_SECTION_NOTES_LENGTH = 500_000;
// Browser/macOS system speech exposes the useful, portable 0.5–2 range.
export const MIN_ACTOR_VOICE_RATE = 0.5;
export const MAX_ACTOR_VOICE_RATE = 2;
export const MISSING_CLONED_VOICE_PREFIX = 'local-voice-missing:';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cloneVoiceData(voice: ActorVoice): ActorVoice {
  return {
    engine: voice.engine,
    voiceId: voice.voiceId,
    rate: voice.rate,
    ...(voice.voiceRevision === undefined ? {} : { voiceRevision: voice.voiceRevision }),
  };
}

/**
 * System voice IDs from pre-cloned-voice releases cannot be replayed on
 * another Mac. Keep their identity visible as a missing local reference
 * instead of silently selecting Turbo Default or another installed voice.
 */
export function migrateLegacyVoice(voice: ActorVoice): ActorVoice {
  if (voice.engine !== 'system') return cloneVoiceData(voice);
  const legacyId = voice.voiceId.trim() || 'unknown';
  return {
    engine: 'turbo',
    voiceId: `${MISSING_CLONED_VOICE_PREFIX}${legacyId}`,
    rate: voice.rate,
    voiceRevision: 1,
  };
}

export function migrateActorVoices(actor: ActorMode): ActorMode {
  return {
    enabled: actor.enabled,
    characters: actor.characters.map(character => ({
      ...character,
      voice: migrateLegacyVoice(character.voice),
    })),
    myRoleIds: [...actor.myRoleIds],
  };
}

function isBoundedString(value: unknown, maximum: number, nonEmpty = false): value is string {
  return typeof value === 'string' &&
    value.length <= maximum &&
    (!nonEmpty || value.trim().length > 0);
}

function isBoundedId(value: unknown): value is string {
  return isBoundedString(value, MAX_ACTOR_ID_LENGTH, true);
}

export function isValidActorVoice(value: unknown): value is ActorVoice {
  if (!isRecord(value)) return false;
  return (
    (value.engine === 'system' || value.engine === 'turbo') &&
    isBoundedString(value.voiceId, MAX_ACTOR_VOICE_ID_LENGTH) &&
    typeof value.rate === 'number' &&
    Number.isFinite(value.rate) &&
    value.rate >= MIN_ACTOR_VOICE_RATE &&
    value.rate <= MAX_ACTOR_VOICE_RATE &&
    (value.voiceRevision === undefined ||
      (typeof value.voiceRevision === 'number' &&
        Number.isSafeInteger(value.voiceRevision) &&
        value.voiceRevision > 0))
  );
}

export function isValidActorCharacter(value: unknown): value is ActorCharacter {
  if (!isRecord(value)) return false;
  return (
    isBoundedId(value.id) &&
    isBoundedString(value.name, MAX_ACTOR_NAME_LENGTH, true) &&
    (value.accentColor === undefined || isCharacterColor(value.accentColor)) &&
    isBoundedString(value.age, MAX_ACTOR_AGE_LENGTH) &&
    isBoundedString(value.gender, MAX_ACTOR_GENDER_LENGTH) &&
    isBoundedString(value.style, MAX_ACTOR_STYLE_LENGTH) &&
    isValidActorVoice(value.voice)
  );
}

/**
 * Validates the cast and selected roles. Section assignments are validated
 * separately because an old/native document can contain an assignment to a
 * character that was later removed. Such an assignment is treated as
 * unassigned by the reader rather than guessed into a different role.
 */
export function isValidActor(value: unknown): value is ActorMode {
  if (!isRecord(value) || typeof value.enabled !== 'boolean') return false;
  if (!Array.isArray(value.characters) || value.characters.length > MAX_ACTOR_CHARACTERS) {
    return false;
  }
  if (!Array.isArray(value.myRoleIds) || value.myRoleIds.length > MAX_ACTOR_ROLES) {
    return false;
  }

  const characterIds = new Set<string>();
  for (const character of value.characters) {
    if (!isValidActorCharacter(character) || characterIds.has(character.id)) return false;
    characterIds.add(character.id);
  }

  const roleIds = new Set<string>();
  return value.myRoleIds.every(roleId => (
    isBoundedId(roleId) &&
    !roleIds.has(roleId) &&
    characterIds.has(roleId) &&
    (roleIds.add(roleId), true)
  ));
}

export function cloneActor(actor: ActorMode): ActorMode {
  return {
    enabled: actor.enabled,
    characters: actor.characters.map(character => ({
      id: character.id,
      name: character.name,
      ...(character.accentColor !== undefined ? { accentColor: character.accentColor } : {}),
      age: character.age,
      gender: character.gender,
      style: character.style,
      voice: cloneVoiceData(character.voice),
    })),
    myRoleIds: [...actor.myRoleIds],
  };
}

function freshCharacterId(
  usedIds: Set<string>,
  idFactory: () => string,
): string | null {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = idFactory();
    if (isBoundedId(id) && !usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  return null;
}

/**
 * Deep-clones an actor configuration while assigning every character a new
 * script-scoped identity. Section assignments are remapped through the
 * returned map by cloneScriptWithRemappedActor.
 */
export function cloneActorWithFreshCharacterIds(
  actor: ActorMode,
  idFactory: () => string = generateId,
  reservedIds: ReadonlySet<string> = new Set<string>(),
): { actor: ActorMode; characterIdMap: Map<string, string> } | null {
  if (!isValidActor(actor)) return null;
  const usedIds = new Set<string>(reservedIds);
  const characterIdMap = new Map<string, string>();
  const characters: ActorCharacter[] = [];
  for (const character of actor.characters) {
    const id = freshCharacterId(usedIds, idFactory);
    if (!id) return null;
    characterIdMap.set(character.id, id);
    characters.push({
      id,
      name: character.name,
      ...(character.accentColor !== undefined ? { accentColor: character.accentColor } : {}),
      age: character.age,
      gender: character.gender,
      style: character.style,
      voice: cloneVoiceData(character.voice),
    });
  }
  return {
    actor: {
      enabled: actor.enabled,
      characters,
      myRoleIds: actor.myRoleIds
        .map(roleId => characterIdMap.get(roleId))
        .filter((roleId): roleId is string => Boolean(roleId)),
    },
    characterIdMap,
  };
}

/**
 * Remove a cast member without silently assigning their turns to somebody
 * else. The caller should apply unassignment to sections as well.
 */
export function deleteActorCharacter(
  actor: ActorMode,
  characterId: string,
): ActorMode {
  return {
    enabled: actor.enabled,
    characters: actor.characters
      .filter(character => character.id !== characterId)
      .map(character => ({
        id: character.id,
        name: character.name,
        ...(character.accentColor !== undefined ? { accentColor: character.accentColor } : {}),
        age: character.age,
        gender: character.gender,
        style: character.style,
        voice: cloneVoiceData(character.voice),
      })),
    myRoleIds: actor.myRoleIds.filter(roleId => roleId !== characterId),
  };
}

function cloneSectionData(section: ScriptSection): ScriptSection {
  const cloned: ScriptSection = {
    id: section.id,
    title: section.title,
    content: section.content,
  };
  if (section.notes !== undefined) cloned.notes = section.notes;
  if (section.characterId !== undefined) cloned.characterId = section.characterId;
  return cloned;
}

export function unassignDeletedCharacter(
  sections: ScriptSection[],
  characterId: string,
): ScriptSection[] {
  return sections.map(section => (
    section.characterId === characterId
      ? { ...cloneSectionData(section), characterId: null }
      : cloneSectionData(section)
  ));
}

/**
 * Clone only the persisted script schema. Imported JSON is structurally
 * validated before this helper runs, but explicit fields are still used here
 * so future audio/model blobs cannot hitch a ride through object spreads.
 */
export function cloneScriptData(script: Script): Script {
  const cloned: Script = {
    purpose: getScriptPurpose(script),
    id: script.id,
    title: script.title,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    sections: script.sections.map(cloneSectionData),
  };
  if (script.presentation) {
    cloned.presentation = normalizePresentation(script.presentation);
  }
  if (script.actor) {
    cloned.actor = isValidActor(script.actor)
      ? cloneActor(script.actor)
      : script.actor;
  }
  if (script.narratorVoice !== undefined) {
    cloned.narratorVoice = script.narratorVoice
      ? cloneVoiceData(script.narratorVoice)
      : null;
  }
  return cloned;
}

/**
 * Invalid/dangling assignments are retained as an explicit unassigned turn
 * rather than pointed at a different character. This is used when reading
 * older files and before writing new files.
 */
export function normalizeActorSectionReferences(
  actor: ActorMode | undefined,
  sections: ScriptSection[],
): ScriptSection[] {
  if (!actor || !Array.isArray(actor.characters)) {
    return sections.map(cloneSectionData);
  }
  const characterIds = new Set(actor.characters.map(character => character.id));
  return sections.map(section => {
    if (
      section.characterId === undefined ||
      section.characterId === null ||
      characterIds.has(section.characterId)
    ) {
      return cloneSectionData(section);
    }
    return { ...cloneSectionData(section), characterId: null };
  });
}

/**
 * Resolves a section assignment defensively. A dangling characterId is never
 * considered a speaking role, which keeps old/malformed documents visibly
 * unassigned until the user repairs them.
 */
export function getAssignedCharacter(
  script: Pick<Script, 'actor'>,
  section: Pick<ScriptSection, 'characterId'>,
): ActorCharacter | null {
  if (!script.actor || !isValidActor(script.actor)) return null;
  if (typeof section.characterId !== 'string') return null;
  return script.actor.characters.find(character => character.id === section.characterId) ?? null;
}

export function isAssignedToActor(
  script: Pick<Script, 'actor'>,
  section: Pick<ScriptSection, 'characterId'>,
  characterId: string,
): boolean {
  return getAssignedCharacter(script, section)?.id === characterId;
}

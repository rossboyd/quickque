import type {
  ActorCharacter,
  ActorMode,
  CharacterRoleAssignment,
  Script,
  ScriptPurpose,
} from './types.ts';
import { getScriptPurpose } from './script-purpose.ts';

/**
 * The setup contract is shared by the library, editor and reader. It is
 * intentionally data-only so a direct reader link cannot accidentally bypass
 * the same checks as the visible Rehearse button.
 */
export const SETUP_CHECKPOINTS_KEY = 'quickque_setup_checkpoints_v1';

export type SetupStep =
  | 'add-script'
  | 'review-script-and-cast'
  | 'choose-your-role'
  | 'set-up-partners'
  | 'prepare-and-test'
  | 'ready';

export type RehearsalMode = 'partner-audio' | 'practice-without-partner-audio';

export type SetupIssueCode =
  | 'script-empty'
  | 'cast-empty'
  | 'turn-unassigned'
  | 'role-unconfirmed'
  | 'voice-required'
  | 'voice-unavailable'
  | 'voice-outdated'
  | 'audio-not-ready'
  | 'microphone-required';

export type SetupIssue = {
  code: SetupIssueCode;
  message: string;
  characterId?: string;
  sectionId?: string;
  step: SetupStep;
};

export type LocalVoiceReference = {
  referenceId: string;
  revision?: number;
};

export type ReadinessOptions = {
  /** Pass the result of local voice discovery; absence is not a valid voice. */
  availableVoices?: ReadonlyArray<LocalVoiceReference | string>;
  audioReady?: boolean;
  microphoneReady?: boolean;
  voiceFollowSelected?: boolean;
  mode?: RehearsalMode;
};

export type RuntimeReadinessDependencies = {
  listLocalVoices: () => Promise<ReadonlyArray<LocalVoiceReference | string>>;
  checkPreparedAudio: () => Promise<boolean>;
};

export type ScriptReadiness = {
  purpose: ScriptPurpose;
  mode: RehearsalMode;
  steps: SetupStep[];
  completedSteps: SetupStep[];
  currentStep: SetupStep;
  ready: boolean;
  issues: SetupIssue[];
  usedCharacters: ActorCharacter[];
  computerPartners: ActorCharacter[];
};

export type SetupCheckpoint = {
  version: 1;
  scriptId: string;
  scriptFingerprint: string;
  currentStep: SetupStep;
  completedSteps: SetupStep[];
  mode: RehearsalMode;
  /** Only stable IDs are saved. Audio/recordings are deliberately excluded. */
  roleAssignments: Record<string, CharacterRoleAssignment>;
  updatedAt: number;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PERFORMANCE_STEPS: SetupStep[] = [
  'add-script',
  'review-script-and-cast',
  'choose-your-role',
  'set-up-partners',
  'prepare-and-test',
  'ready',
];
const PRESENTATION_STEPS: SetupStep[] = [
  'add-script',
  'review-script-and-cast',
  'prepare-and-test',
  'ready',
];
const STEP_ORDER: SetupStep[] = [...PERFORMANCE_STEPS];

function isRoleAssignment(value: unknown): value is CharacterRoleAssignment {
  return value === 'my-role' || value === 'another-person' || value === 'computer-partner';
}

function isSetupStep(value: unknown): value is SetupStep {
  return typeof value === 'string' && STEP_ORDER.includes(value as SetupStep);
}

function stableTextHash(value: string): string {
  // FNV-1a is sufficient here: this is a change marker, not a security hash.
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getScriptFingerprint(script: Pick<Script, 'id' | 'title' | 'purpose' | 'sections' | 'actor'>): string {
  const data = JSON.stringify({
    id: script.id,
    title: script.title,
    purpose: script.purpose,
    sections: script.sections.map(section => ({
      id: section.id,
      title: section.title,
      content: section.content,
      notes: section.notes ?? '',
      characterId: section.characterId ?? null,
    })),
    actor: script.actor ? {
      enabled: script.actor.enabled,
      characters: script.actor.characters.map(character => ({
        id: character.id,
        name: character.name,
        voice: character.voice,
      })),
      myRoleIds: script.actor.myRoleIds,
      roleAssignments: script.actor.roleAssignments ?? {},
    } : null,
  });
  return stableTextHash(data);
}

function usedCharacters(script: Script): ActorCharacter[] {
  const actor = script.actor;
  if (!actor) return [];
  const ids = new Set(script.sections.map(section => section.characterId).filter((id): id is string => Boolean(id)));
  return actor.characters.filter(character => ids.has(character.id));
}

function voiceById(
  voices: ReadonlyArray<LocalVoiceReference | string> | undefined,
): Map<string, number | undefined> {
  return new Map((voices ?? []).map(voice => typeof voice === 'string'
    ? [voice, undefined]
    : [voice.referenceId, voice.revision]));
}

function hasValidLocalVoice(character: ActorCharacter, voices: Map<string, number | undefined>): SetupIssueCode | null {
  if (character.voice.engine !== 'turbo' || !character.voice.voiceId) return 'voice-required';
  if (!voices.has(character.voice.voiceId)) return 'voice-unavailable';
  const localRevision = voices.get(character.voice.voiceId);
  if (localRevision !== undefined && localRevision !== character.voice.voiceRevision) return 'voice-outdated';
  return null;
}

function messageForVoiceIssue(character: ActorCharacter, code: SetupIssueCode): string {
  if (code === 'voice-outdated') return `${character.name}: this local voice changed. Review and select its current revision.`;
  if (code === 'voice-unavailable') return `${character.name}: the selected voice is not available on this device. Choose another local voice.`;
  return `${character.name}: choose a valid local voice for this computer partner.`;
}

function roleForCharacter(actor: ActorMode, id: string): CharacterRoleAssignment | undefined {
  // The explicit map is the only confirmation. myRoleIds is retained for old
  // libraries and display, but hidden legacy preselection never confirms setup.
  return actor.roleAssignments?.[id];
}

/** Role resolution is authoritative once the explicit map exists. */
export function isComputerPartner(actor: ActorMode, characterId: string): boolean {
  if (actor.roleAssignments) return actor.roleAssignments[characterId] === 'computer-partner';
  return !actor.myRoleIds.includes(characterId);
}

export function getHumanRoleIds(actor: ActorMode): string[] {
  return actor.characters
    .filter(character => !isComputerPartner(actor, character.id))
    .map(character => character.id);
}

export async function checkScriptReadiness(
  script: Script,
  dependencies: RuntimeReadinessDependencies,
  options: Omit<ReadinessOptions, 'availableVoices' | 'audioReady'> = {},
): Promise<ScriptReadiness> {
  const actor = script.actor;
  const computer = actor
    ? usedCharacters(script).some(character => isComputerPartner(actor, character.id))
    : false;
  const voices = computer ? await dependencies.listLocalVoices() : [];
  const audioReady = computer && actor?.enabled
    ? await dependencies.checkPreparedAudio()
    : true;
  return getScriptReadiness(script, { ...options, availableVoices: voices, audioReady });
}

export function getSetupSteps(purpose: ScriptPurpose): SetupStep[] {
  return purpose === 'performance' ? [...PERFORMANCE_STEPS] : [...PRESENTATION_STEPS];
}

export function getRoleAssignment(
  actor: Pick<ActorMode, 'roleAssignments'> | undefined,
  characterId: string,
): CharacterRoleAssignment | undefined {
  return actor?.roleAssignments?.[characterId];
}

export function getScriptReadiness(script: Script, options: ReadinessOptions = {}): ScriptReadiness {
  const purpose = getScriptPurpose(script);
  const mode = options.mode ?? (
    script.actor?.enabled ? 'partner-audio' : 'practice-without-partner-audio'
  );
  const steps = getSetupSteps(purpose);
  const issues: SetupIssue[] = [];
  const used = usedCharacters(script);
  const actor = script.actor;

  if (!script.title.trim() || !script.sections.length || script.sections.every(section => !section.content.trim())) {
    issues.push({ code: 'script-empty', message: 'Add a title and at least one line before continuing.', step: 'add-script' });
  }
  if (purpose === 'performance') {
    if (!actor || !actor.characters.length) {
      issues.push({ code: 'cast-empty', message: 'Add the characters used in this performance.', step: 'review-script-and-cast' });
    }
    script.sections.forEach(section => {
      if (!section.content.trim()) return;
      if (!section.characterId || !actor?.characters.some(character => character.id === section.characterId)) {
        issues.push({ code: 'turn-unassigned', message: `Assign a character to “${section.title || 'this turn'}”.`, sectionId: section.id, step: 'review-script-and-cast' });
      }
    });
    used.forEach(character => {
      if (!actor || !roleForCharacter(actor, character.id)) {
        issues.push({ code: 'role-unconfirmed', message: `${character.name}: confirm My role, Another person, or Computer partner.`, characterId: character.id, step: 'choose-your-role' });
      }
    });
  }

  const assignments = new Map(used.map(character => [character.id, actor ? roleForCharacter(actor, character.id) : undefined]));
  const computerPartners = used.filter(character =>
    assignments.get(character.id) === 'computer-partner',
  );
  if (purpose === 'performance' && mode === 'partner-audio') {
    const voices = voiceById(options.availableVoices);
    computerPartners.forEach(character => {
      const issueCode = hasValidLocalVoice(character, voices);
      if (issueCode) issues.push({
        code: issueCode,
        message: messageForVoiceIssue(character, issueCode),
        characterId: character.id,
        step: 'set-up-partners',
      });
    });
    if (computerPartners.length && options.audioReady !== true) {
      issues.push({ code: 'audio-not-ready', message: 'Prepare and test partner audio before rehearsal.', step: 'prepare-and-test' });
    }
  }
  if (options.voiceFollowSelected && options.microphoneReady !== true) {
    issues.push({ code: 'microphone-required', message: 'Allow microphone access to use Voice Follow, or turn Voice Follow off.', step: 'prepare-and-test' });
  }

  const completedSteps = steps.filter(step => !issues.some(issue => issue.step === step));
  const firstIncomplete = steps.find(step => !completedSteps.includes(step)) ?? 'ready';
  return {
    purpose,
    mode,
    steps,
    completedSteps,
    currentStep: firstIncomplete,
    ready: issues.length === 0,
    issues,
    usedCharacters: used,
    computerPartners,
  };
}

/** Short aliases for callers that do not need to repeat the model name. */
export const getReadiness = getScriptReadiness;
export const getCharacterRoleAssignment = getRoleAssignment;

function parseCheckpoint(value: unknown): SetupCheckpoint | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<SetupCheckpoint>;
  if (candidate.version !== 1 || typeof candidate.scriptId !== 'string' ||
      typeof candidate.scriptFingerprint !== 'string' || !isSetupStep(candidate.currentStep) ||
      !Array.isArray(candidate.completedSteps) || !candidate.completedSteps.every(isSetupStep) ||
      (candidate.mode !== 'partner-audio' && candidate.mode !== 'practice-without-partner-audio') ||
      !candidate.roleAssignments || typeof candidate.roleAssignments !== 'object' ||
      !Object.entries(candidate.roleAssignments).every(([id, assignment]) => id && isRoleAssignment(assignment)) ||
      typeof candidate.updatedAt !== 'number') return null;
  return {
    version: 1,
    scriptId: candidate.scriptId,
    scriptFingerprint: candidate.scriptFingerprint,
    currentStep: candidate.currentStep,
    completedSteps: [...new Set(candidate.completedSteps)],
    mode: candidate.mode,
    roleAssignments: { ...candidate.roleAssignments } as Record<string, CharacterRoleAssignment>,
    updatedAt: candidate.updatedAt,
  };
}

function checkpointStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSetupCheckpoint(
  scriptId: string,
  script?: Pick<Script, 'id' | 'title' | 'purpose' | 'sections' | 'actor'>,
  storage?: StorageLike,
): SetupCheckpoint | null {
  const target = checkpointStorage(storage);
  if (!target) return null;
  try {
    const all = JSON.parse(target.getItem(SETUP_CHECKPOINTS_KEY) ?? '{}') as Record<string, unknown>;
    const checkpoint = parseCheckpoint(all[scriptId]);
    if (!checkpoint || (script && checkpoint.scriptFingerprint !== getScriptFingerprint(script))) return null;
    return checkpoint;
  } catch {
    return null;
  }
}

export function saveSetupCheckpoint(
  checkpoint: Omit<SetupCheckpoint, 'version' | 'updatedAt'>,
  storage?: StorageLike,
): boolean {
  const target = checkpointStorage(storage);
  if (!target || !isSetupStep(checkpoint.currentStep)) return false;
  try {
    const all = JSON.parse(target.getItem(SETUP_CHECKPOINTS_KEY) ?? '{}') as Record<string, unknown>;
    all[checkpoint.scriptId] = { ...checkpoint, version: 1, updatedAt: Date.now() };
    target.setItem(SETUP_CHECKPOINTS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function clearSetupCheckpoint(scriptId: string, storage?: StorageLike): boolean {
  const target = checkpointStorage(storage);
  if (!target) return false;
  try {
    const all = JSON.parse(target.getItem(SETUP_CHECKPOINTS_KEY) ?? '{}') as Record<string, unknown>;
    delete all[scriptId];
    target.setItem(SETUP_CHECKPOINTS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function hasUnfinishedSetup(
  script: Pick<Script, 'id' | 'title' | 'purpose' | 'sections' | 'actor'>,
  storage?: StorageLike,
): boolean {
  return loadSetupCheckpoint(script.id, script, storage) !== null;
}

export type DeliverySuggestion = {
  characterId: string;
  characterName: string;
  tags: string[];
  sourceExcerpt: string;
  status: 'suggestion' | 'needs-your-choice';
  explanation: string;
};

const APPROVED_DELIVERY_TAGS = [
  'angry', 'calm', 'excited', 'frustrated', 'quiet', 'urgent', 'whispered',
  'sad', 'joyful', 'fearful', 'confident', 'slow', 'fast',
];

/**
 * Notes are evidence, not an emotion classifier. Suggestions quote the source
 * and never silently alter a voice or promise emotional synthesis.
 */
export function getDeliverySuggestions(script: Script): DeliverySuggestion[] {
  const actor = script.actor;
  if (!actor) return [];
  return script.sections.flatMap(section => {
    const note = section.notes?.trim() ?? '';
    if (!note || !section.characterId) return [];
    const character = actor.characters.find(item => item.id === section.characterId);
    if (!character) return [];
    const lowered = note.toLowerCase();
    const tags = APPROVED_DELIVERY_TAGS.filter(tag => new RegExp(`\\b${tag}\\b`, 'i').test(lowered));
    return [{
      characterId: character.id,
      characterName: character.name,
      tags,
      sourceExcerpt: note.length > 240 ? `${note.slice(0, 237)}…` : note,
      status: tags.length === 1 ? 'suggestion' : 'needs-your-choice',
      explanation: tags.length === 1
        ? 'Suggested from this direction; preview and approve it yourself.'
        : 'The direction is missing or ambiguous for a voice choice. Choose deliberately.',
    }];
  });
}

import type { ActorCharacter, ScriptPurpose, ScriptSection } from '../types.ts';
import { nextCharacterColor } from '../actor-colors.ts';

export type ImportProvenance = {
  fileName: string;
  format: 'txt' | 'md' | 'docx' | 'rtf' | 'pdf' | 'paste';
  originalText: string;
  warnings: string[];
};

export type ImportReviewIssue = {
  line: number;
  sectionId: string;
  message: string;
};

export type ImportReviewDraft = {
  title: string;
  purpose: ScriptPurpose;
  provenance: ImportProvenance;
  characters: ActorCharacter[];
  sections: ImportReviewSection[];
  issues: ImportReviewIssue[];
  structured: boolean;
};

export type ImportReviewSection = ScriptSection & {
  /** Exact cue syntax retained until review so a false cue can become dialogue. */
  sourceCue?: string;
  sourceCueHasInlineDialogue?: boolean;
};

const continuationSuffix = /\s*\((?:cont(?:inued)?|cont['’]?d)\)\s*$/i;
const continuationOnly = /^(?:\((?:cont(?:inued)?|cont['’]?d)\)|cont(?:inued)?|cont['’]?d)$/i;
const markdownCue = /^\*\*(.+?):\*\*(?:[ \t]+(.*))?$/;
const plainInlineCue = /^([A-Z][A-Z0-9 .,'’_()’-]{0,79}):(?:[ \t]+(.*))?$/;
const plainStandaloneCue = /^([A-Z][A-Z0-9 .,'’_()’-]{0,79})$/;
const sceneHeading = /^(?:INT\.|EXT\.|INT\/EXT\.|I\/E\.|ACT(?:\s|$)|SCENE(?:\s|$)|FADE(?:\s|$)|CUT TO:|TITLE:)/i;

function newCharacter(name: string, index: number): ActorCharacter {
  const existing = Array.from({ length: index }, (_, offset) => ({
    accentColor: undefined,
    id: String(offset),
    name: '',
    age: '',
    gender: '',
    style: '',
    voice: { engine: 'turbo' as const, voiceId: '', rate: 1 },
  }));
  return {
    id: `import-character-${index + 1}`,
    name,
    accentColor: nextCharacterColor(existing),
    age: '',
    gender: '',
    style: '',
    voice: { engine: 'turbo', voiceId: '', rate: 1 },
  };
}

function normalizeSpeaker(raw: string): { name: string; continuation: boolean; only: boolean } {
  const trimmed = raw.trim();
  if (continuationOnly.test(trimmed)) return { name: '', continuation: true, only: true };
  const withoutSuffix = trimmed.replace(continuationSuffix, '').trim();
  return { name: withoutSuffix, continuation: withoutSuffix !== trimmed, only: false };
}

export function createImportReviewDraft(input: {
  title: string;
  text: string;
  fileName: string;
  format: ImportProvenance['format'];
  warnings?: string[];
  purpose: ScriptPurpose;
}): ImportReviewDraft {
  const provenance = {
    fileName: input.fileName.slice(0, 200),
    format: input.format,
    originalText: input.text,
    warnings: [...(input.warnings ?? [])],
  };
  if (input.purpose === 'presentation') {
    return {
      title: input.title,
      purpose: input.purpose,
      provenance,
      characters: [],
      sections: [{ id: 'import-section-1', title: 'Section 1', content: input.text }],
      issues: [],
      structured: false,
    };
  }
  const characters: ActorCharacter[] = [];
  const sections: ImportReviewSection[] = [];
  const issues: ImportReviewIssue[] = [];
  const byName = new Map<string, ActorCharacter>();
  let lastSpeaker: ActorCharacter | null = null;
  let current: { character: ActorCharacter | null; body: string[]; notes: string[]; line: number; ambiguousContinuation: boolean; sourceCue: string; sourceCueHasInlineDialogue: boolean } | null = null;
  let pendingDirections: string[] = [];
  let sectionIndex = 0;
  let cueCount = 0;

  const characterFor = (raw: string): { character: ActorCharacter | null; ambiguous: boolean } => {
    const normalized = normalizeSpeaker(raw);
    if (normalized.only) {
      if (lastSpeaker) return { character: lastSpeaker, ambiguous: false };
      return { character: null, ambiguous: true };
    }
    if (!normalized.name) {
      return { character: null, ambiguous: true };
    }
    const key = normalized.name.toLocaleLowerCase();
    let character = byName.get(key);
    if (!character) {
      character = newCharacter(normalized.name, characters.length);
      characters.push(character);
      byName.set(key, character);
    }
    lastSpeaker = character;
    return { character, ambiguous: false };
  };
  const flush = () => {
    if (!current) return;
    sectionIndex += 1;
    const id = `import-section-${sectionIndex}`;
    sections.push({
      id,
      title: `Turn ${sectionIndex}`,
      content: current.body.join('\n'),
      ...(current.notes.length ? { notes: current.notes.join('\n') } : {}),
      ...(current.character ? { characterId: current.character.id } : { characterId: null }),
      sourceCue: current.sourceCue,
      sourceCueHasInlineDialogue: current.sourceCueHasInlineDialogue,
    });
    if (current.ambiguousContinuation) {
      issues.push({ line: current.line, sectionId: id, message: 'Choose who this continuation belongs to.' });
    }
    current = null;
  };
  const start = (
    result: { character: ActorCharacter | null; ambiguous: boolean },
    line: number,
    inline?: string,
    sourceCue = '',
  ) => {
    if (current &&
      !current.ambiguousContinuation &&
      !current.body.some(value => value.trim()) &&
      current.notes.length > 0
    ) {
      pendingDirections.push(...current.notes);
      current = null;
    } else {
      flush();
    }
    current = {
      character: result.character,
      body: inline === undefined ? [] : [inline],
      notes: pendingDirections,
      line,
      ambiguousContinuation: result.ambiguous,
      sourceCue,
      sourceCueHasInlineDialogue: inline !== undefined,
    };
    pendingDirections = [];
  };

  const lines = input.text.replace(/\r\n/g, '\n').split('\n');
  const allowPlainCues = true;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (allowPlainCues && sceneHeading.test(line.trim())) {
      const active = current as { character: ActorCharacter | null; body: string[]; notes: string[]; line: number; ambiguousContinuation: boolean; sourceCue: string; sourceCueHasInlineDialogue: boolean } | null;
      if (active?.body.some(value => value.trim())) flush();
      pendingDirections.push(line);
      continue;
    }
    const markdown = line.match(markdownCue);
    const inline = allowPlainCues ? line.match(plainInlineCue) : null;
    const standalone = allowPlainCues && index + 1 < lines.length && lines[index + 1].trim()
      ? line.match(plainStandaloneCue)
      : null;
    const cue = markdown ?? inline ?? standalone;
    if (cue) {
      cueCount += 1;
      start(characterFor(cue[1]), lineNumber, cue[2], line);
      continue;
    }
    const active = current as { character: ActorCharacter | null; body: string[]; notes: string[]; line: number; ambiguousContinuation: boolean; sourceCue: string; sourceCueHasInlineDialogue: boolean } | null;
    if (!active) {
      pendingDirections.push(line);
      continue;
    }
    if (/^#{1,2}(?:\s|$)/.test(line) && active.body.some(value => value.trim())) {
      flush();
      pendingDirections.push(line);
      continue;
    }
    if (/^\s*[\[(].+[\])]\s*$/.test(line) && active.body.some(value => value.trim())) {
      const previousCharacter = active.character;
      flush();
      current = {
        character: previousCharacter,
        body: [],
        notes: [line.trim()],
        line: lineNumber,
        ambiguousContinuation: false,
        sourceCue: '',
        sourceCueHasInlineDialogue: false,
      };
      continue;
    }
    if (line.startsWith('>')) {
      active.notes.push(line.slice(line.startsWith('> ') ? 2 : 1));
    } else if (/^\s*[\[(].+[\])]\s*$/.test(line) && active.body.length === 0) {
      active.notes.push(line.trim());
    } else {
      active.body.push(line);
    }
  }
  flush();
  if (cueCount > 0 && pendingDirections.some(line => line.trim())) {
    sectionIndex += 1;
    sections.push({
      id: `import-section-${sectionIndex}`,
      title: `Turn ${sectionIndex}`,
      content: '',
      notes: pendingDirections.join('\n'),
      characterId: null,
    });
  }

  const structured = cueCount > 0;
  if (!structured) {
    return {
      title: input.title,
      purpose: input.purpose,
      provenance,
      characters: [],
      sections: [{ id: 'import-section-1', title: 'Section 1', content: input.text }],
      issues: input.purpose === 'performance'
        ? [{ line: 1, sectionId: 'import-section-1', message: 'No reliable speaker cues were found. Assign the scene manually, or import it as a presentation.' }]
        : [],
      structured: false,
    };
  }
  return {
    title: input.title,
    purpose: input.purpose,
    provenance,
    characters,
    sections,
    issues,
    structured,
  };
}

export function assignImportTurn(
  draft: ImportReviewDraft,
  sectionId: string,
  characterId: string | null,
): ImportReviewDraft {
  return {
    ...draft,
    sections: draft.sections.map(section => section.id === sectionId
      ? { ...section, characterId }
      : section),
    issues: characterId === null
      ? draft.issues
      : draft.issues.filter(issue => issue.sectionId !== sectionId),
  };
}

export function mergeImportCharacter(
  draft: ImportReviewDraft,
  fromId: string,
  intoId: string,
): ImportReviewDraft {
  if (fromId === intoId) return draft;
  return {
    ...draft,
    characters: draft.characters.filter(character => character.id !== fromId),
    sections: draft.sections.map(section => section.characterId === fromId
      ? { ...section, characterId: intoId }
      : section),
  };
}

export function treatImportTurnAsDialogue(
  draft: ImportReviewDraft,
  sectionId: string,
): ImportReviewDraft {
  const original = draft.sections.find(section => section.id === sectionId);
  const oldCharacterId = original?.characterId;
  const sections = draft.sections.map(section => {
    if (section.id !== sectionId || !section.sourceCue) return section;
    return {
      ...section,
      content: [
        section.sourceCue,
        ...(section.sourceCueHasInlineDialogue
          ? section.content.split('\n').slice(1)
          : section.content ? [section.content] : []),
      ].filter(Boolean).join('\n'),
      characterId: null,
      sourceCue: undefined,
      sourceCueHasInlineDialogue: undefined,
    };
  });
  return {
    ...draft,
    sections,
    characters: oldCharacterId && !sections.some(section => section.characterId === oldCharacterId)
      ? draft.characters.filter(character => character.id !== oldCharacterId)
      : draft.characters,
    issues: draft.issues.filter(issue => issue.sectionId !== sectionId),
  };
}

export function treatImportTurnAsDirection(
  draft: ImportReviewDraft,
  sectionId: string,
): ImportReviewDraft {
  const original = draft.sections.find(section => section.id === sectionId);
  const oldCharacterId = original?.characterId;
  const sections = draft.sections.map(section => {
    if (section.id !== sectionId || !section.sourceCue) return section;
    const restored = [
      section.sourceCue,
      ...(section.sourceCueHasInlineDialogue
        ? section.content.split('\n').slice(1)
        : section.content ? [section.content] : []),
    ].filter(Boolean).join('\n');
    return {
      ...section,
      content: '',
      notes: [section.notes, restored].filter(Boolean).join('\n'),
      characterId: null,
      sourceCue: undefined,
      sourceCueHasInlineDialogue: undefined,
    };
  });
  return {
    ...draft,
    sections,
    characters: oldCharacterId && !sections.some(section => section.characterId === oldCharacterId)
      ? draft.characters.filter(character => character.id !== oldCharacterId)
      : draft.characters,
    issues: draft.issues.filter(issue => issue.sectionId !== sectionId),
  };
}

export function splitUnstructuredImport(draft: ImportReviewDraft): ImportReviewDraft {
  if (draft.structured) return draft;
  const parts = draft.provenance.originalText.split(/\n{2,}/);
  return {
    ...draft,
    structured: true,
    sections: parts.map((content, index) => ({
      id: `manual-section-${index + 1}`,
      title: `Turn ${index + 1}`,
      content,
      characterId: null,
    })),
    issues: [],
  };
}

export function acceptUnstructuredImport(draft: ImportReviewDraft): ImportReviewDraft {
  return { ...draft, structured: true, issues: [] };
}

export function validateImportReviewDraft(draft: ImportReviewDraft): string | null {
  if (draft.purpose === 'performance' && draft.issues.length > 0) {
    return 'Resolve every structural review item before saving this performance.';
  }
  if (draft.characters.some(character => !character.name.trim())) {
    return 'Every cast member needs a name.';
  }
  if (draft.purpose === 'performance' &&
    draft.sections.some(section => section.content.trim() && !section.characterId)
  ) {
    return 'Assign a speaker to every turn that contains dialogue.';
  }
  return null;
}
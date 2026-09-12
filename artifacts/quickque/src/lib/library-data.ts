import { isValidScriptPurpose } from './script-purpose.ts';
import type {
  PresentationPreferences,
  Script,
  ScriptSection,
} from './types';
import {
  cloneActor,
  cloneScriptData,
  isValidActor,
  MAX_ACTOR_ID_LENGTH,
  MAX_SECTION_NOTES_LENGTH,
  normalizeActorSectionReferences,
} from './actor-model.ts';
import {
  DEFAULT_PRESENTATION,
  normalizePresentation,
} from './presentation-preferences.ts';

/**
 * The first-run document is intentionally kept here, rather than in the
 * store's hydration code, so that every source of library data uses the same
 * shape and the first install can never grow another implicit seed.
 */
export function createWelcomeScript(
  now = Date.now(),
  presentation: PresentationPreferences = DEFAULT_PRESENTATION,
): Script {
  return {
    id: 'seed-1',
    purpose: 'presentation',
    title: 'Welcome to Quickque',
    createdAt: now,
    updatedAt: now,
    presentation: normalizePresentation(presentation),
    sections: [
      {
        id: 's1',
        title: 'Introduction',
        content: 'Welcome to Quickque. This is a personal teleprompter designed for live meetings.\n\nIt helps you stay on track while presenting, without feeling like you are reading a script.'
      },
      {
        id: 's2',
        title: 'Key Features',
        content: "If you need to pause for an interruption, just press the Space bar.\n\nYou won't lose your place. A clear marker shows exactly where you left off.\n\nUse the left and right arrow keys to jump between sections."
      },
      {
        id: 's3',
        title: 'Desktop Mode',
        content: 'If you are using the desktop app, you can enable compact overlay mode. This lets Quickque float above your other windows, like Zoom or Google Meet, with a transparent background.'
      }
    ]
  };
}

export function createInitialScripts(
  now = Date.now(),
  presentation: PresentationPreferences = DEFAULT_PRESENTATION,
): Script[] {
  return [createWelcomeScript(now, presentation)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isValidScriptSection(value: unknown): value is ScriptSection {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.title !== 'string' ||
    typeof value.content !== 'string'
  ) {
    return false;
  }
  if (
    value.notes !== undefined &&
    (typeof value.notes !== 'string' || value.notes.length > MAX_SECTION_NOTES_LENGTH)
  ) {
    return false;
  }
  if (
    value.characterId !== undefined &&
    value.characterId !== null &&
    (typeof value.characterId !== 'string' ||
      value.characterId.length === 0 ||
      value.characterId.length > MAX_ACTOR_ID_LENGTH)
  ) {
    return false;
  }
  return true;
}

export function isValidScript(value: unknown): value is Script {
  return (
    isRecord(value) &&
    isValidScriptPurpose(value.purpose) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.title === 'string' &&
    value.title.length > 0 &&
    Array.isArray(value.sections) &&
    value.sections.every(isValidScriptSection) &&
    (value.actor === undefined || isValidActor(value.actor)) &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  );
}

export function isValidScripts(value: unknown): value is Script[] {
  return Array.isArray(value) && value.every(isValidScript);
}

/**
 * Parses the on-disk/cache format. `null` is deliberate: callers must be
 * able to distinguish an invalid source from an empty, valid script array.
 */
function stampPresentation(
  scripts: Script[],
  fallback: PresentationPreferences,
): Script[] {
  return scripts.map(script => {
    const cloned = cloneScriptData(script);
    return {
      ...cloned,
      sections: normalizeActorSectionReferences(script.actor, cloned.sections),
      ...(script.actor ? { actor: cloneActor(script.actor) } : {}),
      presentation: normalizePresentation(script.presentation, fallback),
    };
  });
}

export function parseScriptsJson(
  json: unknown,
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
): Script[] | null {
  if (typeof json !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return isValidScripts(parsed)
      ? stampPresentation(parsed, presentationFallback)
      : null;
  } catch {
    return null;
  }
}

export type ImportableScriptSection = {
  id: string;
  title: string;
  content: string;
  notes?: string;
  characterId?: string | null;
};

export type ImportableScript = {
  purpose?: Script['purpose'];
  id: string;
  title: string;
  sections: ImportableScriptSection[];
  createdAt?: number;
  updatedAt?: number;
  actor?: Script['actor'];
};

/**
 * Imports are allowed to omit timestamps because older Quickque exports did
 * so. They are otherwise validated as strictly as native/cache data.
 */
export function isImportableScripts(value: unknown): value is ImportableScript[] {
  return (
    Array.isArray(value) &&
    value.every((script) => {
      if (!isRecord(script)) return false;
      if (
        !isValidScriptPurpose(script.purpose) ||
        typeof script.id !== 'string' ||
        script.id.length === 0 ||
        typeof script.title !== 'string' ||
        script.title.length === 0 ||
        !Array.isArray(script.sections) ||
        !script.sections.every(isValidScriptSection) ||
        (script.actor !== undefined && !isValidActor(script.actor))
      ) {
        return false;
      }
      return (
        (script.createdAt === undefined ||
          (typeof script.createdAt === 'number' && Number.isFinite(script.createdAt))) &&
        (script.updatedAt === undefined ||
          (typeof script.updatedAt === 'number' && Number.isFinite(script.updatedAt)))
      );
    })
  );
}

export function parseImportJson(
  json: unknown,
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
): ImportableScript[] | null {
  if (typeof json !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return isImportableScripts(parsed)
        ? stampPresentation(parsed as Script[], presentationFallback)
        : null;
    }
    if (
      !isRecord(parsed) ||
      parsed.format !== 'com.quickque.local-library' ||
      parsed.version !== 1 ||
      !Object.keys(parsed).every((key) =>
        key === 'format' || key === 'version' || key === 'scripts',
      ) ||
      !Object.prototype.hasOwnProperty.call(parsed, 'scripts')
    ) {
      return null;
    }
    return isImportableScripts(parsed.scripts)
      ? stampPresentation(parsed.scripts as Script[], presentationFallback)
      : null;
  } catch {
    return null;
  }
}

export type ScriptRecovery = {
  scripts: Script[];
  serialized: string;
};

/**
 * Recovery is stored as an envelope so a future cache format cannot be
 * mistaken for an unsaved edit. Invalid recovery is returned as null and is
 * never rewritten by this helper.
 */
export function parseRecoveryJson(
  json: unknown,
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
): ScriptRecovery | null {
  if (typeof json !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || typeof parsed.scriptsJson !== 'string') {
      return null;
    }
    const scripts = parseScriptsJson(parsed.scriptsJson, presentationFallback);
    return scripts
      ? { scripts, serialized: parsed.scriptsJson }
      : null;
  } catch {
    return null;
  }
}

export function serializeScripts(scripts: Script[]): string {
  return JSON.stringify(scripts);
}

export type NativeHydrationDecision = {
  scripts: Script[];
  source: 'native' | 'local';
  shouldSaveNative: boolean;
};

/**
 * Merges a valid native script payload into the latest browser snapshot.
 *
 * Native data is only authoritative when no browser mutation happened while
 * the native request was in flight. A browser edit wins otherwise. Existing
 * trash IDs are excluded from native data so an older native file cannot
 * resurrect a deleted script. Non-seed local scripts missing from native are
 * retained as a conservative merge for older native files.
 */
export function mergeNativeHydration(
  hydrationRevision: number,
  currentRevision: number,
  localScripts: Script[],
  nativeScripts: Script[] | null,
  trashedIds: ReadonlySet<string> = new Set<string>(),
  replaceableLocalIds: ReadonlySet<string> = new Set(['seed-1']),
): NativeHydrationDecision {
  if (currentRevision !== hydrationRevision || nativeScripts === null) {
    return {
      scripts: localScripts,
      source: 'local',
      shouldSaveNative: true,
    };
  }

  if (nativeScripts.length === 0) {
    return {
      scripts: [],
      source: 'native',
      shouldSaveNative: false,
    };
  }

  const acceptedNative: Script[] = [];
  const occupiedIds = new Set(trashedIds);

  for (const nativeScript of nativeScripts) {
    const identities = [
      nativeScript.id,
      ...nativeScript.sections.map(section => section.id),
    ];
    if (
      identities.some(identity => occupiedIds.has(identity)) ||
      new Set(identities).size !== identities.length
    ) {
      continue;
    }
    acceptedNative.push(nativeScript);
    identities.forEach(identity => occupiedIds.add(identity));
  }

  const mergedScripts = [
    ...acceptedNative,
    ...localScripts.filter((localScript) => {
      if (replaceableLocalIds.has(localScript.id)) return false;
      if (acceptedNative.some(nativeScript => nativeScript.id === localScript.id)) {
        return false;
      }
      const identities = [
        localScript.id,
        ...localScript.sections.map(section => section.id),
      ];
      return identities.every(identity => !occupiedIds.has(identity));
    }),
  ];

  return {
    scripts: mergedScripts,
    source: 'native',
    shouldSaveNative: false,
  };
}

/**
 * Resolves a delayed native load against edits made while the load was in
 * flight. The revision is incremented synchronously by the store before it
 * queues React state, so a native response cannot overwrite an edit that has
 * not rendered yet.
 */
export function resolveNativeHydration(
  hydrationRevision: number,
  currentRevision: number,
  latestLocalScripts: Script[],
  nativeScripts: Script[] | null,
): NativeHydrationDecision {
  if (currentRevision !== hydrationRevision || nativeScripts === null) {
    return {
      scripts: latestLocalScripts,
      source: 'local',
      shouldSaveNative: true,
    };
  }
  return {
    scripts: nativeScripts,
    source: 'native',
    shouldSaveNative: false,
  };
}

export function canWriteNativeLibrary(
  expectedDirectory: string,
  currentDirectory: string | null,
  expectedSession: number,
  currentSession: number,
  recoveryRequired: boolean,
  pickerOpen: boolean,
  nativeReady: boolean,
  autosaveBlocked: boolean,
): boolean {
  return (
    !recoveryRequired &&
    !pickerOpen &&
    nativeReady &&
    !autosaveBlocked &&
    expectedDirectory.length > 0 &&
    expectedDirectory === currentDirectory &&
    expectedSession === currentSession
  );
}

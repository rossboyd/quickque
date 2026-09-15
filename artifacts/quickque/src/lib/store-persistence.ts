import { isValidScriptPurpose } from './script-purpose.ts';
import type {
  DeletedScript,
  PresentationPreferences,
  Script,
  SortMode,
} from './types.ts';
import { generateId } from './utils.ts';
import {
  DEFAULT_PRESENTATION,
  isValidPresentation,
  normalizePresentation,
} from './presentation-preferences.ts';
import {
  cloneActor,
  cloneScriptData,
  isValidActor,
  isValidActorVoice,
  MAX_ACTOR_ID_LENGTH,
  MAX_SECTION_NOTES_LENGTH,
  normalizeActorSectionReferences,
  migrateActorVoices,
} from './actor-model.ts';

export const QUICKQUE_SCRIPTS_KEY = 'quickque_scripts';
export const QUICKQUE_ACTIVE_SCRIPT_KEY = 'quickque_active_script';
// v1 envelopes and pre-envelope arrays remain readable. New writes use v2 so
// older clients cannot silently overwrite trash/order metadata.
export const QUICKQUE_STORAGE_VERSION = 2 as const;
export const LEGACY_STORAGE_VERSION = 1 as const;

export const MAX_DOCUMENT_TITLE_LENGTH = 200;
export const MAX_DOCUMENT_TEXT_LENGTH = 500_000;
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_SCRIPTS = 10_000;
export const MAX_TRASH = 10_000;
export const MAX_SECTIONS = 500;
export const MAX_ID_LENGTH = 200;
export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 500_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LibraryMetadata = {
  trash: DeletedScript[];
  customOrder: string[];
  sortMode: SortMode;
};

export type LibraryEnvelope = {
  version: typeof QUICKQUE_STORAGE_VERSION;
  scripts: Script[];
  activeScriptId: string | null;
  // Optional makes this envelope source-compatible with the original v1
  // format. Newly persisted libraries always include all three fields.
  trash?: DeletedScript[];
  customOrder?: string[];
  sortMode?: SortMode;
};

export type LoadedLibrary = {
  ok: true;
  scripts: Script[];
  activeScriptId: string | null;
  trash: DeletedScript[];
  customOrder: string[];
  sortMode: SortMode;
  /** True when the value needs migration to the current v2 envelope. */
  needsMigration: boolean;
  /** True when quickque_scripts did not exist and the caller used its seed. */
  wasMissing: boolean;
} | {
  ok: false;
  error: string;
};

export type ParsedLibrary = {
  scripts: Script[];
  activeScriptId: string | null;
  trash: DeletedScript[];
  customOrder: string[];
  sortMode: SortMode;
};

export type DocumentImportResult =
  | { ok: true; script: Script }
  | { ok: false; error: string };

const MALFORMED_LIBRARY_ERROR =
  'Stored Quickque scripts are invalid. Your existing data was left untouched.';
const STORAGE_READ_ERROR =
  'Failed to load your scripts. Your existing data was left untouched.';
const STORAGE_WRITE_ERROR =
  'Could not save to this device. Your library and selection are unchanged. Free up browser storage or allow site storage, then retry; keep this review open to retain your text.';
const BACKUP_TOO_LARGE_ERROR =
  `This backup is too large. Backups must be ${MAX_BACKUP_BYTES} bytes or smaller.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isValidId(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_LENGTH) && value.trim().length > 0;
}

function isValidTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 8_640_000_000_000_000
  );
}

/**
 * Validate data loaded from localStorage before it is allowed into the
 * application. This deliberately accepts empty script titles because the
 * editor has always allowed users to clear a title.
 */
function isValidScriptFields(value: unknown): value is Omit<Script, 'presentation'> & {
  presentation?: unknown;
} {
  if (!isRecord(value)) return false;
  if (!isValidScriptPurpose(value.purpose)) return false;
  if (!isValidId(value.id)) return false;
  if (!isBoundedString(value.title, MAX_TITLE_LENGTH)) return false;
  if (value.actor !== undefined && !isValidActor(value.actor)) return false;
  if (value.narratorVoice !== undefined &&
    value.narratorVoice !== null &&
    !isValidActorVoice(value.narratorVoice)) return false;
  if (value.importSource !== undefined) {
    if (!isRecord(value.importSource) ||
      !isBoundedString(value.importSource.fileName, MAX_TITLE_LENGTH) ||
      !isBoundedString(value.importSource.originalText, MAX_DOCUMENT_TEXT_LENGTH) ||
      !['txt', 'md', 'docx', 'rtf', 'pdf', 'paste'].includes(value.importSource.format as string) ||
      !Array.isArray(value.importSource.warnings) ||
      value.importSource.warnings.length > 100 ||
      value.importSource.warnings.some(warning => !isBoundedString(warning, 2_000))) return false;
  }
  if (!isValidTimestamp(value.createdAt) || !isValidTimestamp(value.updatedAt)) {
    return false;
  }
  if (!Array.isArray(value.sections) || value.sections.length > MAX_SECTIONS) return false;

  const sectionIds = new Set<string>();
  return value.sections.every(section => {
    if (!isRecord(section)) return false;
    if (!isValidId(section.id)) return false;
    if (sectionIds.has(section.id)) return false;
    sectionIds.add(section.id);
    return (
      isBoundedString(section.title, MAX_TITLE_LENGTH) &&
      isBoundedString(section.content, MAX_CONTENT_LENGTH) &&
      (section.notes === undefined ||
        isBoundedString(section.notes, MAX_SECTION_NOTES_LENGTH)) &&
      (section.characterId === undefined ||
        section.characterId === null ||
        (
          isBoundedString(section.characterId, MAX_ACTOR_ID_LENGTH) &&
          section.characterId.trim().length > 0
        ))
    );
  });
}

/** Persisted/current scripts must always have a fully valid presentation. */
export function isValidScript(value: unknown): value is Script {
  return isValidScriptFields(value) && isValidPresentation(value.presentation);
}

function isValidScripts(value: unknown): value is Script[] {
  if (!Array.isArray(value) || value.length > MAX_SCRIPTS) return false;
  const ids = new Set<string>();
  return value.every(script => {
    if (!isValidScript(script) || ids.has(script.id)) return false;
    ids.add(script.id);
    return true;
  });
}

function normalizeScriptPresentation(
  value: unknown,
  fallback: PresentationPreferences,
): Script | null {
  if (!isValidScriptFields(value)) return null;
  const cloned = cloneScriptData(value as Script);
  return {
    ...cloned,
    sections: normalizeActorSectionReferences(value.actor, cloned.sections),
    ...(value.actor ? { actor: migrateActorVoices(cloneActor(value.actor)) } : {}),
    presentation: normalizePresentation(value.presentation, fallback),
  };
}

function normalizeScriptsPresentation(
  value: unknown,
  fallback: PresentationPreferences,
): Script[] | null {
  if (!Array.isArray(value) || value.length > MAX_SCRIPTS) return null;
  const scripts = value.map(script => normalizeScriptPresentation(script, fallback));
  if (scripts.some(script => script === null)) return null;
  const finalScripts = scripts as Script[];
  const ids = new Set<string>();
  return finalScripts.every(script => {
    if (ids.has(script.id)) return false;
    ids.add(script.id);
    return true;
  }) ? finalScripts : null;
}

function isValidTrash(value: unknown): value is DeletedScript[] {
  if (!Array.isArray(value) || value.length > MAX_TRASH) return false;
  return value.every(entry => (
    isRecord(entry) &&
    isValidScript(entry.script) &&
    isValidTimestamp(entry.deletedAt)
  ));
}

function normalizeTrashPresentation(
  value: unknown,
  fallback: PresentationPreferences,
): DeletedScript[] | null {
  if (!Array.isArray(value) || value.length > MAX_TRASH) return null;
  const trash = value.map(entry => {
    if (!isRecord(entry) || !isValidTimestamp(entry.deletedAt)) return null;
    const script = normalizeScriptPresentation(entry.script, fallback);
    return script ? { script, deletedAt: entry.deletedAt } : null;
  });
  return trash.some(entry => entry === null) ? null : trash as DeletedScript[];
}

function isSortMode(value: unknown): value is SortMode {
  return value === 'newest' || value === 'oldest' || value === 'az' ||
    value === 'za' || value === 'custom';
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every(id => bSet.has(id)) && new Set(a).size === a.length;
}

function validateState(
  scripts: unknown,
  trash: unknown,
  customOrder: unknown,
  sortMode: unknown,
  activeScriptId: unknown,
): scripts is Script[] {
  if (!isValidScripts(scripts) || !isValidTrash(trash)) return false;
  if (!Array.isArray(customOrder) || customOrder.some(id => (
    !isValidId(id)
  ))) return false;
  if (!isSortMode(sortMode) || !sameStringSet(customOrder, scripts.map(script => script.id))) {
    return false;
  }
  if (activeScriptId !== null && (
    typeof activeScriptId !== 'string' ||
    !scripts.some(script => script.id === activeScriptId)
  )) return false;

  const ids = new Set<string>();
  for (const script of scripts) {
    if (ids.has(script.id)) return false;
    ids.add(script.id);
    for (const section of script.sections) {
      if (ids.has(section.id)) return false;
      ids.add(section.id);
    }
  }
  for (const entry of trash) {
    if (ids.has(entry.script.id)) return false;
    ids.add(entry.script.id);
    for (const section of entry.script.sections) {
      if (ids.has(section.id)) return false;
      ids.add(section.id);
    }
  }
  return true;
}

function activeIdForScripts(
  activeScriptId: unknown,
  scripts: Script[],
  missingActiveIdUsesFirst: boolean,
): string | null | undefined {
  if (activeScriptId === undefined && missingActiveIdUsesFirst) {
    return scripts[0]?.id ?? null;
  }
  if (activeScriptId === null) return null;
  if (typeof activeScriptId !== 'string' || activeScriptId.length === 0) {
    return undefined;
  }
  return scripts.some(script => script.id === activeScriptId)
    ? activeScriptId
    : undefined;
}

function defaultMetadata(scripts: Script[]): LibraryMetadata {
  return {
    trash: [],
    customOrder: scripts.map(script => script.id),
    sortMode: 'custom',
  };
}

/**
 * Old array backups were written before section IDs were required to be
 * globally unique. Keep those backups recoverable while ensuring anything
 * returned to the store can be written and loaded safely.
 */
function repairIdentityCollisions(
  scripts: Script[],
  trash: DeletedScript[],
): { scripts: Script[]; trash: DeletedScript[] } | null {
  // Reserve every active script ID before sections are visited. This keeps
  // script IDs (and therefore active/custom-order references) authoritative
  // while colliding section IDs are regenerated.
  const used = new Set(scripts.map(script => script.id));
  const repair = (source: Script, preserveScriptId: boolean): Script | null => {
    let scriptId = source.id;
    if (!preserveScriptId && used.has(scriptId)) {
      const freshScriptId = freshId(used, generateId);
      if (!freshScriptId) return null;
      scriptId = freshScriptId;
    }
    used.add(scriptId);
    const sections: Array<Script['sections'][number] | null> = source.sections.map(section => {
      const sectionId = used.has(section.id) ? freshId(used, generateId) : section.id;
      if (!sectionId) return null;
      used.add(sectionId);
      return { ...section, id: sectionId };
    });
    if (sections.some(section => section === null)) return null;
    const repairedSections = sections.filter(
      (section): section is Script['sections'][number] => section !== null,
    );
    const clonedSource = cloneScriptData(source);
    return {
      ...clonedSource,
      id: scriptId,
      sections: repairedSections.map((section, index) => ({
        ...clonedSource.sections[index],
        id: section.id,
      })),
      ...(source.actor ? { actor: cloneActor(source.actor) } : {}),
    };
  };

  // Active script IDs are authoritative for active selection and customOrder.
  const repairedScripts = scripts.map(script => repair(script, true));
  if (repairedScripts.some(script => script === null)) return null;
  const repairedTrash = trash.map(entry => ({
    deletedAt: entry.deletedAt,
    script: repair(entry.script, false),
  }));
  if (repairedTrash.some(entry => entry.script === null)) return null;
  return {
    scripts: repairedScripts as Script[],
    trash: repairedTrash as DeletedScript[],
  };
}

function hasUniqueIdentities(scripts: Script[], trash: DeletedScript[]): boolean {
  const ids = new Set<string>();
  for (const script of scripts) {
    if (ids.has(script.id)) return false;
    ids.add(script.id);
    for (const section of script.sections) {
      if (ids.has(section.id)) return false;
      ids.add(section.id);
    }
  }
  for (const entry of trash) {
    if (ids.has(entry.script.id)) return false;
    ids.add(entry.script.id);
    for (const section of entry.script.sections) {
      if (ids.has(section.id)) return false;
      ids.add(section.id);
    }
  }
  return true;
}

function parseLibraryValue(
  parsed: unknown,
  legacyActiveId?: unknown,
  repairCollisions = true,
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
): ParsedLibrary | null {
  let scripts: Script[];
  let activeScriptId: string | null | undefined;
  let trash: DeletedScript[] = [];
  let customOrder: string[] | undefined;
  let sortMode: SortMode = 'custom';

  if (Array.isArray(parsed)) {
    const normalizedScripts = normalizeScriptsPresentation(parsed, presentationFallback);
    if (!normalizedScripts) return null;
    scripts = normalizedScripts;
    const legacySelection = activeIdForScripts(
      legacyActiveId,
      scripts,
      true,
    );
    // Older releases left a stale selection key after deletion. The array
    // itself is still recoverable, so select its first script on migration.
    activeScriptId = legacySelection ?? scripts[0]?.id ?? null;
    customOrder = scripts.map(script => script.id);
  } else {
    if (!isRecord(parsed) ||
      (parsed.version !== QUICKQUE_STORAGE_VERSION && parsed.version !== LEGACY_STORAGE_VERSION)
    ) return null;
    const normalizedScripts = normalizeScriptsPresentation(
      parsed.scripts,
      presentationFallback,
    );
    if (!normalizedScripts) return null;
    scripts = normalizedScripts;
    activeScriptId = activeIdForScripts(parsed.activeScriptId, scripts, false);
    if (parsed.trash !== undefined) {
      const normalizedTrash = normalizeTrashPresentation(parsed.trash, presentationFallback);
      if (!normalizedTrash) return null;
      trash = normalizedTrash;
    }
    if (parsed.customOrder !== undefined) customOrder = parsed.customOrder as string[];
    if (parsed.sortMode !== undefined) sortMode = parsed.sortMode as SortMode;
  }

  if (activeScriptId === undefined || !isValidTrash(trash)) {
    return null;
  }
  if (!hasUniqueIdentities(scripts, trash)) {
    if (!repairCollisions) return null;
    const repaired = repairIdentityCollisions(scripts, trash);
    if (!repaired) return null;
    scripts = repaired.scripts;
    trash = repaired.trash;
  }
  const metadata = defaultMetadata(scripts);
  const finalOrder = customOrder ?? metadata.customOrder;
  if (!validateState(scripts, trash, finalOrder, sortMode, activeScriptId)) return null;
  return {
    scripts,
    activeScriptId,
    trash,
    customOrder: finalOrder,
    sortMode,
  };
}

function byteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
  return unescape(encodeURIComponent(value)).length;
}

/**
 * Parse a backup without touching storage. Both legacy arrays and v1
 * envelopes are accepted, while malformed metadata is rejected as a whole.
 */
export function parseLibraryData(
  data: string,
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
): { ok: true; library: ParsedLibrary } | {
  ok: false;
  error: string;
} {
  if (typeof data !== 'string' || byteLength(data) > MAX_BACKUP_BYTES) {
    return { ok: false, error: BACKUP_TOO_LARGE_ERROR };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }
  const library = parseLibraryValue(
    parsed,
    undefined,
    true,
    presentationFallback,
  );
  return library
    ? { ok: true, library }
    : { ok: false, error: MALFORMED_LIBRARY_ERROR };
}

/**
 * Read the current envelope, or the two keys written by older Quickque
 * versions. This function never writes, which lets callers fail closed when
 * parsing fails without replacing the bytes that might be recoverable.
 */
export function loadLibrary(
  storage: StorageLike,
  seedScripts: Script[],
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
  legacyPresentationFallback: PresentationPreferences = presentationFallback,
): LoadedLibrary {
  let storedScripts: string | null;
  try {
    storedScripts = storage.getItem(QUICKQUE_SCRIPTS_KEY);
  } catch {
    return { ok: false, error: STORAGE_READ_ERROR };
  }

  if (storedScripts === null) {
    // Seeds represent a newly created library rather than restored user data,
    // so they intentionally inherit today's defaults even if their source
    // fixture was built with the module default.
    const normalizedSeeds = normalizeScriptsPresentation(
      seedScripts.map(script => ({ ...script, presentation: undefined })),
      presentationFallback,
    );
    if (!normalizedSeeds) return { ok: false, error: MALFORMED_LIBRARY_ERROR };
    const metadata = defaultMetadata(normalizedSeeds);
    if (!validateState(
      normalizedSeeds,
      metadata.trash,
      metadata.customOrder,
      metadata.sortMode,
      normalizedSeeds[0]?.id ?? null,
    )) {
      return { ok: false, error: MALFORMED_LIBRARY_ERROR };
    }
    return {
      ok: true,
      scripts: normalizedSeeds,
      activeScriptId: normalizedSeeds[0]?.id ?? null,
      ...metadata,
      needsMigration: false,
      wasMissing: true,
    };
  }

  let parsed: unknown;
  try {
    if (byteLength(storedScripts) > MAX_BACKUP_BYTES) {
      return { ok: false, error: BACKUP_TOO_LARGE_ERROR };
    }
    parsed = JSON.parse(storedScripts);
  } catch {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }

  let storedActiveId: string | null = null;
  if (Array.isArray(parsed)) {
    try {
      storedActiveId = storage.getItem(QUICKQUE_ACTIVE_SCRIPT_KEY);
    } catch {
      return { ok: false, error: STORAGE_READ_ERROR };
    }
  }
  const library = parseLibraryValue(
    parsed,
    Array.isArray(parsed) ? (storedActiveId === null ? undefined : storedActiveId) : undefined,
    Array.isArray(parsed) ||
      (isRecord(parsed) && parsed.version === LEGACY_STORAGE_VERSION),
    legacyPresentationFallback,
  );
  if (!library) return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  return {
    ok: true,
    ...library,
    // Array data and envelopes without metadata should be rewritten once.
    needsMigration: Array.isArray(parsed) ||
      !isRecord(parsed) ||
      parsed.version === LEGACY_STORAGE_VERSION ||
      (Array.isArray(parsed.scripts) && parsed.scripts.some((script: Record<string, unknown>) => script.purpose === undefined)) ||
      (Array.isArray(parsed.trash) && parsed.trash.some((entry: { script: Record<string, unknown> }) => entry.script.purpose === undefined)) ||
      parsed.trash === undefined ||
      parsed.customOrder === undefined ||
      parsed.sortMode === undefined ||
      !hasValidPresentations(
        Array.isArray(parsed) ? parsed : parsed.scripts,
        Array.isArray(parsed) ? [] : ((parsed.trash as unknown) ?? []),
      ) ||
      !hasUniqueIdentities(
        Array.isArray(parsed) ? parsed : (parsed.scripts as Script[]),
        Array.isArray(parsed) ? [] : ((parsed.trash as DeletedScript[] | undefined) ?? []),
      ),
    wasMissing: false,
  };
}

function hasValidPresentations(scripts: unknown, trash: unknown): boolean {
  return Array.isArray(scripts) && scripts.every(isValidScript) &&
    Array.isArray(trash) && trash.every(entry => (
      isRecord(entry) && isValidScript(entry.script)
    ));
}

export type PersistOptions = Partial<LibraryMetadata>;

export function createLibraryEnvelope(
  scripts: Script[],
  activeScriptId: string | null,
  options?: PersistOptions,
): LibraryEnvelope {
  const safeScripts = scripts.map(script => {
    const cloned = cloneScriptData(script);
    return {
      ...cloned,
      sections: normalizeActorSectionReferences(script.actor, cloned.sections),
    };
  });
  const safeTrash = (options?.trash ?? []).map(entry => {
    const script = (() => {
      const cloned = cloneScriptData(entry.script);
      return {
        ...cloned,
        sections: normalizeActorSectionReferences(entry.script.actor, cloned.sections),
      };
    })();
    return { deletedAt: entry.deletedAt, script };
  });
  const envelope: LibraryEnvelope = {
    version: QUICKQUE_STORAGE_VERSION,
    scripts: safeScripts,
    activeScriptId,
  };
  envelope.trash = safeTrash;
  envelope.customOrder = options?.customOrder ?? safeScripts.map(script => script.id);
  envelope.sortMode = options?.sortMode ?? 'custom';
  return envelope;
}

/**
 * Serialize and persist the complete library in one setItem call. Callers
 * should only update React state after this function returns ok: true.
 */
export function persistLibrary(
  storage: StorageLike,
  scripts: Script[],
  activeScriptId: string | null,
  options?: PersistOptions,
): { ok: true; bytes: string } | { ok: false; error: string } {
  // Guard the cloning pass itself. Validation normally rejects these shapes,
  // but it must do so as a user-facing failure rather than throwing while
  // trying to inspect an untrusted import.
  if (
    !Array.isArray(scripts) ||
    scripts.some(script => !isRecord(script) || !Array.isArray(script.sections)) ||
    (options?.trash !== undefined && (
      !Array.isArray(options.trash) ||
      options.trash.some(entry => (
        !isRecord(entry) ||
        !isRecord(entry.script) ||
        !Array.isArray(entry.script.sections)
      ))
    ))
  ) {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }
  const scriptList = Array.isArray(scripts)
    ? scripts.map(script => {
      const cloned = cloneScriptData(script);
      return {
        ...cloned,
        sections: normalizeActorSectionReferences(script.actor, cloned.sections),
      };
    })
    : [];
  const metadata: LibraryMetadata = {
    trash: (options?.trash ?? []).map(entry => {
      const cloned = cloneScriptData(entry.script);
      return {
        deletedAt: entry.deletedAt,
        script: {
          ...cloned,
          sections: normalizeActorSectionReferences(entry.script.actor, cloned.sections),
        },
      };
    }),
    customOrder: options?.customOrder ?? scriptList.map(script => script.id),
    sortMode: options?.sortMode ?? 'custom',
  };
  if (!validateState(
    scriptList,
    metadata.trash,
    metadata.customOrder,
    metadata.sortMode,
    activeScriptId,
  )) {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }

  let bytes: string;
  try {
    bytes = JSON.stringify(createLibraryEnvelope(scriptList, activeScriptId, { ...metadata }));
    if (byteLength(bytes) > MAX_BACKUP_BYTES) {
      return { ok: false, error: BACKUP_TOO_LARGE_ERROR };
    }
    storage.setItem(QUICKQUE_SCRIPTS_KEY, bytes);
  } catch {
    return { ok: false, error: STORAGE_WRITE_ERROR };
  }
  return { ok: true, bytes };
}

export function collectScriptIds(
  scripts: Script[],
  trash: DeletedScript[] = [],
): Set<string> {
  const ids = new Set<string>();
  const addScript = (script: Script) => {
    ids.add(script.id);
    for (const section of script.sections) ids.add(section.id);
  };
  for (const script of scripts) addScript(script);
  for (const entry of trash) addScript(entry.script);
  return ids;
}

function freshId(usedIds: Set<string>, idFactory: () => string): string | null {
  // A bounded loop avoids hanging if a test or host supplies a broken ID
  // source, while still making collisions practically impossible in normal
  // operation.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = idFactory();
    if (typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && !usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  return null;
}

export function validateDocumentImport(
  title: unknown,
  text: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof title !== 'string' || title.trim().length === 0) {
    return { ok: false, error: 'Document title is required.' };
  }
  if (title.length > MAX_DOCUMENT_TITLE_LENGTH) {
    return {
      ok: false,
      error: `Document title must be ${MAX_DOCUMENT_TITLE_LENGTH} characters or fewer.`,
    };
  }
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { ok: false, error: 'Document text must not be blank.' };
  }
  if (text.length > MAX_DOCUMENT_TEXT_LENGTH) {
    return {
      ok: false,
      error: `Document text must be ${MAX_DOCUMENT_TEXT_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true };
}

/**
 * Construct a document import without changing any caller-owned data. The
 * title and content are intentionally not trimmed: successful imports keep
 * the exact paragraph text supplied by the caller.
 */
export function createDocumentScript(
  title: unknown,
  text: unknown,
  usedIds: Set<string>,
  idFactory: () => string = generateId,
  presentationFallback: PresentationPreferences = DEFAULT_PRESENTATION,
): DocumentImportResult {
  const validation = validateDocumentImport(title, text);
  if ('error' in validation) return validation;

  const scriptId = freshId(usedIds, idFactory);
  const sectionId = freshId(usedIds, idFactory);
  if (!scriptId || !sectionId) {
    return { ok: false, error: 'Could not create unique document IDs.' };
  }

  const now = Date.now();
  return {
    ok: true,
    script: {
      id: scriptId,
      purpose: 'presentation',
      title: title as string,
      createdAt: now,
      updatedAt: now,
      presentation: normalizePresentation(presentationFallback),
      sections: [
        {
          id: sectionId,
          title: 'Section 1',
          content: text as string,
        },
      ],
    },
  };
}

export const storageErrors = {
  malformedLibrary: MALFORMED_LIBRARY_ERROR,
  readLibrary: STORAGE_READ_ERROR,
  writeLibrary: STORAGE_WRITE_ERROR,
  backupTooLarge: BACKUP_TOO_LARGE_ERROR,
} as const;
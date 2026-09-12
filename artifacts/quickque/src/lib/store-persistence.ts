import type { Script } from './types.ts';
import { generateId } from './utils.ts';

export const QUICKQUE_SCRIPTS_KEY = 'quickque_scripts';
export const QUICKQUE_ACTIVE_SCRIPT_KEY = 'quickque_active_script';
export const QUICKQUE_STORAGE_VERSION = 1 as const;

export const MAX_DOCUMENT_TITLE_LENGTH = 200;
export const MAX_DOCUMENT_TEXT_LENGTH = 500_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type LibraryEnvelope = {
  version: typeof QUICKQUE_STORAGE_VERSION;
  scripts: Script[];
  activeScriptId: string | null;
};

export type LoadedLibrary =
  | {
      ok: true;
      scripts: Script[];
      activeScriptId: string | null;
      /** True when the value came from the pre-envelope array format. */
      needsMigration: boolean;
      /** True when quickque_scripts did not exist and the caller used its seed. */
      wasMissing: boolean;
    }
  | {
      ok: false;
      error: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validate data loaded from localStorage before it is allowed into the
 * application. This deliberately accepts empty script titles because the
 * editor has always allowed users to clear a title.
 */
export function isValidScript(value: unknown): value is Script {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.title !== 'string') return false;
  if (
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    !Number.isFinite(value.updatedAt)
  ) {
    return false;
  }
  if (!Array.isArray(value.sections)) return false;

  const sectionIds = new Set<string>();
  return value.sections.every(section => {
    if (!isRecord(section)) return false;
    if (typeof section.id !== 'string' || section.id.length === 0) return false;
    if (sectionIds.has(section.id)) return false;
    sectionIds.add(section.id);
    return (
      typeof section.title === 'string' &&
      typeof section.content === 'string'
    );
  });
}

function isValidScripts(value: unknown): value is Script[] {
  if (!Array.isArray(value)) return false;
  const scriptIds = new Set<string>();
  return value.every(script => {
    if (!isValidScript(script) || scriptIds.has(script.id)) return false;
    scriptIds.add(script.id);
    return true;
  });
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

/**
 * Read the current envelope, or the two keys written by older Quickque
 * versions. This function never writes, which lets callers fail closed when
 * parsing fails without replacing the bytes that might be recoverable.
 */
export function loadLibrary(
  storage: StorageLike,
  seedScripts: Script[],
): LoadedLibrary {
  let storedScripts: string | null;
  try {
    storedScripts = storage.getItem(QUICKQUE_SCRIPTS_KEY);
  } catch {
    return { ok: false, error: STORAGE_READ_ERROR };
  }

  if (storedScripts === null) {
    return {
      ok: true,
      scripts: seedScripts,
      activeScriptId: seedScripts[0]?.id ?? null,
      needsMigration: false,
      wasMissing: true,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(storedScripts);
  } catch {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }

  if (Array.isArray(parsed)) {
    if (!isValidScripts(parsed)) {
      return { ok: false, error: MALFORMED_LIBRARY_ERROR };
    }

    let storedActiveId: string | null;
    try {
      storedActiveId = storage.getItem(QUICKQUE_ACTIVE_SCRIPT_KEY);
    } catch {
      return { ok: false, error: STORAGE_READ_ERROR };
    }

    const activeScriptId = activeIdForScripts(
      storedActiveId === null ? undefined : storedActiveId,
      parsed,
      true,
    );
    return {
      ok: true,
      scripts: parsed,
      // Older versions could leave a stale selection key after deletion.
      // This is not corruption of the script library.
      activeScriptId: activeScriptId ?? parsed[0]?.id ?? null,
      needsMigration: true,
      wasMissing: false,
    };
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }

  if (parsed.version !== QUICKQUE_STORAGE_VERSION) {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }
  if (!isValidScripts(parsed.scripts)) {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }

  const activeScriptId = activeIdForScripts(
    parsed.activeScriptId,
    parsed.scripts,
    false,
  );
  if (activeScriptId === undefined) {
    return { ok: false, error: MALFORMED_LIBRARY_ERROR };
  }

  return {
    ok: true,
    scripts: parsed.scripts,
    activeScriptId,
    needsMigration: false,
    wasMissing: false,
  };
}

export function createLibraryEnvelope(
  scripts: Script[],
  activeScriptId: string | null,
): LibraryEnvelope {
  return {
    version: QUICKQUE_STORAGE_VERSION,
    scripts,
    activeScriptId,
  };
}

/**
 * Serialize and persist the complete library in one setItem call. Callers
 * should only update React state after this function returns ok: true.
 */
export function persistLibrary(
  storage: StorageLike,
  scripts: Script[],
  activeScriptId: string | null,
): { ok: true; bytes: string } | { ok: false; error: string } {
  let bytes: string;
  try {
    bytes = JSON.stringify(createLibraryEnvelope(scripts, activeScriptId));
    storage.setItem(QUICKQUE_SCRIPTS_KEY, bytes);
  } catch {
    return { ok: false, error: STORAGE_WRITE_ERROR };
  }
  return { ok: true, bytes };
}

export function collectScriptIds(scripts: Script[]): Set<string> {
  const ids = new Set<string>();
  for (const script of scripts) {
    ids.add(script.id);
    for (const section of script.sections) ids.add(section.id);
  }
  return ids;
}

function freshId(usedIds: Set<string>, idFactory: () => string): string | null {
  // A bounded loop avoids hanging if a test or host supplies a broken ID
  // source, while still making collisions practically impossible in normal
  // operation.
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = idFactory();
    if (typeof id === 'string' && id.length > 0 && !usedIds.has(id)) {
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
): DocumentImportResult {
  const validation = validateDocumentImport(title, text);
  if (!validation.ok) return validation;

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
      title: title as string,
      createdAt: now,
      updatedAt: now,
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
} as const;
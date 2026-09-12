import type { Script } from './types.ts';
import { tokenizeReaderSections } from './reader-tokenization.ts';

/**
 * Resume data is deliberately kept out of the script library envelope. It is
 * a device-local convenience, not part of a portable script.
 */
export const QUICKQUE_READER_RESUME_KEY = 'quickque_reader_resume';
export const QUICKQUE_READER_RESUME_POSITION_KEY = QUICKQUE_READER_RESUME_KEY;

const RESUME_STORAGE_VERSION = 1 as const;
const MAX_SCRIPT_ID_LENGTH = 200;
const MAX_SECTION_COUNT = 500;
const MAX_SECTION_ID_LENGTH = 200;
const MAX_SECTION_CONTENT_LENGTH = 500_000;
/**
 * Resume is best-effort and must never turn into a second script library.
 * These bounds apply to the single dedicated localStorage envelope.
 */
export const MAX_READER_RESUME_POSITIONS = 256;
export const MAX_READER_RESUME_ENVELOPE_BYTES = 256 * 1024;
const MAX_FINGERPRINT_LENGTH = 64;

export const readerResumeErrors = {
  unavailable: 'Reader resume storage is unavailable.',
  read: 'Failed to read reader resume position.',
  save: 'Failed to save reader resume position.',
  clear: 'Failed to clear reader resume position.',
  prune: 'Failed to prune reader resume positions.',
  invalidScript: 'Cannot save reader resume position for an invalid script.',
  invalidAnchor: 'Reader anchor is not present in the current script.',
} as const;

/**
 * The small storage surface makes this helper usable in tests without
 * replacing the process-wide localStorage object. The optional argument on
 * the public functions is only an injection seam; normal callers omit it.
 */
export interface ReaderResumeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type StoredResumePosition = {
  fingerprint: string;
  sectionId: string;
  sourceOffset: number;
  completed: boolean;
};

type StoredResumeEnvelope = {
  version: typeof RESUME_STORAGE_VERSION;
  positions: Record<string, StoredResumePosition>;
};

/**
 * A position returned to the reader contains a current rendered anchor when
 * one can be resolved. `anchorId` is intentionally nullable: callers should
 * fall back safely instead of trying to query a deleted or end-of-copy span.
 *
 * `sectionId` and `sourceOffset` are UTF-16 offsets into the current section
 * source. No source text, transcript, audio, elapsed time, or viewport data is
 * persisted.
 */
export type ReaderResumePosition = {
  anchorId: string | null;
  sectionId: string;
  sourceOffset: number;
  completed: boolean;
};

export type ReadResumePositionResult =
  | { ok: true; position: ReaderResumePosition | null }
  | { ok: false; error: string };

export type SaveResumePositionResult =
  | { ok: true; position: ReaderResumePosition }
  | { ok: false; error: string };

export type ClearResumePositionResult =
  | { ok: true }
  | { ok: false; error: string };

export type PruneResumePositionsResult =
  | { ok: true }
  | { ok: false; error: string };

type ReaderAnchorLocation = {
  anchorId: string;
  sectionId: string;
  sourceOffset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredResumePosition(value: unknown): value is StoredResumePosition {
  if (!isRecord(value)) return false;
  return (
    typeof value.fingerprint === 'string' &&
    value.fingerprint.length > 0 &&
    value.fingerprint.length <= MAX_FINGERPRINT_LENGTH &&
    typeof value.sectionId === 'string' &&
    value.sectionId.length > 0 &&
    value.sectionId.length <= MAX_SECTION_ID_LENGTH &&
    typeof value.sourceOffset === 'number' &&
    Number.isSafeInteger(value.sourceOffset) &&
    value.sourceOffset >= 0 &&
    typeof value.completed === 'boolean'
  );
}

function emptyEnvelope(): StoredResumeEnvelope {
  return {
    version: RESUME_STORAGE_VERSION,
    positions: Object.create(null) as Record<string, StoredResumePosition>,
  };
}

function serializedSize(value: string): number {
  try {
    return new TextEncoder().encode(value).byteLength;
  } catch {
    // TextEncoder is available in supported browsers; the fallback keeps this
    // helper safe in a restricted test/host environment.
    return value.length;
  }
}

/**
 * Invalid bytes are treated as an absent resume rather than being allowed to
 * affect reader startup. Actual storage exceptions are handled by the public
 * functions and are reported as `{ ok: false }`.
 */
function parseEnvelope(raw: string | null): StoredResumeEnvelope {
  if (raw === null) return emptyEnvelope();
  if (serializedSize(raw) > MAX_READER_RESUME_ENVELOPE_BYTES) return emptyEnvelope();
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== RESUME_STORAGE_VERSION ||
      !isRecord(value.positions)) {
      return emptyEnvelope();
    }

    const positions = Object.create(null) as Record<string, StoredResumePosition>;
    for (const [scriptId, position] of Object.entries(value.positions).slice(
      0,
      MAX_READER_RESUME_POSITIONS,
    )) {
      if (scriptId.length <= MAX_SCRIPT_ID_LENGTH && isStoredResumePosition(position)) {
        positions[scriptId] = position;
      }
    }
    return { version: RESUME_STORAGE_VERSION, positions };
  } catch {
    return emptyEnvelope();
  }
}

function getLocalStorage(): ReaderResumeStorageLike | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage;
  } catch {
    // Browsers can throw while resolving localStorage in a blocked/opaque
    // origin. Treat that exactly like an unavailable storage backend.
    return null;
  }
}

function resolveStorage(
  storage: ReaderResumeStorageLike | null | undefined,
): ReaderResumeStorageLike | null {
  return storage === undefined ? getLocalStorage() : storage;
}

function isValidScriptForResume(script: Script): boolean {
  return (
    isRecord(script) &&
    typeof script.id === 'string' &&
    script.id.length > 0 &&
    script.id.length <= MAX_SCRIPT_ID_LENGTH &&
    Array.isArray(script.sections) &&
    script.sections.length <= MAX_SECTION_COUNT &&
    script.sections.every(section => (
      isRecord(section) &&
      typeof section.id === 'string' &&
      section.id.length > 0 &&
      section.id.length <= MAX_SECTION_ID_LENGTH &&
      typeof section.content === 'string' &&
      section.content.length <= MAX_SECTION_CONTENT_LENGTH
    ))
  );
}

/**
 * A compact, deterministic content fingerprint avoids persisting source text
 * while invalidating a location when section order, IDs, or copy changes.
 * Presentation preferences and script title are intentionally excluded.
 */
export function getReaderContentFingerprint(script: Script): string {
  let hash = 2_166_136_261;
  const update = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16_777_619) >>> 0;
    }
  };

  for (const section of script.sections) {
    // Length prefixes make the separators unambiguous without retaining the
    // source itself in localStorage.
    update(`${section.id.length}:`);
    update(section.id);
    update(`${section.content.length}:`);
    update(section.content);
    update(';');
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Reader renders one anchor per tokenization span as `${section.id}:${index}`.
 * Reconstructing each span's source start here keeps persisted data tied to
 * the same anchors that reader.tsx currently renders, without storing an
 * anchor's displayed text.
 */
function getReaderAnchorLocations(script: Script): ReaderAnchorLocation[] {
  const tokenization = tokenizeReaderSections(script.sections);
  const locations: ReaderAnchorLocation[] = [];

  for (const section of tokenization.enrichedSections) {
    let sourceOffset = 0;
    section.spans.forEach((span, index) => {
      locations.push({
        anchorId: `${section.id}:${index}`,
        sectionId: section.id,
        sourceOffset,
      });
      sourceOffset += span.text.length;
    });
  }
  return locations;
}

type ResumeScriptSnapshot = {
  fingerprint: string;
  locations: ReaderAnchorLocation[];
};

/**
 * Repeated checkpoints from the reader generally see the same immutable
 * Script object. Keep tokenization/fingerprint work out of each one-second
 * checkpoint, while also reusing locations when a store commit defensively
 * clones an unchanged script object. The weak cache cannot retain script
 * objects; the small ID cache retains only anchor IDs/offsets.
 */
const snapshotByScript = new WeakMap<Script, ResumeScriptSnapshot>();
const latestSnapshotByScriptId = new Map<string, ResumeScriptSnapshot>();

function getResumeScriptSnapshot(script: Script): ResumeScriptSnapshot {
  const cached = snapshotByScript.get(script);
  if (cached) return cached;

  const fingerprint = getReaderContentFingerprint(script);
  const latest = latestSnapshotByScriptId.get(script.id);
  if (latest?.fingerprint === fingerprint) {
    snapshotByScript.set(script, latest);
    return latest;
  }

  const snapshot = {
    fingerprint,
    locations: getReaderAnchorLocations(script),
  };
  snapshotByScript.set(script, snapshot);
  latestSnapshotByScriptId.set(script.id, snapshot);

  // A bounded ID cache avoids retaining locations for every script ever
  // opened in a long-lived reader tab. The weak cache still serves the common
  // same-object checkpoint path.
  while (latestSnapshotByScriptId.size > 32) {
    const oldestId = latestSnapshotByScriptId.keys().next().value;
    if (typeof oldestId !== 'string') break;
    latestSnapshotByScriptId.delete(oldestId);
  }
  return snapshot;
}

function removeOldestPosition(
  envelope: StoredResumeEnvelope,
  protectedScriptId?: string,
): boolean {
  const oldestId = Object.keys(envelope.positions).find(id => id !== protectedScriptId);
  if (oldestId === undefined) return false;
  delete envelope.positions[oldestId];
  return true;
}

/**
 * Keep both the entry count and serialized envelope bounded. Insertion order
 * is stable for JSON objects, so when pruning is needed the oldest saved
 * scripts are discarded while the just-saved script is protected.
 */
function serializeBoundedEnvelope(
  envelope: StoredResumeEnvelope,
  protectedScriptId?: string,
): string | null {
  try {
    while (Object.keys(envelope.positions).length > MAX_READER_RESUME_POSITIONS) {
      if (!removeOldestPosition(envelope, protectedScriptId)) return null;
    }

    let serialized = JSON.stringify(envelope);
    while (serializedSize(serialized) > MAX_READER_RESUME_ENVELOPE_BYTES) {
      if (!removeOldestPosition(envelope, protectedScriptId)) return null;
      serialized = JSON.stringify(envelope);
    }
    return serialized;
  } catch {
    return null;
  }
}

function readStoredEnvelope(
  storage: ReaderResumeStorageLike,
): StoredResumeEnvelope | { error: string } {
  try {
    return parseEnvelope(storage.getItem(QUICKQUE_READER_RESUME_KEY));
  } catch {
    return { error: readerResumeErrors.read };
  }
}

function isError(value: StoredResumeEnvelope | { error: string }): value is { error: string } {
  return 'error' in value;
}

/**
 * Read the saved position for a script from localStorage.
 *
 * The optional storage argument is intended for deterministic unit tests.
 * Production/integration callers should use `readResumePosition(script)`.
 */
export function readResumePosition(
  script: Script,
  storage?: ReaderResumeStorageLike | null,
): ReadResumePositionResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, error: readerResumeErrors.unavailable };
  }

  if (!isValidScriptForResume(script)) {
    return { ok: true, position: null };
  }

  const envelope = readStoredEnvelope(resolvedStorage);
  if (isError(envelope)) return { ok: false, error: envelope.error };

  let snapshot: ResumeScriptSnapshot;
  try {
    snapshot = getResumeScriptSnapshot(script);
  } catch {
    return { ok: true, position: null };
  }

  const stored = envelope.positions[script.id];
  if (!stored || stored.fingerprint !== snapshot.fingerprint) {
    return { ok: true, position: null };
  }

  const current = snapshot.locations.find(location => (
    location.sectionId === stored.sectionId &&
    location.sourceOffset === stored.sourceOffset
  ));

  // A deleted section, an edited source range, and a location at the end of
  // copy are all safe reset cases. Never return an anchor that cannot be
  // queried in the current DOM.
  if (!current) return { ok: true, position: null };

  return {
    ok: true,
    position: {
      anchorId: stored.completed ? null : current.anchorId,
      sectionId: stored.sectionId,
      sourceOffset: stored.sourceOffset,
      completed: stored.completed,
    },
  };
}

/**
 * Save a rendered reader anchor as a bounded logical source location.
 * `completed` marks a valid saved location as finished; reads then preserve
 * the completion state while returning a null anchor so integration can offer
 * an explicit restart rather than jumping to the end.
 */
export function saveResumePosition(
  script: Script,
  anchorId: string,
  completed = false,
  storage?: ReaderResumeStorageLike | null,
): SaveResumePositionResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, error: readerResumeErrors.unavailable };
  }
  if (!isValidScriptForResume(script)) {
    return { ok: false, error: readerResumeErrors.invalidScript };
  }

  let snapshot: ResumeScriptSnapshot;
  try {
    snapshot = getResumeScriptSnapshot(script);
  } catch {
    return { ok: false, error: readerResumeErrors.invalidScript };
  }
  const location = snapshot.locations.find(anchor => anchor.anchorId === anchorId);
  if (!location) {
    return { ok: false, error: readerResumeErrors.invalidAnchor };
  }

  const next: StoredResumePosition = {
    fingerprint: snapshot.fingerprint,
    sectionId: location.sectionId,
    sourceOffset: location.sourceOffset,
    completed: completed === true,
  };

  const envelope = readStoredEnvelope(resolvedStorage);
  if (isError(envelope)) return { ok: false, error: readerResumeErrors.save };
  const existing = envelope.positions[script.id];
  if (
    existing &&
    existing.fingerprint === next.fingerprint &&
    existing.sectionId === next.sectionId &&
    existing.sourceOffset === next.sourceOffset &&
    existing.completed === next.completed
  ) {
    return {
      ok: true,
      position: {
        anchorId: next.completed ? null : location.anchorId,
        sectionId: next.sectionId,
        sourceOffset: next.sourceOffset,
        completed: next.completed,
      },
    };
  }
  envelope.positions[script.id] = next;

  const serialized = serializeBoundedEnvelope(envelope, script.id);
  if (serialized === null) {
    return { ok: false, error: readerResumeErrors.save };
  }
  try {
    resolvedStorage.setItem(QUICKQUE_READER_RESUME_KEY, serialized);
  } catch {
    return { ok: false, error: readerResumeErrors.save };
  }

  return {
    ok: true,
    position: {
      anchorId: next.completed ? null : location.anchorId,
      sectionId: next.sectionId,
      sourceOffset: next.sourceOffset,
      completed: next.completed,
    },
  };
}

/**
 * Clear one script's local resume state without touching the portable script
 * library. The optional storage argument is a test seam; callers normally
 * use `clearResumePosition(scriptId)`.
 */
export function clearResumePosition(
  scriptId: string,
  storage?: ReaderResumeStorageLike | null,
): ClearResumePositionResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, error: readerResumeErrors.unavailable };
  }
  if (
    typeof scriptId !== 'string' ||
    scriptId.length === 0 ||
    scriptId.length > MAX_SCRIPT_ID_LENGTH
  ) {
    return { ok: true };
  }

  const envelope = readStoredEnvelope(resolvedStorage);
  if (isError(envelope)) return { ok: false, error: readerResumeErrors.clear };
  if (!Object.prototype.hasOwnProperty.call(envelope.positions, scriptId)) {
    return { ok: true };
  }

  delete envelope.positions[scriptId];
  try {
    resolvedStorage.setItem(QUICKQUE_READER_RESUME_KEY, JSON.stringify(envelope));
  } catch {
    return { ok: false, error: readerResumeErrors.clear };
  }
  return { ok: true };
}

/**
 * Remove positions for scripts that no longer exist in the local library.
 * This is intentionally separate from script deletion: a library/store caller
 * can invoke it after its own successful deletion and ignore the returned
 * error so resume cleanup never blocks deleting the script itself.
 */
export function pruneResumePositions(
  validScriptIds: Iterable<string>,
  storage?: ReaderResumeStorageLike | null,
): PruneResumePositionsResult {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ok: false, error: readerResumeErrors.unavailable };
  }

  const validIds = new Set<string>();
  for (const scriptId of validScriptIds) {
    if (
      typeof scriptId === 'string' &&
      scriptId.length > 0 &&
      scriptId.length <= MAX_SCRIPT_ID_LENGTH
    ) {
      validIds.add(scriptId);
    }
  }

  const envelope = readStoredEnvelope(resolvedStorage);
  if (isError(envelope)) return { ok: false, error: readerResumeErrors.prune };

  let changed = false;
  for (const scriptId of Object.keys(envelope.positions)) {
    if (!validIds.has(scriptId)) {
      delete envelope.positions[scriptId];
      changed = true;
    }
  }
  if (!changed) return { ok: true };

  const serialized = serializeBoundedEnvelope(envelope);
  if (serialized === null) {
    return { ok: false, error: readerResumeErrors.prune };
  }
  try {
    resolvedStorage.setItem(QUICKQUE_READER_RESUME_KEY, serialized);
  } catch {
    return { ok: false, error: readerResumeErrors.prune };
  }
  return { ok: true };
}
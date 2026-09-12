import type { DeletedScript, Script, SortMode } from './types.ts';
import { generateId } from './utils.ts';
import { normalizePresentation } from './presentation-preferences.ts';
import {
  cloneActorWithFreshCharacterIds,
  cloneScriptData,
} from './actor-model.ts';

export type LibraryState = {
  scripts: Script[];
  trash: DeletedScript[];
  customOrder: string[];
  sortMode: SortMode;
  activeScriptId: string | null;
};

export type ImportedLibrary = {
  scripts: Script[];
  trash: DeletedScript[];
  customOrder: string[];
};

export type MergedImportedLibrary = {
  scripts: Script[];
  trash: DeletedScript[];
  order: string[];
};

function collectIds(scripts: Script[], trash: DeletedScript[]): Set<string> {
  const ids = new Set<string>();
  const collect = (script: Script) => {
    ids.add(script.id);
    script.sections.forEach(section => ids.add(section.id));
  };
  scripts.forEach(collect);
  trash.forEach(entry => collect(entry.script));
  return ids;
}

function freshId(used: Set<string>, idFactory: () => string): string | null {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = idFactory();
    if (typeof id === 'string' && id.length > 0 && !used.has(id)) {
      used.add(id);
      return id;
    }
  }
  return null;
}

/**
 * Merge an already-validated portable/full backup without allowing any
 * script or section identity to collide with active or trashed destination
 * data. The caller can persist the returned batch atomically.
 */
export function mergeImportedLibrary(
  imported: ImportedLibrary,
  existingScripts: Script[],
  existingTrash: DeletedScript[],
  idFactory: () => string = generateId,
): MergedImportedLibrary | null {
  const usedIds = collectIds(existingScripts, existingTrash);
  const identityMap = new Map<string, string>();
  const remapScript = (source: Script): Script | null => {
    const scriptId = usedIds.has(source.id) ? freshId(usedIds, idFactory) : source.id;
    if (!scriptId) return null;
    usedIds.add(scriptId);
    identityMap.set(source.id, scriptId);
    const clonedSource = cloneScriptData(source);
    const sections: Array<Script['sections'][number] | null> = clonedSource.sections.map(section => {
      const sectionId = usedIds.has(section.id) ? freshId(usedIds, idFactory) : section.id;
      if (!sectionId) return null;
      usedIds.add(sectionId);
      return { ...section, id: sectionId };
    });
    if (sections.some(section => section === null)) return null;
    const remappedActor = clonedSource.actor
      ? cloneActorWithFreshCharacterIds(
        clonedSource.actor,
        idFactory,
        usedIds,
      )
      : null;
    if (clonedSource.actor && !remappedActor) return null;
    remappedActor?.actor.characters.forEach(character => usedIds.add(character.id));
    const remappedSections = sections.filter(
      (section): section is Script['sections'][number] => section !== null,
    ).map(section => {
      if (!clonedSource.actor) return { ...section };
      const characterId = typeof section.characterId === 'string'
        ? remappedActor?.characterIdMap.get(section.characterId) ?? null
        : section.characterId;
      return { ...section, characterId };
    });
    return {
      ...clonedSource,
      id: scriptId,
      presentation: normalizePresentation(source.presentation),
      sections: remappedSections,
      ...(remappedActor ? { actor: remappedActor.actor } : {}),
    };
  };

  const scripts: Script[] = [];
  for (const source of imported.scripts) {
    const remapped = remapScript(source);
    if (!remapped) return null;
    scripts.push(remapped);
  }
  const trash: DeletedScript[] = [];
  for (const source of imported.trash) {
    const remapped = remapScript(source.script);
    if (!remapped) return null;
    trash.push({ script: remapped, deletedAt: source.deletedAt });
  }
  const importedOrder = imported.customOrder
    .map(id => identityMap.get(id))
    .filter((id): id is string => Boolean(id));
  return {
    scripts,
    trash,
    order: [
      ...importedOrder,
      ...scripts.map(script => script.id).filter(id => !importedOrder.includes(id)),
    ],
  };
}

function firstInOrder(order: string[], scripts: Script[]): string | null {
  const liveIds = new Set(scripts.map(script => script.id));
  return order.find(id => liveIds.has(id)) ?? scripts[0]?.id ?? null;
}

function validIds(ids: string[]): string[] | null {
  if (!Array.isArray(ids)) return null;
  const uniqueIds = [...new Set(ids)];
  return uniqueIds.length > 0 &&
    uniqueIds.every(id => typeof id === 'string') ? uniqueIds : null;
}

export function deleteScriptsState(
  state: LibraryState,
  ids: string[],
  deletedAt: number,
): LibraryState | null {
  const uniqueIds = validIds(ids);
  if (!uniqueIds || uniqueIds.some(id => !state.scripts.some(script => script.id === id))) {
    return null;
  }
  const deleted = uniqueIds
    .map(id => state.scripts.find(script => script.id === id))
    .filter((script): script is Script => Boolean(script))
    .map(script => ({ script, deletedAt }));
  const scripts = state.scripts.filter(script => !uniqueIds.includes(script.id));
  const activeScriptId = state.activeScriptId !== null &&
    uniqueIds.includes(state.activeScriptId)
    ? firstInOrder(
      state.customOrder.filter(id => !uniqueIds.includes(id)),
      scripts,
    )
    : state.activeScriptId;
  return {
    ...state,
    scripts,
    trash: [...deleted, ...state.trash],
    customOrder: state.customOrder.filter(id => !uniqueIds.includes(id)),
    activeScriptId,
  };
}

export function restoreScriptsState(
  state: LibraryState,
  ids: string[],
): LibraryState | null {
  const uniqueIds = validIds(ids);
  if (!uniqueIds || uniqueIds.some(id => (
    !state.trash.some(entry => entry.script.id === id)
  ))) return null;
  const restored = uniqueIds
    .map(id => state.trash.find(entry => entry.script.id === id))
    .filter((entry): entry is DeletedScript => Boolean(entry))
    .map(entry => entry.script);
  return {
    ...state,
    scripts: [...restored, ...state.scripts],
    trash: state.trash.filter(entry => !uniqueIds.includes(entry.script.id)),
    customOrder: [
      ...uniqueIds,
      ...state.customOrder.filter(id => !uniqueIds.includes(id)),
    ],
    activeScriptId: restored[0]?.id ?? state.activeScriptId,
  };
}

export function permanentlyDeleteScriptsState(
  state: LibraryState,
  ids: string[],
): LibraryState | null {
  const uniqueIds = validIds(ids);
  if (!uniqueIds || uniqueIds.some(id => (
    !state.trash.some(entry => entry.script.id === id)
  ))) return null;
  return {
    ...state,
    trash: state.trash.filter(entry => !uniqueIds.includes(entry.script.id)),
  };
}

/**
 * Reorder either a complete library or only the IDs visible in a filtered
 * view. Hidden scripts retain their slots, so drag-and-drop does not silently
 * discard them from customOrder.
 */
export function reorderScriptsState(
  state: LibraryState,
  ids: string[],
): LibraryState | null {
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length ||
    ids.some(id => !state.scripts.some(script => script.id === id))) return null;
  const scriptIds = state.scripts.map(script => script.id);
  const customOrder = ids.length === scriptIds.length
    ? [...ids]
    : (() => {
      const selected = new Set(ids);
      let nextIndex = 0;
      return state.customOrder.map(id => (
        selected.has(id) ? ids[nextIndex++] : id
      ));
    })();
  return { ...state, customOrder };
}
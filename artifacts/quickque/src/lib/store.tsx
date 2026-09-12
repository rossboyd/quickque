import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  ReactNode,
} from 'react';
import {
  Script,
  Settings,
  DEFAULT_SETTINGS,
  DeletedScript,
  SortMode,
  PresentationPreferences,
} from './types';
import { generateId } from './utils';
import {
  collectScriptIds,
  createLibraryEnvelope,
  createDocumentScript,
  loadLibrary,
  parseLibraryData,
  persistLibrary,
  storageErrors,
  StorageLike,
  MAX_BACKUP_BYTES,
} from './store-persistence';
import {
  deleteScriptsState,
  restoreScriptsState,
  permanentlyDeleteScriptsState,
  reorderScriptsState,
  mergeImportedLibrary,
  LibraryState,
} from './store-model';
import { getLocalLibrary, chooseLocalDirectory, saveLocalLibrary } from './local-library';
import {
  createInitialScripts,
  parseRecoveryJson,
  parseScriptsJson,
  serializeScripts,
  mergeNativeHydration,
  canWriteNativeLibrary,
} from './library-data';
import {
  loadSettings,
  loadPresentationDefaults,
  persistPresentationDefaults,
  persistSettings,
  QUICKQUE_PRESENTATION_DEFAULTS_KEY,
} from './settings-persistence';
import {
  DEFAULT_PRESENTATION,
  normalizePresentation,
  presentationFromLegacySettings,
} from './presentation-preferences';

const SEED_SCRIPTS: Script[] = createInitialScripts();
type StoreContextType = {
  scripts: Script[];
  trash: DeletedScript[];
  customOrder: string[];
  sortMode: SortMode;
  settings: Settings;
  presentationDefaults: PresentationPreferences;
  activeScriptId: string | null;
  setActiveScriptId: (id: string | null) => void;
  updateSettings: (newSettings: Partial<Settings>) => void;
  updatePresentationDefaults: (updates: Partial<PresentationPreferences>) => boolean;
  resetPresentationDefaults: () => boolean;
  updateScriptPresentation: (
    id: string,
    updates: Partial<PresentationPreferences>,
  ) => boolean;
  resetScriptPresentation: (id: string) => boolean;
  createScript: () => string;
  updateScript: (
    id: string,
    updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt' | 'presentation'>>,
  ) => void;
  deleteScript: (id: string) => void;
  deleteScripts: (ids: string[]) => boolean;
  restoreScripts: (ids: string[]) => boolean;
  permanentlyDeleteScripts: (ids: string[]) => boolean;
  duplicateScript: (id: string) => string | null;
  setSortMode: (mode: SortMode) => boolean;
  reorderScripts: (ids: string[]) => boolean;
  importScripts: (data: string) => boolean;
  importDocument: (title: string, text: string) => ImportDocumentResult;
  exportScripts: (ids?: string[], format?: 'json' | 'txt') => string;
  recoveryData: string | null;
  recoveryRequired: boolean;
  recoverLibrary: (data: string) => boolean;
  retryLoadLibrary: () => void;
  error: string | null;
  clearError: () => void;
  profile: Profile;
  updateProfile: (updates: Partial<Profile>) => boolean;
  libraryDirectory: string | null;
  chooseLibraryDirectory: () => Promise<string | null>;
  localSaveStatus: string;
};

const StoreContext = createContext<StoreContextType | null>(null);

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

type ImportDocumentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type LibrarySnapshot = LibraryState;
type LibraryCommitResult =
  | { ok: true }
  | { ok: false; error: string };

function getLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isSettingsPersistenceError(error: string | null): boolean {
  return error === 'Failed to save settings.' ||
    error === 'Failed to load settings.' ||
    error === 'Failed to save presentation defaults.' ||
    error === 'Failed to load presentation defaults.';
}

function cloneScript(script: Script): Script {
  return {
    ...script,
    presentation: script.presentation ? { ...script.presentation } : undefined,
    sections: script.sections.map(section => ({ ...section })),
  };
}

function cloneTrash(trash: DeletedScript[]): DeletedScript[] {
  return trash.map(entry => ({
    deletedAt: entry.deletedAt,
    script: cloneScript(entry.script),
  }));
}

function cloneSnapshot(snapshot: LibrarySnapshot): LibrarySnapshot {
  return {
    scripts: snapshot.scripts.map(cloneScript),
    trash: cloneTrash(snapshot.trash),
    customOrder: [...snapshot.customOrder],
    sortMode: snapshot.sortMode,
    activeScriptId: snapshot.activeScriptId,
  };
}

function freshId(usedIds: Set<string>): string | null {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = generateId();
    if (id && !usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
  return null;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [trash, setTrash] = useState<DeletedScript[]>([]);
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [sortMode, setSortModeState] = useState<SortMode>('custom');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [presentationDefaults, setPresentationDefaults] = useState<PresentationPreferences>(
    DEFAULT_PRESENTATION,
  );
  const [activeScriptId, setActiveScriptState] = useState<string | null>(null);
  const [recoveryData, setRecoveryData] = useState<string | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile>(() => readStoredProfile());
  const [libraryDirectory, setLibraryDirectory] = useState<string | null>(null);
  const [localSaveStatus, setLocalSaveStatus] = useState('Loading local library…');

  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const presentationDefaultsRef = useRef<PresentationPreferences>(DEFAULT_PRESENTATION);
  const legacyPresentationRef = useRef<PresentationPreferences>(DEFAULT_PRESENTATION);
  const scriptsRef = useRef<Script[]>([]);
  const trashRef = useRef<DeletedScript[]>([]);
  const customOrderRef = useRef<string[]>([]);
  const sortModeRef = useRef<SortMode>('custom');
  const activeScriptIdRef = useRef<string | null>(null);
  const recoveryRequiredRef = useRef(false);
  const storageRef = useRef<StorageLike | null>(null);
  const savesDisabledRef = useRef(false);
  const profileRef = useRef(profile);
  const localSaveStatusRef = useRef(localSaveStatus);
  const nativeDirectoryRef = useRef<string | null>(null);
  const nativeReadyRef = useRef(false);
  const nativeAutosaveBlockedRef = useRef(false);
  const nativePickerOpenRef = useRef(false);
  const nativeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const nativeGenerationRef = useRef(0);
  const nativeSaveSessionRef = useRef(0);
  const scriptMutationRevisionRef = useRef(0);
  const commitLibraryRef = useRef<
    ((snapshot: LibrarySnapshot) => LibraryCommitResult) | null
  >(null);

  profileRef.current = profile;
  localSaveStatusRef.current = localSaveStatus;
  const setSaveStatus = useCallback((status: string) => {
    localSaveStatusRef.current = status;
    setLocalSaveStatus(status);
  }, []);

  const cancelNativeAutosaves = useCallback(() => {
    nativeSaveSessionRef.current += 1;
    nativeReadyRef.current = false;
    nativeAutosaveBlockedRef.current = true;
    if (nativeSaveTimerRef.current !== null) {
      clearTimeout(nativeSaveTimerRef.current);
      nativeSaveTimerRef.current = null;
    }
  }, []);

  const applyLoaded = useCallback((loaded: Extract<ReturnType<typeof loadLibrary>, { ok: true }>) => {
    scriptsRef.current = loaded.scripts.map(cloneScript);
    trashRef.current = cloneTrash(loaded.trash);
    customOrderRef.current = [...loaded.customOrder];
    sortModeRef.current = loaded.sortMode;
    activeScriptIdRef.current = loaded.activeScriptId;
    setScripts(scriptsRef.current);
    setTrash(trashRef.current);
    setCustomOrder(customOrderRef.current);
    setSortModeState(sortModeRef.current);
    setActiveScriptState(loaded.activeScriptId);
    savesDisabledRef.current = false;
    recoveryRequiredRef.current = false;
    setRecoveryRequired(false);
    setRecoveryData(null);
    // A successful library load cannot repair an independent preferences
    // read/write failure. Keep it visible until that preference succeeds.
    setError(current => (
      current === 'Failed to save settings.' ||
      current === 'Failed to load settings.' ||
      current === 'Failed to save presentation defaults.' ||
      current === 'Failed to load presentation defaults.'
        ? current
        : null
    ));
  }, []);

  const loadCurrentLibrary = useCallback((
    presentationFallback: PresentationPreferences = presentationDefaultsRef.current,
    legacyPresentationFallback: PresentationPreferences = legacyPresentationRef.current,
  ) => {
    // Retry may happen after the host has restored localStorage or after a
    // transient permission error. Always reacquire the host storage handle.
    storageRef.current = getLocalStorage();
    const storage = storageRef.current;
    if (!storage) {
      cancelNativeAutosaves();
      savesDisabledRef.current = true;
      scriptsRef.current = [];
      trashRef.current = [];
      customOrderRef.current = [];
      activeScriptIdRef.current = null;
      setScripts([]);
      setTrash([]);
      setCustomOrder([]);
      setActiveScriptState(null);
      recoveryRequiredRef.current = true;
      setRecoveryRequired(true);
      setRecoveryData(null);
      setError(current => (
        isSettingsPersistenceError(current) ? current : storageErrors.readLibrary
      ));
      return;
    }

    let raw: string | null = null;
    try {
      raw = storage.getItem('quickque_scripts');
    } catch {
      // loadLibrary supplies the user-facing read error.
    }
    const loaded = loadLibrary(
      storage,
      SEED_SCRIPTS,
      presentationFallback,
      legacyPresentationFallback,
    );
    if ('error' in loaded) {
      cancelNativeAutosaves();
      savesDisabledRef.current = true;
      scriptsRef.current = [];
      trashRef.current = [];
      customOrderRef.current = [];
      activeScriptIdRef.current = null;
      setScripts([]);
      setTrash([]);
      setCustomOrder([]);
      setSortModeState('custom');
      sortModeRef.current = 'custom';
      setActiveScriptState(null);
      recoveryRequiredRef.current = true;
      setRecoveryRequired(true);
      setRecoveryData(raw);
      setError(current => (
        isSettingsPersistenceError(current) ? current : loaded.error
      ));
      return;
    }

    applyLoaded(loaded);
    if (loaded.needsMigration || loaded.wasMissing) {
      const persisted = persistLibrary(
        storage,
        loaded.scripts,
        loaded.activeScriptId,
        {
          trash: loaded.trash,
          customOrder: loaded.customOrder,
          sortMode: loaded.sortMode,
        },
      );
      if ('error' in persisted) {
        setError(current => (
          isSettingsPersistenceError(current) ? current : persisted.error
        ));
      }
    }
  }, [applyLoaded, cancelNativeAutosaves]);

  useEffect(() => {
    storageRef.current = getLocalStorage();
    const storage = storageRef.current;
    if (storage) {
      try {
        const loadedSettings = loadSettings(storage);
        settingsRef.current = loadedSettings;
        setSettings(loadedSettings);
        // Take this snapshot before creating defaults. It is the one-time
        // fallback for scripts from releases that had only global reader
        // settings, including scripts which are currently in Trash.
        const legacyPresentation = presentationFromLegacySettings(loadedSettings);
        legacyPresentationRef.current = legacyPresentation;
        const loadedDefaults = loadPresentationDefaults(storage, legacyPresentation);
        presentationDefaultsRef.current = loadedDefaults;
        setPresentationDefaults(loadedDefaults);
        if (storage.getItem(QUICKQUE_PRESENTATION_DEFAULTS_KEY) === null) {
          const persisted = persistPresentationDefaults(storage, loadedDefaults);
          if (!persisted.ok) setError('Failed to save presentation defaults.');
        }
      } catch {
        setError('Failed to load settings.');
      }
    }
    loadCurrentLibrary(
      presentationDefaultsRef.current,
      legacyPresentationRef.current,
    );
    setIsLoaded(true);
  }, [loadCurrentLibrary]);

  useEffect(() => {
    if (!isLoaded) return;
    if (typeof document === 'undefined') return;
    if (settings.darkTheme) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings, isLoaded]);

  const enqueueNativeSave = useCallback(
    (
      serialized: string,
      expectedDirectory: string,
      expectedSession: number,
    ): Promise<void> => {
      const operation = nativeSaveChainRef.current.then(async () => {
        if (!canWriteNativeLibrary(
          expectedDirectory,
          nativeDirectoryRef.current,
          expectedSession,
          nativeSaveSessionRef.current,
          recoveryRequiredRef.current,
          nativePickerOpenRef.current,
          nativeReadyRef.current,
          nativeAutosaveBlockedRef.current,
        )) {
          return;
        }

        setSaveStatus('Saving to local library…');
        try {
          // Capture the directory at enqueue time so a folder change cannot
          // retarget a write that is already waiting in the queue.
          await saveLocalLibrary(serialized, expectedDirectory);
          if (nativeDirectoryRef.current === expectedDirectory) {
            setSaveStatus('Saved to local library');
            setError(current => (
              recoveryRequiredRef.current ||
               current === 'Failed to save settings.' ||
               current === 'Failed to load settings.' ||
               current === 'Failed to save presentation defaults.' ||
               current === 'Failed to load presentation defaults.'
                ? current
                : null
            ));
          }
        } catch (saveError) {
          setSaveStatus('Native save failed — your latest edits are cached locally');
          setError(current => current ?? describeError(
            saveError,
            'Could not save scripts to the local library. Your latest edits are cached locally.',
          ));
          throw saveError;
        }
      });

      // A failed native save must not poison later saves. Browser storage is
      // still the transactional source of truth for the complete library.
      nativeSaveChainRef.current = operation.catch(() => undefined);
      return operation;
    },
    [setSaveStatus],
  );

  const scheduleNativeSave = useCallback(
    (serialized: string) => {
      const directory = nativeDirectoryRef.current;
      const session = nativeSaveSessionRef.current;
      if (!directory || !canWriteNativeLibrary(
        directory,
        nativeDirectoryRef.current,
        session,
        nativeSaveSessionRef.current,
        recoveryRequiredRef.current,
        nativePickerOpenRef.current,
        nativeReadyRef.current,
        nativeAutosaveBlockedRef.current,
      )) {
        return;
      }

      if (nativeSaveTimerRef.current !== null) {
        clearTimeout(nativeSaveTimerRef.current);
      }
      nativeSaveTimerRef.current = setTimeout(() => {
        nativeSaveTimerRef.current = null;
        if (!canWriteNativeLibrary(
          directory,
          nativeDirectoryRef.current,
          session,
          nativeSaveSessionRef.current,
          recoveryRequiredRef.current,
          nativePickerOpenRef.current,
          nativeReadyRef.current,
          nativeAutosaveBlockedRef.current,
        )) {
          return;
        }
        void enqueueNativeSave(serialized, directory, session).catch(() => undefined);
      }, AUTOSAVE_DELAY_MS);
    },
    [enqueueNativeSave],
  );

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    const hydrationGeneration = nativeGenerationRef.current;
    const hydrationRevision = scriptMutationRevisionRef.current;
    setSaveStatus('Loading local library…');

    void getLocalLibrary()
      .then((loaded) => {
        if (cancelled || hydrationGeneration !== nativeGenerationRef.current) return;
        const directory =
          typeof loaded.directory === 'string' && loaded.directory.length > 0
            ? loaded.directory
            : null;
        setLibraryDirectory(directory);
        nativeDirectoryRef.current = directory;

        if (!directory) {
          cancelNativeAutosaves();
          nativeReadyRef.current = false;
          nativeAutosaveBlockedRef.current = false;
          setSaveStatus('No local library selected');
          return;
        }

        const nativeScripts =
          loaded.scriptsJson === null
            ? null
            : parseScriptsJson(loaded.scriptsJson, legacyPresentationRef.current);
        if (loaded.scriptsJson !== null && nativeScripts === null) {
          cancelNativeAutosaves();
          const message =
            'The selected local library is invalid. Your cached scripts are shown; reselect the folder to resume native saves.';
          setSaveStatus(message);
          setError(current => current ?? message);
          return;
        }

        if (recoveryRequiredRef.current) {
          cancelNativeAutosaves();
          setSaveStatus('Local library recovery is required before native saves');
          return;
        }

        nativeReadyRef.current = true;
        nativeAutosaveBlockedRef.current = false;
        if (nativeScripts === null) {
          setSaveStatus('Loaded local library');
          scheduleNativeSave(serializeScripts(scriptsRef.current));
          return;
        }

        const decision = mergeNativeHydration(
          hydrationRevision,
          scriptMutationRevisionRef.current,
          scriptsRef.current,
          nativeScripts,
          collectScriptIds([], trashRef.current),
        );
        if (decision.source === 'local') {
          setSaveStatus('Using cached scripts; saving local edits');
          scheduleNativeSave(serializeScripts(decision.scripts));
          return;
        }

        const commit = commitLibraryRef.current;
        if (!commit) return;
        const nextScripts = decision.scripts.map(cloneScript);
        const nextScriptIds = new Set(nextScripts.map(script => script.id));
        const nextActiveScriptId =
          activeScriptIdRef.current && nextScriptIds.has(activeScriptIdRef.current)
            ? activeScriptIdRef.current
            : nextScripts[0]?.id ?? null;
        const committed = commit({
          scripts: nextScripts,
          trash: trashRef.current,
          customOrder: nextScripts.map(script => script.id),
          sortMode: sortModeRef.current,
          activeScriptId: nextActiveScriptId,
        });
        if (!committed.ok) {
          cancelNativeAutosaves();
          setSaveStatus('Native library was not adopted; your cached scripts remain active');
          return;
        }
        setSaveStatus('Loaded local library');
      })
      .catch((loadError) => {
        if (cancelled || hydrationGeneration !== nativeGenerationRef.current) return;
        cancelNativeAutosaves();
        nativeDirectoryRef.current = null;
        setLibraryDirectory(null);
        const message = describeError(
          loadError,
          'Could not access the selected local library. Your cached scripts are shown; reselect the folder to resume native saves.',
        );
        setSaveStatus(message);
        setError(current => current ?? message);
      });

    return () => {
      cancelled = true;
    };
  }, [
    cancelNativeAutosaves,
    isLoaded,
    recoveryRequired,
    scheduleNativeSave,
    setSaveStatus,
  ]);

  useEffect(() => {
    if (!isLoaded) return;
    scheduleNativeSave(serializeScripts(scripts));
  }, [isLoaded, scheduleNativeSave, scripts]);

  const commitLibrary = useCallback((snapshot: LibrarySnapshot) => {
    if (savesDisabledRef.current) {
      const message = storageErrors.writeLibrary;
      setError(message);
      return { ok: false as const, error: message };
    }

    const storage = storageRef.current;
    if (!storage) {
      const message = storageErrors.writeLibrary;
      setError(message);
      return { ok: false as const, error: message };
    }

    // Clone before serializing and before publishing. This prevents a caller
    // retaining a section or order array from changing state after a commit.
    const next = cloneSnapshot(snapshot);
    const persisted = persistLibrary(storage, next.scripts, next.activeScriptId, {
      trash: next.trash,
      customOrder: next.customOrder,
      sortMode: next.sortMode,
    });
    if ('error' in persisted) {
      setError(persisted.error);
      return persisted;
    }

    scriptMutationRevisionRef.current += 1;
    scriptsRef.current = next.scripts;
    trashRef.current = next.trash;
    customOrderRef.current = next.customOrder;
    sortModeRef.current = next.sortMode;
    activeScriptIdRef.current = next.activeScriptId;
    setScripts(next.scripts);
    setTrash(next.trash);
    setCustomOrder(next.customOrder);
    setSortModeState(next.sortMode);
    setActiveScriptState(next.activeScriptId);
    // A durable library commit resolves earlier library/import failures, not
    // just quota errors. Keep independent settings failures visible.
    setError(current => (
       current === 'Failed to save settings.' ||
       current === 'Failed to load settings.' ||
       current === 'Failed to save presentation defaults.' ||
       current === 'Failed to load presentation defaults.'
        ? current
        : null
    ));
    return { ok: true as const };
  }, []);
  commitLibraryRef.current = commitLibrary;

  const setActiveScriptId = useCallback((id: string | null) => {
    if (id !== null && !scriptsRef.current.some(script => script.id === id)) {
      setError('The selected script no longer exists.');
      return;
    }
    commitLibrary({
      scripts: scriptsRef.current,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: id,
    });
  }, [commitLibrary]);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    const storage = storageRef.current;
    if (!storage) {
      setError('Failed to save settings.');
      return;
    }
    const persisted = persistSettings(storage, {
      ...settingsRef.current,
      ...newSettings,
    });
    if (!persisted.ok) {
      // Do not publish a setting that did not reach durable storage.
      setError('Failed to save settings.');
      return;
    }
    settingsRef.current = persisted.settings;
    setSettings(persisted.settings);
    setError(current => (
      current === 'Failed to save settings.' || current === 'Failed to load settings.'
        ? null
        : current
    ));
  }, []);

  const updatePresentationDefaults = useCallback((
    updates: Partial<PresentationPreferences>,
  ): boolean => {
    const storage = storageRef.current;
    if (!storage) {
      setError('Failed to save presentation defaults.');
      return false;
    }
    const persisted = persistPresentationDefaults(storage, normalizePresentation(
      {
        ...presentationDefaultsRef.current,
        ...updates,
      },
      presentationDefaultsRef.current,
    ));
    if (!persisted.ok) {
      setError(persisted.error);
      return false;
    }
    presentationDefaultsRef.current = persisted.preferences;
    setPresentationDefaults(persisted.preferences);
    setError(current => current === 'Failed to save presentation defaults.' ? null : current);
    return true;
  }, []);

  const resetPresentationDefaults = useCallback((): boolean => {
    return updatePresentationDefaults(DEFAULT_PRESENTATION);
  }, [updatePresentationDefaults]);

  const updateProfile = useCallback((updates: Partial<Profile>): boolean => {
    const current = profileRef.current;
    const next: Profile = {
      name: updates.name ?? current.name,
      onboardingComplete:
        updates.onboardingComplete ?? current.onboardingComplete,
    };
    if (
      typeof next.name !== 'string' ||
      typeof next.onboardingComplete !== 'boolean'
    ) {
      setError('Could not save your profile: the profile data is invalid.');
      return false;
    }

    const storage = getStorage();
    if (!storage) {
      setError('Could not save your profile: local storage is unavailable.');
      return false;
    }
    try {
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    } catch (profileError) {
      setError(
        describeError(
          profileError,
          'Could not save your profile. Onboarding changes may not survive a reload.',
        ),
      );
      return false;
    }

    profileRef.current = next;
    setProfile(next);
    return true;
  }, []);

  const createScript = useCallback(() => {
    const usedIds = collectScriptIds(scriptsRef.current, trashRef.current);
    const newId = freshId(usedIds);
    const sectionId = freshId(usedIds);
    if (!newId || !sectionId) {
      setError('Could not create unique script IDs.');
      return '';
    }

    const now = Date.now();
    const newScript: Script = {
      id: newId,
      title: 'Untitled Script',
      createdAt: now,
      updatedAt: now,
      presentation: normalizePresentation(presentationDefaultsRef.current),
      sections: [{ id: sectionId, title: 'Section 1', content: '' }],
    };
    const nextOrder = [newId, ...customOrderRef.current.filter(id => id !== newId)];
    return commitLibrary({
      scripts: [newScript, ...scriptsRef.current],
      trash: trashRef.current,
      customOrder: nextOrder,
      sortMode: sortModeRef.current,
      activeScriptId: newId,
    }).ok ? newId : '';
  }, [commitLibrary]);

  const updateScript = useCallback((
    id: string,
    updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt' | 'presentation'>>,
  ) => {
    if (!scriptsRef.current.some(script => script.id === id)) return;
    const nextScripts = scriptsRef.current.map(script => (
      script.id === id ? { ...script, ...updates, updatedAt: Date.now() } : script
    ));
    commitLibrary({
      scripts: nextScripts,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    });
  }, [commitLibrary]);

  const updateScriptPresentation = useCallback((
    id: string,
    updates: Partial<PresentationPreferences>,
  ) => {
    const script = scriptsRef.current.find(candidate => candidate.id === id);
    if (!script) return false;
    const currentPresentation = normalizePresentation(
      script.presentation,
      presentationDefaultsRef.current,
    );
    const nextPresentation = normalizePresentation({
      ...currentPresentation,
      ...updates,
    }, currentPresentation);
    const nextScripts = scriptsRef.current.map(candidate => (
      candidate.id === id
        ? { ...candidate, presentation: nextPresentation, updatedAt: Date.now() }
        : candidate
    ));
    return commitLibrary({
      scripts: nextScripts,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    }).ok;
  }, [commitLibrary]);

  const resetScriptPresentation = useCallback((id: string) => {
    return updateScriptPresentation(id, presentationDefaultsRef.current);
  }, [updateScriptPresentation]);

  const deleteScripts = useCallback((ids: string[]) => {
    const next = deleteScriptsState({
      scripts: scriptsRef.current,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    }, ids, Date.now());
    return next ? commitLibrary(next).ok : false;
  }, [commitLibrary]);

  const deleteScript = useCallback((id: string) => {
    deleteScripts([id]);
  }, [deleteScripts]);

  const restoreScripts = useCallback((ids: string[]) => {
    const next = restoreScriptsState({
      scripts: scriptsRef.current,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    }, ids);
    return next ? commitLibrary(next).ok : false;
  }, [commitLibrary]);

  const permanentlyDeleteScripts = useCallback((ids: string[]) => {
    const next = permanentlyDeleteScriptsState({
      scripts: scriptsRef.current,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    }, ids);
    return next ? commitLibrary(next).ok : false;
  }, [commitLibrary]);

  const duplicateScript = useCallback((id: string) => {
    const scriptToDup = scriptsRef.current.find(script => script.id === id);
    if (!scriptToDup) return null;
    const usedIds = collectScriptIds(scriptsRef.current, trashRef.current);
    const newId = freshId(usedIds);
    if (!newId) {
      setError('Could not create a unique script ID.');
      return null;
    }
    const newSections = scriptToDup.sections.map(section => {
      const sectionId = freshId(usedIds);
      return sectionId ? { ...section, id: sectionId } : null;
    });
    if (newSections.some(section => section === null)) {
      setError('Could not create unique section IDs.');
      return null;
    }
    const now = Date.now();
    const newScript: Script = {
      ...scriptToDup,
      id: newId,
      title: `${scriptToDup.title.slice(0, 193)} (Copy)`,
      createdAt: now,
      updatedAt: now,
      presentation: normalizePresentation(
        scriptToDup.presentation,
        presentationDefaultsRef.current,
      ),
      sections: newSections as Script['sections'],
    };
    const nextOrder = [newId, ...customOrderRef.current.filter(orderId => orderId !== newId)];
    return commitLibrary({
      scripts: [newScript, ...scriptsRef.current],
      trash: trashRef.current,
      customOrder: nextOrder,
      sortMode: sortModeRef.current,
      activeScriptId: newId,
    }).ok ? newId : null;
  }, [commitLibrary]);

  const setSortMode = useCallback((mode: SortMode) => {
    if (mode !== 'newest' && mode !== 'oldest' && mode !== 'az' &&
      mode !== 'za' && mode !== 'custom') return false;
    return commitLibrary({
      scripts: scriptsRef.current,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: mode,
      activeScriptId: activeScriptIdRef.current,
    }).ok;
  }, [commitLibrary]);

  const reorderScripts = useCallback((ids: string[]) => {
    const next = reorderScriptsState({
      scripts: scriptsRef.current,
      trash: trashRef.current,
      customOrder: customOrderRef.current,
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    }, ids);
    return next ? commitLibrary(next).ok : false;
  }, [commitLibrary]);

  const importScripts = useCallback((data: string) => {
    const parsed = parseLibraryData(data, presentationDefaultsRef.current);
    if ('error' in parsed) {
      setError(parsed.error);
      return false;
    }
    const remapped = mergeImportedLibrary(
      parsed.library,
      scriptsRef.current,
      trashRef.current,
    );
    if (!remapped) {
      setError('Could not create unique imported IDs.');
      return false;
    }
    const nextOrder = [
      ...remapped.order,
      ...customOrderRef.current.filter(id => !remapped.order.includes(id)),
    ];
    const committed = commitLibrary({
      scripts: [...remapped.scripts, ...scriptsRef.current],
      trash: [...remapped.trash, ...trashRef.current],
      customOrder: nextOrder,
      // Imported metadata never changes the destination display mode.
      sortMode: sortModeRef.current,
      activeScriptId: activeScriptIdRef.current,
    });
    return committed.ok;
  }, [commitLibrary]);

  const importDocument = useCallback((title: string, text: string): ImportDocumentResult => {
    const document = createDocumentScript(
      title,
      text,
      collectScriptIds(scriptsRef.current, trashRef.current),
      undefined,
      presentationDefaultsRef.current,
    );
    if ('error' in document) {
      setError(document.error);
      return document;
    }
    const nextOrder = [
      document.script.id,
      ...customOrderRef.current.filter(id => id !== document.script.id),
    ];
    const persisted = commitLibrary({
      scripts: [document.script, ...scriptsRef.current],
      trash: trashRef.current,
      customOrder: nextOrder,
      sortMode: sortModeRef.current,
      activeScriptId: document.script.id,
    });
    if ('error' in persisted) return { ok: false, error: persisted.error };
    return { ok: true, id: document.script.id };
  }, [commitLibrary]);

  const exportScripts = useCallback((ids?: string[], format: 'json' | 'txt' = 'json') => {
    const selected = ids === undefined
      ? scriptsRef.current
      : customOrderRef.current
        .filter(id => ids.includes(id))
        .map(id => scriptsRef.current.find(script => script.id === id))
        .filter((script): script is Script => Boolean(script));
    if (format === 'txt') {
      const activeText = selected.map(script => [
        `# ${script.title}`,
        ...script.sections.flatMap(section => [`## ${section.title}`, section.content]),
      ].join('\n\n')).join('\n\n---\n\n');
      if (ids !== undefined) return activeText;
      const trashText = trashRef.current.map(entry => [
        `# ${entry.script.title}`,
        ...entry.script.sections.flatMap(section => [`## ${section.title}`, section.content]),
        `(Deleted ${new Date(entry.deletedAt).toISOString()})`,
      ].join('\n\n')).join('\n\n---\n\n');
      return [
        '# Quickque Library Backup',
        `Sort mode: ${sortModeRef.current}`,
        `Custom order: ${customOrderRef.current.join(',')}`,
        '## Active scripts',
        activeText,
        '## Trash',
        trashText || '(empty)',
      ].join('\n\n');
    }
    if (ids !== undefined) {
      return JSON.stringify(selected.map(cloneScript), null, 2);
    }
    return JSON.stringify(createLibraryEnvelope(
      selected.map(cloneScript),
      activeScriptIdRef.current,
      {
        trash: cloneTrash(trashRef.current),
        customOrder: [...customOrderRef.current],
        sortMode: sortModeRef.current,
      },
    ), null, 2);
  }, []);

  const recoverLibrary = useCallback((data: string) => {
    if (!recoveryRequiredRef.current) {
      setError('Library recovery is not required.');
      return false;
    }
    if (typeof data !== 'string' || data.length > MAX_BACKUP_BYTES * 2) {
      setError(storageErrors.backupTooLarge);
      return false;
    }
    const parsed = parseLibraryData(data, legacyPresentationRef.current);
    if ('error' in parsed) {
      setError(parsed.error);
      return false;
    }
    const storage = storageRef.current;
    if (!storage) {
      setError(storageErrors.writeLibrary);
      return false;
    }
    const recovered = parsed.library;
    const persisted = persistLibrary(storage, recovered.scripts, recovered.activeScriptId, {
      trash: recovered.trash,
      customOrder: recovered.customOrder,
      sortMode: recovered.sortMode,
    });
    if ('error' in persisted) {
      setError(persisted.error);
      return false;
    }
    applyLoaded({
      ok: true,
      ...recovered,
      needsMigration: false,
      wasMissing: false,
    });
    setError(null);
    return true;
  }, [applyLoaded]);

  const retryLoadLibrary = useCallback(() => {
    loadCurrentLibrary();
  }, [loadCurrentLibrary]);

  const chooseLibraryDirectory = useCallback(async (): Promise<string | null> => {
    if (nativePickerOpenRef.current) {
      setError('A local library chooser is already open.');
      return null;
    }
    if (recoveryRequiredRef.current) {
      setError('Recover your browser library before choosing a local folder.');
      return null;
    }

    const previousDirectory = nativeDirectoryRef.current;
    const previousReady = nativeReadyRef.current;
    const previousBlocked = nativeAutosaveBlockedRef.current;
    const generation = nativeGenerationRef.current + 1;
    nativeGenerationRef.current = generation;
    nativeSaveSessionRef.current += 1;
    nativePickerOpenRef.current = true;
    if (nativeSaveTimerRef.current !== null) {
      clearTimeout(nativeSaveTimerRef.current);
      nativeSaveTimerRef.current = null;
    }
    setSaveStatus('Choosing a local library…');

    // Wait for an older write before changing the destination. This prevents
    // a queued save from landing in a folder the user has just left.
    await nativeSaveChainRef.current.catch(() => undefined);

    const restorePreviousSelection = (status: string) => {
      nativeSaveSessionRef.current += 1;
      nativePickerOpenRef.current = false;
      nativeDirectoryRef.current = previousDirectory;
      nativeReadyRef.current = previousReady;
      nativeAutosaveBlockedRef.current = previousBlocked;
      setLibraryDirectory(previousDirectory);
      setSaveStatus(status);
      if (previousDirectory && previousReady && !previousBlocked) {
        scheduleNativeSave(serializeScripts(scriptsRef.current));
      }
    };

    try {
      const chosen = await chooseLocalDirectory();
      if (generation !== nativeGenerationRef.current) return null;
      const directory =
        typeof chosen === 'string' && chosen.length > 0 ? chosen : null;
      if (!directory) {
        restorePreviousSelection(
          previousDirectory
            ? 'Previous local library restored'
            : 'No local library selected',
        );
        return null;
      }

      nativeDirectoryRef.current = directory;
      nativeReadyRef.current = true;
      nativeAutosaveBlockedRef.current = false;
      nativePickerOpenRef.current = false;
      setLibraryDirectory(directory);
      setSaveStatus('Saving to local library…');
      try {
        await enqueueNativeSave(
          serializeScripts(scriptsRef.current),
          directory,
          nativeSaveSessionRef.current,
        );
      } catch {
        nativeReadyRef.current = false;
        nativeAutosaveBlockedRef.current = true;
        setSaveStatus(
          'Native save failed — local autosave is blocked; your latest edits are cached locally',
        );
      }
      return directory;
    } catch (chooseError) {
      restorePreviousSelection(
        previousDirectory
          ? 'Could not choose a local library; previous library restored'
          : 'Could not choose a local library',
      );
      setError(current => current ?? describeError(
        chooseError,
        'Could not choose a local library. Your current scripts remain cached locally.',
      ));
      return null;
    }
  }, [enqueueNativeSave, scheduleNativeSave, setSaveStatus]);

  const clearError = useCallback(() => setError(null), []);

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Starting Quickque…
      </div>
    );
  }

  return (
    <StoreContext.Provider value={{
      scripts,
      trash,
      customOrder,
      sortMode,
      settings,
       presentationDefaults,
      activeScriptId,
      setActiveScriptId,
      updateSettings,
       updatePresentationDefaults,
       resetPresentationDefaults,
       updateScriptPresentation,
       resetScriptPresentation,
      createScript,
      updateScript,
      deleteScript,
      deleteScripts,
      restoreScripts,
      permanentlyDeleteScripts,
      duplicateScript,
      setSortMode,
      reorderScripts,
      importScripts,
      importDocument,
      exportScripts,
      recoveryData,
      recoveryRequired,
      recoverLibrary,
      retryLoadLibrary,
      error,
      clearError,
       profile,
       updateProfile,
       libraryDirectory,
       chooseLibraryDirectory,
       localSaveStatus,
    }}>
      {children}
    </StoreContext.Provider>
  );
}
/*
export function StoreProvider({ children }: { children: ReactNode }) {
  const [bootstrap] = useState<BootstrapData>(() => readBootstrapData());
  const [scripts, setScripts] = useState<Script[]>(bootstrap.scripts);
  const [settings, setSettings] = useState<Settings>(bootstrap.settings);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(
    bootstrap.activeScriptId,
  );
  const [profile, setProfile] = useState<Profile>(bootstrap.profile);
  const [libraryDirectory, setLibraryDirectory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(bootstrap.startupError);
  const [localSaveStatus, setLocalSaveStatus] = useState(
    'Loading local library…',
  );

  const profileRef = useRef(profile);
  const scriptsRef = useRef(scripts);
  scriptsRef.current = scripts;
  const localSaveStatusRef = useRef(localSaveStatus);
  localSaveStatusRef.current = localSaveStatus;
  const setSaveStatus = useCallback((status: string) => {
    localSaveStatusRef.current = status;
    setLocalSaveStatus(status);
  }, []);

  const latestScriptsJsonRef = useRef(serializeScripts(scripts));
  const pendingNativeJsonRef = useRef<string | null>(null);
  const pendingNativeDirectoryRef = useRef<string | null>(null);
  const nativeSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const nativeDirectoryRef = useRef<string | null>(null);
  const nativeReadyRef = useRef(false);
  const nativeAutosaveBlockedRef = useRef(false);
  const nativePickerOpenRef = useRef(false);
  const nativeGenerationRef = useRef(0);
  const scriptMutationRevisionRef = useRef(0);
  const firstScriptsEffectRef = useRef(true);
  const skipRecoveryEffectRef = useRef(false);
  const preserveInvalidCacheRef = useRef(false);
  const pendingRecoveryRef = useRef(Boolean(bootstrap.recovery));

  const persistScriptsCache = useCallback(
    (serialized: string, writeRecovery: boolean): boolean => {
      const storage = getStorage();
      if (!storage) {
        setError(
          'Could not save your scripts to local storage. Your latest edits are not protected from a reload.',
        );
        return false;
      }

      try {
        storage.setItem(SCRIPTS_STORAGE_KEY, serialized);
        if (writeRecovery) {
          storage.setItem(
            RECOVERY_STORAGE_KEY,
            JSON.stringify({
              version: 1,
              scriptsJson: serialized,
              updatedAt: Date.now(),
            }),
          );
          pendingRecoveryRef.current = true;
        }
        return true;
      } catch (storageError) {
        setError(
          describeError(
            storageError,
            'Could not save your scripts to local storage. Your latest edits are not protected from a reload.',
          ),
        );
        setSaveStatus('Local recovery save failed');
        return false;
      }
    },
    [],
  );

  const removeRecoveryCopy = useCallback((serialized: string) => {
    if (
      latestScriptsJsonRef.current !== serialized ||
      bootstrap.recoveryInvalid
    ) {
      return;
    }

    const storage = getStorage();
    if (!storage) return;
    try {
      storage.removeItem(RECOVERY_STORAGE_KEY);
      pendingRecoveryRef.current = false;
    } catch (storageError) {
      setError(
        describeError(
          storageError,
          'The native library was saved, but its local recovery copy could not be cleared.',
        ),
      );
    }
  }, [bootstrap.recoveryInvalid]);

  const enqueueNativeSave = useCallback(
    (serialized: string, expectedDirectory: string): Promise<void> => {
      const operation = nativeSaveChainRef.current.then(async () => {
        if (
          nativePickerOpenRef.current ||
          !nativeReadyRef.current ||
          nativeAutosaveBlockedRef.current ||
          !expectedDirectory
        ) {
          return;
        }

        setSaveStatus('Saving to local library…');
        try {
          // The directory is intentionally captured when this operation is
          // enqueued. Reading nativeDirectoryRef here would let a picker
          // retarget an already-queued write.
          await saveLocalLibrary(serialized, expectedDirectory);
          removeRecoveryCopy(serialized);
          if (latestScriptsJsonRef.current === serialized) {
            setSaveStatus('Saved to local library');
            setError(null);
          } else {
            setSaveStatus('Saved an edit; newer changes are waiting');
          }
        } catch (saveError) {
          setSaveStatus(
            'Native save failed — your latest edits are cached locally',
          );
          setError(
            describeError(
              saveError,
              'Could not save scripts to the local library. Your latest edits are cached locally.',
            ),
          );
          throw saveError;
        }
      });

      // A failed save must not poison the serialized queue. The recovery copy
      // remains until a later successful save or an explicit folder choice.
      nativeSaveChainRef.current = operation.catch(() => undefined);
      return operation;
    },
    [removeRecoveryCopy],
  );

  const scheduleNativeSave = useCallback(
    (serialized: string) => {
      pendingNativeJsonRef.current = serialized;
      pendingNativeDirectoryRef.current = nativeDirectoryRef.current;
      if (
        nativePickerOpenRef.current ||
        !nativeReadyRef.current ||
        nativeAutosaveBlockedRef.current ||
        !nativeDirectoryRef.current
      ) {
        return;
      }

      if (nativeSaveTimerRef.current !== null) {
        clearTimeout(nativeSaveTimerRef.current);
      }
      nativeSaveTimerRef.current = setTimeout(() => {
        nativeSaveTimerRef.current = null;
        const pending = pendingNativeJsonRef.current;
        const expectedDirectory = pendingNativeDirectoryRef.current;
        pendingNativeJsonRef.current = null;
        pendingNativeDirectoryRef.current = null;
        if (pending !== null && expectedDirectory !== null) {
          void enqueueNativeSave(pending, expectedDirectory).catch(() => undefined);
        }
      }, AUTOSAVE_DELAY_MS);
    },
    [enqueueNativeSave],
  );

  const commitUserScripts = useCallback((nextScripts: Script[]) => {
    scriptMutationRevisionRef.current += 1;
    scriptsRef.current = nextScripts;
    const serialized = serializeScripts(nextScripts);
    latestScriptsJsonRef.current = serialized;
    // Persist the recovery copy synchronously with the mutation, before
    // React can yield to a delayed native hydration response.
    persistScriptsCache(serialized, true);
    setScripts(nextScripts);
  }, [persistScriptsCache]);

  useEffect(() => {
    const serialized = serializeScripts(scripts);
    latestScriptsJsonRef.current = serialized;

    const firstEffect = firstScriptsEffectRef.current;
    firstScriptsEffectRef.current = false;
    const skipRecovery = skipRecoveryEffectRef.current;
    skipRecoveryEffectRef.current = false;
    const preserveInvalidCache = preserveInvalidCacheRef.current;
    preserveInvalidCacheRef.current = false;

    // Never replace a malformed cache just because hydration happened. A
    // valid native library may repair it later; a user edit may intentionally
    // replace it.
    const shouldWriteCache = !(firstEffect && bootstrap.cacheInvalid) && !preserveInvalidCache;
    if (shouldWriteCache) {
      persistScriptsCache(serialized, !firstEffect && !skipRecovery);
    }
    scheduleNativeSave(serialized);
  }, [
    bootstrap.cacheInvalid,
    persistScriptsCache,
    scheduleNativeSave,
    scripts,
  ]);

  useEffect(() => {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle('dark', settings.darkTheme);
      }
    } catch (settingsError) {
      setError(describeError(settingsError, 'Failed to save settings.'));
    }
  }, [settings]);

  useEffect(() => {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(ACTIVE_SCRIPT_STORAGE_KEY, activeScriptId ?? '');
    } catch {
      // An active selection is disposable and should not block editing.
    }
  }, [activeScriptId]);

  useEffect(() => {
    const storage = getStorage();
    if (!storage) return;
    try {
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    } catch (profileError) {
      setError(
        describeError(
          profileError,
          'Could not save your profile. Onboarding changes may not survive a reload.',
        ),
      );
    }
  }, [profile]);

  useEffect(() => {
    if (
      activeScriptId !== null &&
      scripts.some((script) => script.id === activeScriptId)
    ) {
      return;
    }
    setActiveScriptId(scripts[0]?.id ?? null);
  }, [activeScriptId, scripts]);

  useEffect(() => {
    const generation = ++nativeGenerationRef.current;
    const hydrationRevision = scriptMutationRevisionRef.current;
    let cancelled = false;

    const adoptScripts = (nextScripts: Script[], writeCache: boolean) => {
      const serialized = serializeScripts(nextScripts);
      const changed = serialized !== latestScriptsJsonRef.current;
      latestScriptsJsonRef.current = serialized;
      if (changed) {
        scriptsRef.current = nextScripts;
        skipRecoveryEffectRef.current = true;
        setScripts(nextScripts);
      }
      if (writeCache) {
        persistScriptsCache(serialized, false);
      }
      return serialized;
    };

    const cachedFallback = (): Script[] => {
      if (bootstrap.recovery) return bootstrap.recovery.scripts;
      if (bootstrap.cacheValid) return scriptsRef.current;
      return [];
    };

    const showNativeLoadError = (message: string) => {
      nativeReadyRef.current = false;
      nativeAutosaveBlockedRef.current = true;
      const fallback =
        scriptMutationRevisionRef.current !== hydrationRevision
          ? scriptsRef.current
          : cachedFallback();
      if (serializeScripts(fallback) !== latestScriptsJsonRef.current) {
        preserveInvalidCacheRef.current = bootstrap.cacheInvalid;
        adoptScripts(fallback, false);
      }
      setError(message);
      setSaveStatus(message);
    };

    const loadNativeLibrary = async () => {
      setSaveStatus('Loading local library…');
      try {
        const loaded = await getLocalLibrary();
        if (cancelled || generation !== nativeGenerationRef.current) return;

        const directory =
          typeof loaded.directory === 'string' && loaded.directory.length > 0
            ? loaded.directory
            : null;
        setLibraryDirectory(directory);
        nativeDirectoryRef.current = directory;

        if (!directory) {
          nativeReadyRef.current = false;
          nativeAutosaveBlockedRef.current = false;
          setSaveStatus(
            bootstrap.cacheInvalid
              ? 'Using cached scripts; local recovery needs attention'
              : 'No local library selected',
          );
          return;
        }

        const nativeScripts =
          loaded.scriptsJson === null
            ? null
            : parseScriptsJson(loaded.scriptsJson);
        if (loaded.scriptsJson !== null && nativeScripts === null) {
          showNativeLoadError(
            'The selected local library is invalid. Your cached scripts are shown; reselect the folder to resume native saves.',
          );
          return;
        }

        nativeAutosaveBlockedRef.current = false;
        nativeReadyRef.current = true;
        const userEditedWhileLoading =
          scriptMutationRevisionRef.current !== hydrationRevision;

        // A recovery copy is newer than the last native save. Keep it and
        // immediately queue it for the confirmed, valid native directory.
        const recovery =
          !userEditedWhileLoading && bootstrap.recovery
            ? bootstrap.recovery
            : null;
        if (recovery) {
          const serialized = adoptScripts(recovery.scripts, false);
          pendingRecoveryRef.current = true;
          void enqueueNativeSave(serialized, directory).catch(() => undefined);
          return;
        }

        if (nativeScripts) {
          const decision = resolveNativeHydration(
            hydrationRevision,
            scriptMutationRevisionRef.current,
            scriptsRef.current,
            nativeScripts,
          );
          if (decision.source === 'local') {
            scheduleNativeSave(serializeScripts(decision.scripts));
            return;
          }
          const serialized = adoptScripts(decision.scripts, true);
          // A valid native file is authoritative unless a recovery edit won.
          pendingNativeJsonRef.current = null;
          setSaveStatus('Loaded local library');
          latestScriptsJsonRef.current = serialized;
          return;
        }

        // A selected folder without a scripts file is an empty, valid native
        // library. Seed only for a genuinely new install, or preserve a valid
        // local cache when one already exists.
        const serialized = latestScriptsJsonRef.current;
        // Keep a durable recovery copy before the first write to an empty
        // folder. This also protects an existing cache if that write fails.
        persistScriptsCache(serialized, true);
        pendingNativeJsonRef.current = serialized;
        void enqueueNativeSave(serialized, directory).catch(() => undefined);
      } catch (loadError) {
        if (cancelled || generation !== nativeGenerationRef.current) return;
        setLibraryDirectory(null);
        nativeDirectoryRef.current = null;
        showNativeLoadError(
          describeError(
            loadError,
            'Could not access the selected local library. Your cached scripts are shown; reselect the folder to resume native saves.',
          ),
        );
      }
    };

    void loadNativeLibrary();
    return () => {
      cancelled = true;
    };
  }, [
    bootstrap.cacheInvalid,
    bootstrap.cacheValid,
    bootstrap.recovery,
    enqueueNativeSave,
    persistScriptsCache,
    scheduleNativeSave,
  ]);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings((previous) => ({ ...previous, ...newSettings }));
  }, []);

  const createScript = useCallback(() => {
    const newId = generateId();
    const now = Date.now();
    const newScript: Script = {
      id: newId,
      title: 'Untitled Script',
      createdAt: now,
      updatedAt: now,
      sections: [
        {
          id: generateId(),
          title: 'Section 1',
          content: '',
        },
      ],
    };
    commitUserScripts([newScript, ...scriptsRef.current]);
    setActiveScriptId(newId);
    return newId;
  }, [commitUserScripts]);

  const updateScript = useCallback(
    (
      id: string,
      updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt'>>,
    ) => {
      let changed = false;
      const nextScripts = scriptsRef.current.map((script) => {
        if (script.id !== id) return script;
        changed = true;
        return { ...script, ...updates, updatedAt: Date.now() };
      });
      if (changed) {
        commitUserScripts(nextScripts);
      }
    },
    [commitUserScripts],
  );

  const deleteScript = useCallback(
    (id: string) => {
      const nextScripts = scriptsRef.current.filter((script) => script.id !== id);
      if (nextScripts.length === scriptsRef.current.length) return;
      commitUserScripts(nextScripts);
      if (activeScriptId === id) {
        setActiveScriptId(null);
      }
    },
    [activeScriptId, commitUserScripts],
  );

  const duplicateScript = useCallback(
    (id: string) => {
      const scriptToDuplicate = scriptsRef.current.find((script) => script.id === id);
      if (!scriptToDuplicate) return null;

      const newId = generateId();
      const now = Date.now();
      const newScript: Script = {
        ...scriptToDuplicate,
        id: newId,
        title: `${scriptToDuplicate.title} (Copy)`,
        createdAt: now,
        updatedAt: now,
        sections: scriptToDuplicate.sections.map((section) => ({
          ...section,
          id: generateId(),
        })),
      };

      commitUserScripts([newScript, ...scriptsRef.current]);
      setActiveScriptId(newId);
      return newId;
    },
    [commitUserScripts],
  );

  const importScripts = useCallback((data: string) => {
    const parsed = parseImportJson(data);
    if (!parsed || !isImportableScripts(parsed)) {
      setError('Could not import scripts: the file is invalid.');
      return false;
    }

    const imported: Script[] = parsed.map((script: ImportableScript) => ({
      ...script,
      id: generateId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: script.sections.map((section) => ({
        ...section,
        id: generateId(),
      })),
    }));
    if (imported.length > 0) {
      commitUserScripts([...imported, ...scriptsRef.current]);
    }
    return true;
  }, [commitUserScripts]);

  const exportScripts = useCallback(() => {
    return JSON.stringify(scripts, null, 2);
  }, [scripts]);

  const updateProfile = useCallback((updates: Partial<Profile>): boolean => {
    const current = profileRef.current;
    const next: Profile = {
      name: updates.name ?? current.name,
      onboardingComplete:
        updates.onboardingComplete ?? current.onboardingComplete,
    };
    if (
      typeof next.name !== 'string' ||
      typeof next.onboardingComplete !== 'boolean'
    ) {
      setError('Could not save your profile: the profile data is invalid.');
      return false;
    }

    const storage = getStorage();
    if (!storage) {
      setError('Could not save your profile: local storage is unavailable.');
      return false;
    }
    try {
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(next));
    } catch (profileError) {
      setError(
        describeError(
          profileError,
          'Could not save your profile. Onboarding changes may not survive a reload.',
        ),
      );
      return false;
    }

    profileRef.current = next;
    setProfile(next);
    return true;
  }, []);

  const chooseLibraryDirectory = useCallback(async (): Promise<string | null> => {
    if (nativePickerOpenRef.current) {
      setError('A local library chooser is already open.');
      return null;
    }

    const previousDirectory = nativeDirectoryRef.current;
    const previousReady = nativeReadyRef.current;
    const previousBlocked = nativeAutosaveBlockedRef.current;
    const previousStatus = localSaveStatusRef.current;
    const previousLibraryDirectory = previousDirectory;
    const previousGeneration = nativeGenerationRef.current;
    let selectionStatus = previousStatus;
    const generation = previousGeneration + 1;

    nativePickerOpenRef.current = true;
    nativeGenerationRef.current = generation;
    // Preserve the newest payload while the picker is open, but never allow
    // its debounce timer to enqueue a write during the picker interaction.
    if (nativeSaveTimerRef.current !== null) {
      clearTimeout(nativeSaveTimerRef.current);
      nativeSaveTimerRef.current = null;
    }
    pendingNativeJsonRef.current = latestScriptsJsonRef.current;
    pendingNativeDirectoryRef.current = previousDirectory;
    setSaveStatus('Preparing local library selection…');
    // Do not let an old in-flight save race a newly selected folder.
    await nativeSaveChainRef.current.catch(() => undefined);
    selectionStatus = localSaveStatusRef.current;

    setSaveStatus('Choosing a local library…');

    const restorePreviousSelection = (status = selectionStatus) => {
      nativePickerOpenRef.current = false;
      nativeGenerationRef.current = generation;
      nativeDirectoryRef.current = previousDirectory;
      nativeReadyRef.current = previousReady;
      nativeAutosaveBlockedRef.current = previousBlocked;
      setLibraryDirectory(previousLibraryDirectory);
      pendingNativeJsonRef.current = latestScriptsJsonRef.current;
      pendingNativeDirectoryRef.current = previousDirectory;

      if (previousDirectory && previousReady && !previousBlocked) {
        setSaveStatus('Resuming save to local library…');
        scheduleNativeSave(latestScriptsJsonRef.current);
      } else {
        setSaveStatus(status);
      }
    };

    try {
      const chosen = await chooseLocalDirectory();
      if (generation !== nativeGenerationRef.current) return null;
      const directory =
        typeof chosen === 'string' && chosen.length > 0 ? chosen : null;
      if (!directory) {
        restorePreviousSelection();
        return null;
      }

      nativeDirectoryRef.current = directory;
      nativeAutosaveBlockedRef.current = false;
      nativeReadyRef.current = true;
      nativePickerOpenRef.current = false;
      setLibraryDirectory(directory);
      const serialized = serializeScripts(scriptsRef.current);
      latestScriptsJsonRef.current = serialized;
      pendingRecoveryRef.current = true;
      // Persist the recovery copy before attempting the first save to a new
      // folder, so a failed selection can never lose the current edits.
      persistScriptsCache(serialized, true);

      try {
        await enqueueNativeSave(serialized, directory);
      } catch {
        // The selected folder may be nonempty or may have failed access.
        // Keep it visible but explicitly blocked; recovery remains local.
        nativeReadyRef.current = false;
        nativeAutosaveBlockedRef.current = true;
        setSaveStatus(
          'Native save failed — local autosave is blocked; your latest edits are cached locally',
        );
      }
      return directory;
    } catch (chooseError) {
      restorePreviousSelection(
        previousDirectory && previousReady && !previousBlocked
          ? 'Could not choose a local library; previous library restored'
          : 'Could not choose a local library',
      );
      setError(
        describeError(
          chooseError,
          'Could not choose a local library. Your current scripts remain cached locally.',
        ),
      );
      return null;
    }
  }, [enqueueNativeSave, persistScriptsCache]);

  const clearError = useCallback(() => setError(null), []);

  return (
    <StoreContext.Provider
      value={{
        scripts,
        settings,
        activeScriptId,
        setActiveScriptId,
        updateSettings,
        createScript,
        updateScript,
        deleteScript,
        duplicateScript,
        importScripts,
        exportScripts,
        error,
        clearError,
        profile,
        updateProfile,
        libraryDirectory,
        chooseLibraryDirectory,
        localSaveStatus,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}
*/

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

const SCRIPTS_STORAGE_KEY = 'quickque_scripts';

function appendStartupError(current: string | null, next: string): string {
  return current ? `${current} ${next}` : next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const DEFAULT_PROFILE: Profile = {
  name: '',
  onboardingComplete: false,
};

function readStoredProfile(): Profile {
  const storage = getStorage();
  if (!storage) return DEFAULT_PROFILE;
  try {
    const stored = storage.getItem(PROFILE_STORAGE_KEY);
    if (stored === null) return DEFAULT_PROFILE;
    const parsed: unknown = JSON.parse(stored);
    if (
      isRecord(parsed) &&
      typeof parsed.name === 'string' &&
      typeof parsed.onboardingComplete === 'boolean'
    ) {
      return {
        name: parsed.name,
        onboardingComplete: parsed.onboardingComplete,
      };
    }
  } catch {
    // Invalid profile data is isolated from the transactional library.
  }
  return DEFAULT_PROFILE;
}

function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}

function readBootstrapData(): BootstrapData {
  const storage = getStorage();
  const firstInstallScripts = createInitialScripts();
  let scripts = firstInstallScripts;
  let cacheWasMissing = true;
  let cacheValid = false;
  let cacheInvalid = false;
  let recovery: ReturnType<typeof parseRecoveryJson> = null;
  let recoveryInvalid = false;
  let startupError: string | null = null;

  if (!storage) {
    startupError =
      'Local storage is unavailable. Your changes will not survive a reload until storage is enabled.';
  } else {
    try {
      const storedScripts = storage.getItem(SCRIPTS_STORAGE_KEY);
      cacheWasMissing = storedScripts === null;
      if (storedScripts === null) {
        // A truly new installation gets exactly one document. A malformed
        // existing cache gets no replacement seed.
        scripts = firstInstallScripts;
      } else {
        const parsedScripts = parseScriptsJson(storedScripts);
        if (parsedScripts) {
          scripts = parsedScripts;
          cacheValid = true;
        } else {
          scripts = [];
          cacheInvalid = true;
          startupError =
            'Your cached scripts are invalid. Existing native data was left untouched while recovery is attempted.';
        }
      }

      const storedRecovery = storage.getItem(RECOVERY_STORAGE_KEY);
      if (storedRecovery !== null) {
        recovery = parseRecoveryJson(storedRecovery);
        if (!recovery) {
          recoveryInvalid = true;
          startupError = appendStartupError(
            startupError,
            'An unsaved local recovery copy is invalid and was left untouched.',
          );
        }
      }
    } catch {
      scripts = [];
      cacheWasMissing = false;
      cacheInvalid = true;
      startupError = appendStartupError(
        startupError,
        'Quickque could not read its cached scripts. Existing data was left untouched.',
      );
    }
  }

  let profile = DEFAULT_PROFILE;
  if (storage) {
    try {
      const storedProfile = storage.getItem(PROFILE_STORAGE_KEY);
      if (storedProfile !== null) {
        const parsedProfile: unknown = JSON.parse(storedProfile);
        if (
          isRecord(parsedProfile) &&
          typeof parsedProfile.name === 'string' &&
          typeof parsedProfile.onboardingComplete === 'boolean'
        ) {
          profile = {
            name: parsedProfile.name,
            onboardingComplete: parsedProfile.onboardingComplete,
          };
        } else {
          startupError = appendStartupError(
            startupError,
            'Your profile data is invalid; onboarding is available again.',
          );
        }
      }
    } catch {
      startupError = appendStartupError(
        startupError,
        'Your profile data could not be read; onboarding is available again.',
      );
    }
  }

  let settings = DEFAULT_SETTINGS;
  if (storage) {
    try {
      settings = loadSettings(storage);
    } catch {
      // Defaults are safe for settings. Scripts and profile errors remain
      // explicit because silently replacing those can hide data loss.
    }
  }

  let activeScriptId: string | null = null;
  if (storage) {
    try {
      activeScriptId = storage.getItem(ACTIVE_SCRIPT_STORAGE_KEY);
    } catch {
      // The active selection is disposable, unlike scripts.
    }
  }
  if (!activeScriptId && scripts.length > 0) {
    activeScriptId = scripts[0].id;
  }

  return {
    scripts,
    cacheWasMissing,
    cacheValid,
    cacheInvalid,
    recovery,
    recoveryInvalid,
    profile,
    settings,
    activeScriptId,
    startupError,
  };
}

const SETTINGS_STORAGE_KEY = 'quickque_settings';

const AUTOSAVE_DELAY_MS = 350;

const ACTIVE_SCRIPT_STORAGE_KEY = 'quickque_active_script';

type BootstrapData = {
  scripts: Script[];
  cacheWasMissing: boolean;
  cacheValid: boolean;
  cacheInvalid: boolean;
  recovery: ReturnType<typeof parseRecoveryJson>;
  recoveryInvalid: boolean;
  profile: Profile;
  settings: Settings;
  activeScriptId: string | null;
  startupError: string | null;
};

export type Profile = {
  name: string;
  onboardingComplete: boolean;
};

const PROFILE_STORAGE_KEY = 'quickque_profile';

const RECOVERY_STORAGE_KEY = 'quickque_scripts_recovery';

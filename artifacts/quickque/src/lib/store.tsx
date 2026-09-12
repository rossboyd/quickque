import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  ReactNode,
} from 'react';
import { Script, Settings, DEFAULT_SETTINGS, DeletedScript, SortMode } from './types';
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

const SEED_SCRIPTS: Script[] = [
  {
    id: 'seed-1',
    title: 'Welcome to Quickque',
    createdAt: Date.now() - 3000,
    updatedAt: Date.now() - 3000,
    sections: [
      {
        id: 'seed-1-s1',
        title: 'Introduction',
        content: 'Welcome to Quickque. This is a personal teleprompter designed for live meetings.\n\nIt helps you stay on track while presenting, without feeling like you are reading a script.'
      },
      {
        id: 'seed-1-s2',
        title: 'Key Features',
        content: "If you need to pause for an interruption, just press the Space bar.\n\nYou won't lose your place. A clear marker shows exactly where you left off.\n\nUse the left and right arrow keys to jump between sections."
      },
      {
        id: 'seed-1-s3',
        title: 'Desktop Mode',
        content: 'If you are using the desktop app, you can enable compact overlay mode. This lets Quickque float above your other windows, like Zoom or Google Meet, with a transparent background.'
      }
    ]
  },
  {
    id: 'seed-2',
    title: 'Weekly Team Update',
    createdAt: Date.now() - 2000,
    updatedAt: Date.now() - 2000,
    sections: [
      {
        id: 'seed-2-s1',
        title: 'Opening',
        content: "Hi everyone, thanks for joining the weekly sync.\n\nLet's dive right into our metrics for the past week."
      },
      {
        id: 'seed-2-s2',
        title: 'Metrics',
        content: 'Engagement is up by fifteen percent across all major channels.\n\nOur new onboarding flow seems to be the primary driver for this increase.'
      },
      {
        id: 'seed-2-s3',
        title: 'Blockers & Q&A',
        content: 'The only major blocker right now is the database migration scheduled for Thursday.\n\nDoes anyone have questions about the migration timeline or the metrics?'
      }
    ]
  },
  {
    id: 'seed-3',
    title: 'Product Walkthrough',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    sections: [
      {
        id: 'seed-3-s1',
        title: 'Context',
        content: "Today I'm going to walk you through the new dashboard interface.\n\nWe've completely redesigned the layout based on your feedback."
      },
      {
        id: 'seed-3-s2',
        title: 'Navigation Changes',
        content: 'Notice how the main navigation has moved from the top bar to the left sidebar.\n\nThis gives us more vertical space for your data and allows for nested menus.'
      },
      {
        id: 'seed-3-s3',
        title: 'Next Steps',
        content: "I'll share a link to this prototype after the meeting.\n\nPlease take some time to click around and leave comments directly in the file."
      }
    ]
  }
];

type StoreContextType = {
  scripts: Script[];
  trash: DeletedScript[];
  customOrder: string[];
  sortMode: SortMode;
  settings: Settings;
  activeScriptId: string | null;
  setActiveScriptId: (id: string | null) => void;
  updateSettings: (newSettings: Partial<Settings>) => void;
  createScript: () => string;
  updateScript: (id: string, updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt'>>) => void;
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
};

const StoreContext = createContext<StoreContextType | null>(null);

type ImportDocumentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

type LibrarySnapshot = LibraryState;

function getLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function cloneScript(script: Script): Script {
  return {
    ...script,
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
  const [activeScriptId, setActiveScriptState] = useState<string | null>(null);
  const [recoveryData, setRecoveryData] = useState<string | null>(null);
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const scriptsRef = useRef<Script[]>([]);
  const trashRef = useRef<DeletedScript[]>([]);
  const customOrderRef = useRef<string[]>([]);
  const sortModeRef = useRef<SortMode>('custom');
  const activeScriptIdRef = useRef<string | null>(null);
  const recoveryRequiredRef = useRef(false);
  const storageRef = useRef<StorageLike | null>(null);
  const savesDisabledRef = useRef(false);

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
    setError(null);
  }, []);

  const loadCurrentLibrary = useCallback(() => {
    // Retry may happen after the host has restored localStorage or after a
    // transient permission error. Always reacquire the host storage handle.
    storageRef.current = getLocalStorage();
    const storage = storageRef.current;
    if (!storage) {
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
      setError(storageErrors.readLibrary);
      return;
    }

    let raw: string | null = null;
    try {
      raw = storage.getItem('quickque_scripts');
    } catch {
      // loadLibrary supplies the user-facing read error.
    }
    const loaded = loadLibrary(storage, SEED_SCRIPTS);
    if ('error' in loaded) {
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
      setError(loaded.error);
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
      if ('error' in persisted) setError(persisted.error);
    }
  }, [applyLoaded]);

  useEffect(() => {
    storageRef.current = getLocalStorage();
    loadCurrentLibrary();

    const storage = storageRef.current;
    if (storage) {
      try {
        const storedSettings = storage.getItem('quickque_settings');
        if (storedSettings) {
          const parsedSettings = JSON.parse(storedSettings);
          if (parsedSettings && typeof parsedSettings === 'object') {
            const loadedSettings = { ...DEFAULT_SETTINGS, ...parsedSettings };
            settingsRef.current = loadedSettings;
            setSettings(loadedSettings);
          }
        }
      } catch {
        setError('Failed to load settings.');
      }
    }
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
      current === 'Failed to save settings.' || current === 'Failed to load settings.'
        ? current
        : null
    ));
    return { ok: true as const };
  }, []);

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
    const nextSettings = { ...settingsRef.current, ...newSettings };
    try {
      storage.setItem('quickque_settings', JSON.stringify(nextSettings));
    } catch {
      // Do not publish a setting that did not reach durable storage.
      setError('Failed to save settings.');
      return;
    }
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setError(current => (
      current === 'Failed to save settings.' || current === 'Failed to load settings.'
        ? null
        : current
    ));
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
    updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt'>>,
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
    const parsed = parseLibraryData(data);
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
    const parsed = parseLibraryData(data);
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

  const clearError = useCallback(() => setError(null), []);

  if (!isLoaded) return null;

  return (
    <StoreContext.Provider value={{
      scripts,
      trash,
      customOrder,
      sortMode,
      settings,
      activeScriptId,
      setActiveScriptId,
      updateSettings,
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
    }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}
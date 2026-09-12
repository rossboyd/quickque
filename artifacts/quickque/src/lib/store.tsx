import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  ReactNode,
} from 'react';
import { Script, Settings, DEFAULT_SETTINGS } from './types';
import { generateId } from './utils';
import {
  collectScriptIds,
  createDocumentScript,
  isValidScript,
  loadLibrary,
  persistLibrary,
  storageErrors,
  StorageLike,
} from './store-persistence';

const SEED_SCRIPTS: Script[] = [
  {
    id: 'seed-1',
    title: 'Welcome to Quickque',
    createdAt: Date.now() - 3000,
    updatedAt: Date.now() - 3000,
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
  },
  {
    id: 'seed-2',
    title: 'Weekly Team Update',
    createdAt: Date.now() - 2000,
    updatedAt: Date.now() - 2000,
    sections: [
      {
        id: 's1',
        title: 'Opening',
        content: "Hi everyone, thanks for joining the weekly sync.\n\nLet's dive right into our metrics for the past week."
      },
      {
        id: 's2',
        title: 'Metrics',
        content: 'Engagement is up by fifteen percent across all major channels.\n\nOur new onboarding flow seems to be the primary driver for this increase.'
      },
      {
        id: 's3',
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
        id: 's1',
        title: 'Context',
        content: "Today I'm going to walk you through the new dashboard interface.\n\nWe've completely redesigned the layout based on your feedback."
      },
      {
        id: 's2',
        title: 'Navigation Changes',
        content: 'Notice how the main navigation has moved from the top bar to the left sidebar.\n\nThis gives us more vertical space for your data and allows for nested menus.'
      },
      {
        id: 's3',
        title: 'Next Steps',
        content: "I'll share a link to this prototype after the meeting.\n\nPlease take some time to click around and leave comments directly in the file."
      }
    ]
  }
];

type StoreContextType = {
  scripts: Script[];
  settings: Settings;
  activeScriptId: string | null;
  setActiveScriptId: (id: string | null) => void;
  updateSettings: (newSettings: Partial<Settings>) => void;
  createScript: () => string;
  updateScript: (id: string, updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt'>>) => void;
  deleteScript: (id: string) => void;
  duplicateScript: (id: string) => string | null;
  importScripts: (data: string) => boolean;
  importDocument: (title: string, text: string) => ImportDocumentResult;
  exportScripts: () => string;
  error: string | null;
  clearError: () => void;
};

const StoreContext = createContext<StoreContextType | null>(null);

type ImportDocumentResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

function getLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
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
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeScriptId, setActiveScriptState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const scriptsRef = useRef<Script[]>([]);
  const activeScriptIdRef = useRef<string | null>(null);
  const storageRef = useRef<StorageLike | null>(null);
  const savesDisabledRef = useRef(false);

  useEffect(() => {
    const storage = getLocalStorage();
    storageRef.current = storage;

    if (!storage) {
      scriptsRef.current = SEED_SCRIPTS;
      activeScriptIdRef.current = SEED_SCRIPTS[0]?.id ?? null;
      setScripts(SEED_SCRIPTS);
      setActiveScriptState(SEED_SCRIPTS[0]?.id ?? null);
      savesDisabledRef.current = true;
      setError('Failed to load your scripts. Your existing data was left untouched.');
    } else {
      const loaded = loadLibrary(storage, SEED_SCRIPTS);
      if (!loaded.ok) {
        // Do not attempt a repair write here. The original malformed bytes
        // remain available for manual recovery, and all library saves stay
        // disabled until the provider is reloaded with valid data.
        scriptsRef.current = SEED_SCRIPTS;
        activeScriptIdRef.current = SEED_SCRIPTS[0]?.id ?? null;
        setScripts(SEED_SCRIPTS);
        setActiveScriptState(SEED_SCRIPTS[0]?.id ?? null);
        savesDisabledRef.current = true;
        setError(loaded.error);
      } else {
        scriptsRef.current = loaded.scripts;
        activeScriptIdRef.current = loaded.activeScriptId;
        setScripts(loaded.scripts);
        setActiveScriptState(loaded.activeScriptId);

        if (loaded.needsMigration || loaded.wasMissing) {
          // Migration and first-run seeding are deliberately performed before
          // exposing any write-capable library actions.
          const persisted = persistLibrary(
            storage,
            loaded.scripts,
            loaded.activeScriptId,
          );
          if (!persisted.ok) {
            // A quota/permission failure is retryable. Only unreadable or
            // malformed stored data disables saves to prevent clobbering it.
            setError(persisted.error);
          }
        }
      }

      try {
        const storedSettings = storage.getItem('quickque_settings');
        if (storedSettings) {
          const parsedSettings = JSON.parse(storedSettings);
          if (parsedSettings && typeof parsedSettings === 'object') {
            setSettings({ ...DEFAULT_SETTINGS, ...parsedSettings });
          }
        }
      } catch {
        // Settings are independent from the script library. Keep defaults if
        // their optional storage entry is unreadable.
        setError('Failed to load settings.');
      }
    }

    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    const storage = storageRef.current;
    if (!storage) return;
    try {
      storage.setItem('quickque_settings', JSON.stringify(settings));

      // Apply dark mode to document
      if (settings.darkTheme) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch {
      setError('Failed to save settings.');
    }
  }, [settings, isLoaded]);

  const commitLibrary = useCallback((nextScripts: Script[], nextActiveScriptId: string | null) => {
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

    const persisted = persistLibrary(storage, nextScripts, nextActiveScriptId);
    if (!persisted.ok) {
      // Neither ref nor React state is changed on a failed write. This keeps
      // memory and the last durable envelope in lockstep.
      setError(persisted.error);
      return persisted;
    }

    scriptsRef.current = nextScripts;
    activeScriptIdRef.current = nextActiveScriptId;
    setScripts(nextScripts);
    setActiveScriptState(nextActiveScriptId);
    setError(current => current === storageErrors.writeLibrary ? null : current);
    return { ok: true as const };
  }, []);

  const setActiveScriptId = useCallback((id: string | null) => {
    if (
      id !== null &&
      !scriptsRef.current.some(script => script.id === id)
    ) {
      setError('The selected script no longer exists.');
      return;
    }
    commitLibrary(scriptsRef.current, id);
  }, [commitLibrary]);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const createScript = useCallback(() => {
    const usedIds = collectScriptIds(scriptsRef.current);
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
      sections: [
        {
          id: sectionId,
          title: 'Section 1',
          content: ''
        }
      ]
    };
    return commitLibrary(
      [newScript, ...scriptsRef.current],
      newId,
    ).ok ? newId : '';
  }, [commitLibrary]);

  const updateScript = useCallback((id: string, updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt'>>) => {
    const currentScripts = scriptsRef.current;
    if (!currentScripts.some(script => script.id === id)) return;

    const nextScripts = currentScripts.map(script => {
      if (script.id !== id) return script;
      return { ...script, ...updates, updatedAt: Date.now() };
    });
    commitLibrary(nextScripts, activeScriptIdRef.current);
  }, [commitLibrary]);

  const deleteScript = useCallback((id: string) => {
    const currentScripts = scriptsRef.current;
    if (!currentScripts.some(script => script.id === id)) return;

    const nextActiveId = activeScriptIdRef.current === id
      ? null
      : activeScriptIdRef.current;
    commitLibrary(
      currentScripts.filter(script => script.id !== id),
      nextActiveId,
    );
  }, [commitLibrary]);

  const duplicateScript = useCallback((id: string) => {
    const scriptToDup = scriptsRef.current.find(script => script.id === id);
    if (!scriptToDup) return null;

    const usedIds = collectScriptIds(scriptsRef.current);
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
      title: `${scriptToDup.title} (Copy)`,
      createdAt: now,
      updatedAt: now,
      sections: newSections as Script['sections'],
    };

    return commitLibrary(
      [newScript, ...scriptsRef.current],
      newId,
    ).ok ? newId : null;
  }, [commitLibrary]);

  const importScripts = useCallback((data: string) => {
    try {
      const parsed: unknown = JSON.parse(data);
      if (!Array.isArray(parsed) || !parsed.every(isValidScript)) {
        return false;
      }

      const usedIds = collectScriptIds(scriptsRef.current);
      const now = Date.now();
      const imported: Script[] = [];
      for (const script of parsed) {
        const newId = freshId(usedIds);
        if (!newId) return false;
        const sections: Script['sections'] = [];
        for (const section of script.sections) {
          const sectionId = freshId(usedIds);
          if (!sectionId) return false;
          sections.push({ ...section, id: sectionId });
        }
        imported.push({
          ...script,
          id: newId,
          createdAt: now,
          updatedAt: now,
          sections,
        });
      }

      return commitLibrary(
        [...imported, ...scriptsRef.current],
        activeScriptIdRef.current,
      ).ok;
    } catch {
      return false;
    }
  }, [commitLibrary]);

  const importDocument = useCallback((title: string, text: string): ImportDocumentResult => {
    const document = createDocumentScript(
      title,
      text,
      collectScriptIds(scriptsRef.current),
    );
    if (!document.ok) return document;

    const persisted = commitLibrary(
      [document.script, ...scriptsRef.current],
      document.script.id,
    );
    if (!persisted.ok) return persisted;
    return { ok: true, id: document.script.id };
  }, [commitLibrary]);

  const exportScripts = useCallback(() => {
    // Backups intentionally remain the historical bare Script[] format.
    return JSON.stringify(scriptsRef.current, null, 2);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  if (!isLoaded) return null;

  return (
    <StoreContext.Provider value={{
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
      importDocument,
      exportScripts,
      error,
      clearError
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
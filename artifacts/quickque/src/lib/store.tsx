import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { Script, Settings, DEFAULT_SETTINGS } from './types';
import { generateId } from './utils';

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
  exportScripts: () => string;
  error: string | null;
  clearError: () => void;
};

const StoreContext = createContext<StoreContextType | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [activeScriptId, setActiveScriptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    try {
      const storedScripts = localStorage.getItem('quickque_scripts');
      if (storedScripts) {
        setScripts(JSON.parse(storedScripts));
      } else {
        setScripts(SEED_SCRIPTS);
        localStorage.setItem('quickque_scripts', JSON.stringify(SEED_SCRIPTS));
      }

      const storedSettings = localStorage.getItem('quickque_settings');
      if (storedSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(storedSettings) });
      }

      const storedActiveId = localStorage.getItem('quickque_active_script');
      if (storedActiveId) {
        setActiveScriptId(storedActiveId);
      } else {
        setActiveScriptId(SEED_SCRIPTS[0].id);
      }
    } catch (err) {
      console.error('Failed to load from local storage', err);
      setError('Failed to load your data. You may be in private browsing mode.');
      setScripts(SEED_SCRIPTS);
      setActiveScriptId(SEED_SCRIPTS[0].id);
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem('quickque_scripts', JSON.stringify(scripts));
    } catch (err) {
      setError('Failed to save scripts. Your changes may be lost on reload.');
    }
  }, [scripts, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      localStorage.setItem('quickque_settings', JSON.stringify(settings));
      
      // Apply dark mode to document
      if (settings.darkTheme) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      
    } catch (err) {
      setError('Failed to save settings.');
    }
  }, [settings, isLoaded]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      if (activeScriptId) {
        localStorage.setItem('quickque_active_script', activeScriptId);
      } else {
        localStorage.removeItem('quickque_active_script');
      }
    } catch (err) {
      // ignore
    }
  }, [activeScriptId, isLoaded]);

  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  }, []);

  const createScript = useCallback(() => {
    const newId = generateId();
    const newScript: Script = {
      id: newId,
      title: 'Untitled Script',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: [
        {
          id: generateId(),
          title: 'Section 1',
          content: ''
        }
      ]
    };
    setScripts(prev => [newScript, ...prev]);
    setActiveScriptId(newId);
    return newId;
  }, []);

  const updateScript = useCallback((id: string, updates: Partial<Omit<Script, 'id' | 'createdAt' | 'updatedAt'>>) => {
    setScripts(prev => prev.map(s => {
      if (s.id !== id) return s;
      return { ...s, ...updates, updatedAt: Date.now() };
    }));
  }, []);

  const deleteScript = useCallback((id: string) => {
    setScripts(prev => prev.filter(s => s.id !== id));
    if (activeScriptId === id) {
      setActiveScriptId(null);
    }
  }, [activeScriptId]);

  const duplicateScript = useCallback((id: string) => {
    const scriptToDup = scripts.find(s => s.id === id);
    if (!scriptToDup) return null;

    const newId = generateId();
    const newScript: Script = {
      ...scriptToDup,
      id: newId,
      title: `${scriptToDup.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sections: scriptToDup.sections.map(sec => ({
        ...sec,
        id: generateId()
      }))
    };
    
    setScripts(prev => [newScript, ...prev]);
    setActiveScriptId(newId);
    return newId;
  }, [scripts]);

  const importScripts = useCallback((data: string) => {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.every(s => s.id && s.title && Array.isArray(s.sections))) {
        // Simple validation passed
        // Re-generate IDs to avoid collisions
        const imported: Script[] = parsed.map(s => ({
          ...s,
          id: generateId(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          sections: s.sections.map((sec: any) => ({
            ...sec,
            id: generateId()
          }))
        }));
        setScripts(prev => [...imported, ...prev]);
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }, []);

  const exportScripts = useCallback(() => {
    return JSON.stringify(scripts, null, 2);
  }, [scripts]);

  const clearError = useCallback(() => setError(null), []);

  if (!isLoaded) return null; // or loading spinner

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

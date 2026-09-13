import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Alignment = 'left' | 'center';
export interface Script {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  trashedAt?: number;
}
export interface ReaderSettings {
  fontSize: number;
  speed: number;
  alignment: Alignment;
}

interface QuickqueState {
  scripts: Script[];
  settings: ReaderSettings;
}

interface QuickqueContextValue extends QuickqueState {
  ready: boolean;
  createScript: () => string;
  updateScript: (id: string, updates: Pick<Script, 'title' | 'body'>) => void;
  duplicateScript: (id: string) => void;
  trashScript: (id: string) => void;
  restoreScript: (id: string) => void;
  deleteForever: (id: string) => void;
  updateSettings: (updates: Partial<ReaderSettings>) => void;
  resetData: () => Promise<void>;
  scriptById: (id: string) => Script | undefined;
}

const STORAGE_KEY = 'quickque.mobile.v1';
const now = Date.now();
const initialState: QuickqueState = {
  scripts: [{
    id: 'welcome',
    title: 'Welcome to Quickque',
    body: `Take a breath.\n\nQuickque keeps your words close, without sending them anywhere.\n\nTap Read when you are ready. Choose a comfortable pace, look toward the camera, and let the next sentence arrive without rushing.\n\nYour scripts stay on this iPhone.`,
    createdAt: now,
    updatedAt: now,
  }],
  settings: { fontSize: 38, speed: 28, alignment: 'left' },
};

const QuickqueContext = createContext<QuickqueContextValue | null>(null);

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function QuickqueProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<QuickqueState>(initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (value) setState(JSON.parse(value) as QuickqueState);
      })
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  const createScript = useCallback(() => {
    const id = newId();
    const timestamp = Date.now();
    setState(current => ({
      ...current,
      scripts: [{ id, title: 'Untitled script', body: '', createdAt: timestamp, updatedAt: timestamp }, ...current.scripts],
    }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    return id;
  }, []);

  const updateScript = useCallback((id: string, updates: Pick<Script, 'title' | 'body'>) => {
    setState(current => ({
      ...current,
      scripts: current.scripts.map(script => script.id === id ? { ...script, ...updates, updatedAt: Date.now() } : script),
    }));
  }, []);

  const duplicateScript = useCallback((id: string) => {
    setState(current => {
      const source = current.scripts.find(script => script.id === id);
      if (!source) return current;
      const timestamp = Date.now();
      return { ...current, scripts: [{ ...source, id: newId(), title: `${source.title} copy`, createdAt: timestamp, updatedAt: timestamp, trashedAt: undefined }, ...current.scripts] };
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const trashScript = useCallback((id: string) => {
    setState(current => ({ ...current, scripts: current.scripts.map(script => script.id === id ? { ...script, trashedAt: Date.now() } : script) }));
  }, []);
  const restoreScript = useCallback((id: string) => {
    setState(current => ({ ...current, scripts: current.scripts.map(script => script.id === id ? { ...script, trashedAt: undefined } : script) }));
  }, []);
  const deleteForever = useCallback((id: string) => {
    setState(current => ({ ...current, scripts: current.scripts.filter(script => script.id !== id) }));
  }, []);
  const updateSettings = useCallback((updates: Partial<ReaderSettings>) => {
    setState(current => ({ ...current, settings: { ...current.settings, ...updates } }));
  }, []);
  const resetData = useCallback(async () => {
    setState(initialState);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
  }, []);
  const scriptById = useCallback((id: string) => state.scripts.find(script => script.id === id), [state.scripts]);

  const value = useMemo(() => ({
    ...state, ready, createScript, updateScript, duplicateScript, trashScript, restoreScript,
    deleteForever, updateSettings, resetData, scriptById,
  }), [state, ready, createScript, updateScript, duplicateScript, trashScript, restoreScript, deleteForever, updateSettings, resetData, scriptById]);

  return <QuickqueContext.Provider value={value}>{children}</QuickqueContext.Provider>;
}

export function useQuickque() {
  const context = useContext(QuickqueContext);
  if (!context) throw new Error('useQuickque must be used within QuickqueProvider');
  return context;
}
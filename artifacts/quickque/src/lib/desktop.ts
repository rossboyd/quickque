import { LogicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  isRegistered,
  register,
  unregister,
} from '@tauri-apps/plugin-global-shortcut';

type Control = 'toggle' | 'previous' | 'next';

const shortcuts = {
  'Command+Shift+Space': 'toggle',
  'Command+Shift+Left': 'previous',
  'Command+Shift+Right': 'next',
} as const satisfies Record<string, Control>;

type SavedWindowState = {
  position: Awaited<ReturnType<ReturnType<typeof getCurrentWindow>['outerPosition']>>;
  size: Awaited<ReturnType<ReturnType<typeof getCurrentWindow>['outerSize']>>;
  minSize: LogicalSize;
  decorated: boolean;
};

let savedWindowState: SavedWindowState | undefined;
let overlayEnabled = false;
let registeredShortcuts: string[] = [];
let overlayTransition: Promise<void> = Promise.resolve();

export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
  );
}

function emitControl(control: Control): void {
  window.dispatchEvent(
    new CustomEvent<Control>('quickque:control', { detail: control }),
  );
}

async function registerOverlayShortcuts(): Promise<void> {
  if (registeredShortcuts.length > 0) {
    return;
  }

  const newlyRegistered: string[] = [];
  try {
    for (const [accelerator, control] of Object.entries(shortcuts)) {
      if (await isRegistered(accelerator)) {
        throw new Error(`Global shortcut is already in use: ${accelerator}`);
      }
      await register(accelerator, (event) => {
        if (event.state === 'Pressed' && overlayEnabled) {
          emitControl(control);
        }
      });
      newlyRegistered.push(accelerator);
    }
    registeredShortcuts = newlyRegistered;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const accelerator of newlyRegistered.reverse()) {
      try {
        await unregister(accelerator);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        'Could not register or clean up desktop shortcuts',
      );
    }
    throw error;
  }
}

async function unregisterOverlayShortcuts(): Promise<void> {
  const errors: unknown[] = [];
  const failed: string[] = [];
  for (const accelerator of [...registeredShortcuts].reverse()) {
    try {
      await unregister(accelerator);
    } catch (error) {
      errors.push(error);
      failed.push(accelerator);
    }
  }
  registeredShortcuts = failed;
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Could not unregister desktop shortcuts');
  }
}

async function restoreWindow(
  saved: SavedWindowState,
  includeShortcutCleanup: boolean,
): Promise<void> {
  const appWindow = getCurrentWindow();
  const operations: Array<() => Promise<void>> = [];
  if (includeShortcutCleanup) {
    operations.push(unregisterOverlayShortcuts);
  }
  operations.push(
    () => appWindow.setVisibleOnAllWorkspaces(false),
    () => appWindow.setAlwaysOnTop(false),
    () => appWindow.setDecorations(saved.decorated),
    () => appWindow.setMinSize(saved.minSize),
    () => appWindow.setSize(saved.size),
    () => appWindow.setPosition(saved.position),
  );

  const errors: unknown[] = [];
  for (const operation of operations) {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Could not completely restore the window');
  }
}

async function changeOverlayMode(enabled: boolean): Promise<void> {
  if (!isDesktop() || enabled === overlayEnabled) {
    return;
  }

  const appWindow = getCurrentWindow();
  if (enabled) {
    const saved: SavedWindowState = {
      position: await appWindow.outerPosition(),
      size: await appWindow.outerSize(),
      // Tauri exposes a minimum-size setter but no corresponding JS getter.
      // This is the ordinary window minimum configured in tauri.conf.json.
      minSize: new LogicalSize(800, 600),
      decorated: await appWindow.isDecorated(),
    };

    try {
      await appWindow.setMinSize(new LogicalSize(360, 260));
      await appWindow.setSize(new LogicalSize(620, 380));
      await appWindow.setDecorations(false);
      await appWindow.setAlwaysOnTop(true);
      await appWindow.setVisibleOnAllWorkspaces(true);
      await registerOverlayShortcuts();
      savedWindowState = saved;
      overlayEnabled = true;
    } catch (error) {
      await restoreWindow(saved, true).catch((restoreError) => {
        throw new AggregateError(
          [error, restoreError],
          'Could not enter overlay mode or restore the window',
        );
      });
      throw error;
    }
    return;
  }

  if (!savedWindowState) {
    throw new Error('Overlay window state is missing and cannot be restored');
  }

  const saved = savedWindowState;
  overlayEnabled = false;
  try {
    await restoreWindow(saved, true);
    savedWindowState = undefined;
  } catch (error) {
    throw error;
  }
}

export function setOverlayMode(enabled: boolean): Promise<void> {
  if (!isDesktop()) {
    return Promise.resolve();
  }
  const transition = overlayTransition.then(() => changeOverlayMode(enabled));
  overlayTransition = transition.catch(() => undefined);
  return transition;
}

export async function setAlwaysOnTop(enabled: boolean): Promise<void> {
  if (isDesktop()) {
    await getCurrentWindow().setAlwaysOnTop(enabled);
  }
}

export async function startDragging(): Promise<void> {
  if (isDesktop()) {
    await getCurrentWindow().startDragging();
  }
}

export async function minimizeWindow(): Promise<void> {
  if (isDesktop()) {
    await getCurrentWindow().minimize();
  }
}

export async function closeWindow(): Promise<void> {
  if (isDesktop()) {
    await getCurrentWindow().close();
  }
}

export async function openMicrophoneSettings(): Promise<void> {
  if (isDesktop()) {
    await invoke('open_microphone_settings');
  }
}
import { invoke } from '@tauri-apps/api/core';

export type LocalLibrary = {
  directory: string | null;
  scriptsJson: string | null;
};

function isNativeDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    '__TAURI_INTERNALS__' in (window as unknown as Record<string, unknown>)
  );
}

function browserError(operation: string): Error {
  return new Error(
    `Quickque local library ${operation} is only available in the native desktop app.`,
  );
}

function nativeError(operation: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`Could not ${operation} the Quickque local library: ${detail}`);
}

function validateNativeLibrary(value: unknown): LocalLibrary {
  if (typeof value !== 'object' || value === null) {
    throw new Error('The native local library returned an invalid response.');
  }

  const candidate = value as Record<string, unknown>;
  if (
    !Object.prototype.hasOwnProperty.call(candidate, 'directory') ||
    !Object.prototype.hasOwnProperty.call(candidate, 'scriptsJson') ||
    (candidate.directory !== null && typeof candidate.directory !== 'string') ||
    (candidate.scriptsJson !== null && typeof candidate.scriptsJson !== 'string')
  ) {
    throw new Error('The native local library returned an invalid response.');
  }

  return {
    directory: candidate.directory as string | null,
    scriptsJson: candidate.scriptsJson as string | null,
  };
}

/**
 * Returns the configured native folder and its saved script JSON.
 *
 * A browser has no native folder, so it deliberately returns null values.
 * Native bridge failures are surfaced to the caller rather than falling back
 * to browser storage.
 */
export async function getLocalLibrary(): Promise<LocalLibrary> {
  if (!isNativeDesktop()) {
    return { directory: null, scriptsJson: null };
  }

  try {
    return validateNativeLibrary(await invoke<unknown>('get_local_library'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'The native local library returned an invalid response.'
    ) {
      throw error;
    }
    throw nativeError('load', error);
  }
}

/**
 * Opens the native directory picker and persists the selected folder.
 * Cancellation is represented by null.
 */
export async function chooseLocalDirectory(): Promise<string | null> {
  if (!isNativeDesktop()) {
    throw browserError('directory picker');
  }

  try {
    const directory = await invoke<unknown>('choose_local_directory');
    if (directory !== null && typeof directory !== 'string') {
      throw new Error('The native directory picker returned an invalid path.');
    }
    return directory as string | null;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'The native directory picker returned an invalid path.'
    ) {
      throw error;
    }
    throw nativeError('choose a folder for', error);
  }
}

/**
 * Saves the serialized script array in the expected configured native folder.
 */
export async function saveLocalLibrary(
  scriptsJson: string,
  expectedDirectory: string,
): Promise<void> {
  if (!isNativeDesktop()) {
    throw browserError('saving');
  }
  if (typeof scriptsJson !== 'string') {
    throw new TypeError('Quickque local library scripts must be a JSON string.');
  }
  if (typeof expectedDirectory !== 'string' || expectedDirectory.length === 0) {
    throw new TypeError(
      'Quickque local library saves must include the expected folder.',
    );
  }

  try {
    await invoke('save_local_library', { scriptsJson, expectedDirectory });
  } catch (error) {
    throw nativeError('save', error);
  }
}
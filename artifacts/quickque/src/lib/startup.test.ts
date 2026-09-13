import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from './types.ts';
import {
  applyDocumentTheme,
  applyPersistedTheme,
  QUICKQUE_READER_THEME_ATTRIBUTE,
  QUICKQUE_SETTINGS_KEY,
} from './settings-persistence.ts';
import {
  boundStartupError,
  classifyWatchdogState,
  getStartupContract,
} from './startup.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  put(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function fakeDocument() {
  const classes = new Set<string>();
  return {
    documentElement: {
      classList: {
        toggle(name: string, enabled: boolean) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      attributes: new Map<string, string>(),
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
      getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
      },
      removeAttribute(name: string) {
        this.attributes.delete(name);
      },
    },
    classes,
  };
}

test('persisted light and dark themes apply before the first React paint', () => {
  const storage = new MemoryStorage();
  const document = fakeDocument();

  storage.put(QUICKQUE_SETTINGS_KEY, JSON.stringify({
    ...DEFAULT_SETTINGS,
    darkTheme: false,
  }));
  assert.equal(applyPersistedTheme(document, storage), false);
  assert.equal(document.classes.has('dark'), false);
  assert.equal(document.documentElement.attributes.get('data-quickque-theme'), 'light');

  storage.put(QUICKQUE_SETTINGS_KEY, JSON.stringify({
    ...DEFAULT_SETTINGS,
    darkTheme: true,
  }));
  assert.equal(applyPersistedTheme(document, storage), true);
  assert.equal(document.classes.has('dark'), true);
  assert.equal(document.documentElement.attributes.get('data-quickque-theme'), 'dark');
});

test('reader theme remains dark independently of the workbench preference', () => {
  const document = fakeDocument();
  document.documentElement.setAttribute(QUICKQUE_READER_THEME_ATTRIBUTE, 'dark');
  assert.equal(applyDocumentTheme(document, false), true);
  assert.equal(document.classes.has('dark'), true);
  assert.equal(document.documentElement.attributes.get('data-quickque-theme'), 'dark');

  document.documentElement.removeAttribute(QUICKQUE_READER_THEME_ATTRIBUTE);
  assert.equal(applyDocumentTheme(document, false), false);
  assert.equal(document.classes.has('dark'), false);
  assert.equal(document.documentElement.attributes.get('data-quickque-theme'), 'light');
});

test('delayed native hydration keeps startup pending until both sources are ready', () => {
  assert.deepEqual(
    getStartupContract({ settings: 'ready', library: 'pending' }),
    { phase: 'pending', error: null },
  );
  assert.deepEqual(
    getStartupContract({ settings: 'ready', library: 'ready' }),
    { phase: 'ready', error: null },
  );
});

test('startup errors are explicit and bounded', () => {
  const contract = getStartupContract({
    settings: 'ready',
    library: 'error',
    error: 'x'.repeat(1000),
  });
  assert.equal(contract.phase, 'error');
  assert.equal(contract.error.length, 240);
  assert.match(contract.error, /…$/);
  assert.equal(
    boundStartupError(null),
    'Quickque could not finish loading its local data.',
  );
});

test('watchdog distinguishes mount failure from delayed hydration', () => {
  assert.equal(classifyWatchdogState({ mounted: false, ready: false }), 'mount-failure');
  assert.equal(classifyWatchdogState({ mounted: true, ready: false }), 'hydration-timeout');
  assert.equal(classifyWatchdogState({ mounted: true, ready: true }), 'healthy');
  assert.equal(
    classifyWatchdogState({ mounted: true, ready: false, reportedError: true }),
    'reported-error',
  );
});
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDocumentScript,
  loadLibrary,
  persistLibrary,
  QUICKQUE_SCRIPTS_KEY,
  QUICKQUE_ACTIVE_SCRIPT_KEY,
  storageErrors,
} from './store-persistence.ts';
import type { Script } from './types.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  setCalls = 0;
  shouldThrow = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.setCalls += 1;
    if (this.shouldThrow) throw new Error('quota');
    this.values.set(key, value);
  }

  put(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function script(id: string, title = 'Old script'): Script {
  return {
    id,
    title,
    createdAt: 1,
    updatedAt: 1,
    sections: [{ id: `${id}-section`, title: 'Section 1', content: 'content' }],
  };
}

test('loads the legacy array and active key, then produces an envelope on migration', () => {
  const storage = new MemoryStorage();
  const scripts = [script('legacy-a'), script('legacy-b')];
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify(scripts));
  storage.put(QUICKQUE_ACTIVE_SCRIPT_KEY, 'legacy-b');

  const loaded = loadLibrary(storage, []);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.deepEqual(loaded.scripts, scripts);
  assert.equal(loaded.activeScriptId, 'legacy-b');
  assert.equal(loaded.needsMigration, true);

  const persisted = persistLibrary(storage, loaded.scripts, loaded.activeScriptId);
  assert.equal(persisted.ok, true);
  const envelope = JSON.parse(storage.getItem(QUICKQUE_SCRIPTS_KEY) as string);
  assert.deepEqual(envelope, {
    version: 1,
    scripts,
    activeScriptId: 'legacy-b',
  });
});

test('does not write over malformed library bytes', () => {
  const storage = new MemoryStorage();
  const original = '{not valid json';
  storage.put(QUICKQUE_SCRIPTS_KEY, original);

  const loaded = loadLibrary(storage, [script('seed')]);
  assert.deepEqual(loaded, {
    ok: false,
    error: storageErrors.malformedLibrary,
  });
  assert.equal(storage.getItem(QUICKQUE_SCRIPTS_KEY), original);
  assert.equal(storage.setCalls, 0);
});

test('failed envelope writes leave the previous bytes and selection untouched', () => {
  const storage = new MemoryStorage();
  const previousScripts = [script('previous')];
  const previous = JSON.stringify({
    version: 1,
    scripts: previousScripts,
    activeScriptId: 'previous',
  });
  storage.put(QUICKQUE_SCRIPTS_KEY, previous);
  storage.shouldThrow = true;

  const result = persistLibrary(storage, [script('new')], 'new');
  assert.deepEqual(result, { ok: false, error: storageErrors.writeLibrary });
  assert.equal(storage.getItem(QUICKQUE_SCRIPTS_KEY), previous);
});

test('document imports preserve exact text and allow duplicate titles with fresh IDs', () => {
  const usedIds = new Set<string>();
  const ids = ['document-1', 'section-1', 'document-2', 'section-2'];
  const idFactory = () => ids.shift() as string;
  const first = createDocumentScript('Same filename.txt', '  first\n\nparagraph  ', usedIds, idFactory);
  const second = createDocumentScript('Same filename.txt', 'second', usedIds, idFactory);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.script.title, second.script.title);
  assert.notEqual(first.script.id, second.script.id);
  assert.deepEqual(first.script.sections, [{
    id: 'section-1',
    title: 'Section 1',
    content: '  first\n\nparagraph  ',
  }]);
});

test('document title and text validation enforces nonblank and size limits', () => {
  const ids = new Set<string>();
  assert.equal(createDocumentScript('   ', 'text', ids).ok, false);
  assert.equal(createDocumentScript('a'.repeat(201), 'text', ids).ok, false);
  assert.equal(createDocumentScript('title', ' \n\t', ids).ok, false);
  assert.equal(createDocumentScript('title', 'a'.repeat(500_001), ids).ok, false);
  assert.equal(createDocumentScript('a'.repeat(200), 'a'.repeat(500_000), ids).ok, true);
});
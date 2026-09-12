import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDocumentScript,
  loadLibrary,
  parseLibraryData,
  persistLibrary,
  MAX_BACKUP_BYTES,
  QUICKQUE_SCRIPTS_KEY,
  QUICKQUE_ACTIVE_SCRIPT_KEY,
  storageErrors,
} from './store-persistence.ts';
import type { Script } from './types.ts';
import { DEFAULT_PRESENTATION } from './presentation-preferences.ts';
import { isValidActor } from './actor-model.ts';

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
    purpose: 'presentation',
    createdAt: 1,
    updatedAt: 1,
    presentation: { ...DEFAULT_PRESENTATION },
    sections: [{ id: `${id}-section`, title: 'Section 1', content: 'content' }],
  };
}

test('loads the legacy array and active key, then produces an envelope on migration', () => {
  const storage = new MemoryStorage();
  const scripts = [script('legacy-a'), script('legacy-b')];
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify(scripts.map(({ purpose, ...legacy }) => legacy)));
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
    version: 2,
    scripts,
    activeScriptId: 'legacy-b',
    trash: [],
    customOrder: ['legacy-a', 'legacy-b'],
    sortMode: 'custom',
  });
});

test('loads a legacy v1 envelope and migrates it to v2 on persistence', () => {
  const storage = new MemoryStorage();
  const scripts = [script('v1')];
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify({
    version: 1,
    scripts,
    activeScriptId: 'v1',
  }));
  const loaded = loadLibrary(storage, []);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.needsMigration, true);
  const migrated = persistLibrary(storage, loaded.scripts, loaded.activeScriptId, {
    trash: loaded.trash,
    customOrder: loaded.customOrder,
    sortMode: loaded.sortMode,
  });
  assert.equal(migrated.ok, true);
  assert.equal(JSON.parse(storage.getItem(QUICKQUE_SCRIPTS_KEY) as string).version, 2);
});

test('repairs repeated section identities in a legacy v1 envelope before migration', () => {
  const storage = new MemoryStorage();
  const first = script('first');
  const second = script('second');
  first.sections[0].id = 'repeated-section';
  second.sections[0].id = 'repeated-section';
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify({
    version: 1,
    scripts: [first, second],
    activeScriptId: 'first',
  }));
  const loaded = loadLibrary(storage, []);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.notEqual(loaded.scripts[0].sections[0].id, loaded.scripts[1].sections[0].id);
  assert.equal(loaded.needsMigration, true);
});

test('rejects malformed fields and metadata as an all-or-nothing table', () => {
  const valid = script('valid');
  const malformed: unknown[] = [
    null,
    { version: 3, scripts: [valid], activeScriptId: 'valid' },
    [{ ...valid, id: '' }],
    [{ ...valid, title: 4 }],
    [{ ...valid, createdAt: null }],
    [{ ...valid, updatedAt: 'now' }],
    [{ ...valid, sections: null }],
    [{ ...valid, sections: [{ ...valid.sections[0], id: '' }] }],
    [{ ...valid, sections: [{ ...valid.sections[0], title: 4 }] }],
    [{ ...valid, sections: [{ ...valid.sections[0], content: 4 }] }],
    [{ ...valid, sections: [{ ...valid.sections[0] }, { ...valid.sections[0] }] }],
    [{ ...valid, title: 'x'.repeat(201) }],
    [{ ...valid, sections: [{ ...valid.sections[0], content: 'x'.repeat(500_001) }] }],
    [{ ...valid, sections: [{ ...valid.sections[0], notes: 'x'.repeat(500_001) }] }],
    [{
      ...valid,
      sections: Array.from({ length: 501 }, (_, index) => ({
        id: `section-${index}`,
        title: 'Section',
        content: '',
      })),
    }],
    {
      version: 2,
      scripts: [valid],
      activeScriptId: 'valid',
      trash: [],
      customOrder: ['missing'],
      sortMode: 'custom',
    },
    {
      version: 2,
      scripts: [valid],
      activeScriptId: 'valid',
      trash: [],
      customOrder: ['valid'],
      sortMode: 'invalid',
    },
    {
      version: 2,
      scripts: [valid],
      activeScriptId: 'valid',
      trash: [{ script: valid, deletedAt: 'never' }],
      customOrder: ['valid'],
      sortMode: 'custom',
    },
  ];
  for (const value of malformed) {
    assert.equal(parseLibraryData(JSON.stringify(value)).ok, false);
  }
  assert.equal(parseLibraryData('x'.repeat(MAX_BACKUP_BYTES + 1)).ok, false);
});

test('round-trips portable scripts and full backup metadata', () => {
  const storage = new MemoryStorage();
  const scripts = [script('portable')];
  const trash = [{ script: script('deleted'), deletedAt: 99 }];
  const persisted = persistLibrary(storage, scripts, 'portable', {
    trash,
    customOrder: ['portable'],
    sortMode: 'oldest',
  });
  assert.equal(persisted.ok, true);
  const full = parseLibraryData(storage.getItem(QUICKQUE_SCRIPTS_KEY) as string);
  assert.equal(full.ok, true);
  if (!full.ok) return;
  assert.deepEqual(full.library.scripts, scripts);
  assert.deepEqual(full.library.trash, trash);
  assert.equal(full.library.sortMode, 'oldest');

  const portable = parseLibraryData(JSON.stringify(scripts));
  assert.equal(portable.ok, true);
  if (!portable.ok) return;
  assert.deepEqual(portable.library.scripts, scripts);
  assert.deepEqual(portable.library.trash, []);
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

test('document imports receive a copy of the supplied presentation defaults', () => {
  const defaults = { ...DEFAULT_PRESENTATION, horizontalMargin: 22 };
  const result = createDocumentScript(
    'Imported.txt',
    'Text',
    new Set<string>(),
    undefined,
    defaults,
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.script.presentation, defaults);
  assert.notEqual(result.script.presentation, defaults);
});

test('document title and text validation enforces nonblank and size limits', () => {
  const ids = new Set<string>();
  assert.equal(createDocumentScript('   ', 'text', ids).ok, false);
  assert.equal(createDocumentScript('a'.repeat(201), 'text', ids).ok, false);
  assert.equal(createDocumentScript('title', ' \n\t', ids).ok, false);
  assert.equal(createDocumentScript('title', 'a'.repeat(500_001), ids).ok, false);
  assert.equal(createDocumentScript('a'.repeat(200), 'a'.repeat(500_000), ids).ok, true);
});

test('persists and reloads trash, custom order, and sort metadata', () => {
  const storage = new MemoryStorage();
  const scripts = [script('a'), script('b')];
  const trash = [{
    script: script('deleted'),
    deletedAt: 42,
  }];
  const result = persistLibrary(storage, scripts, 'b', {
    trash,
    customOrder: ['b', 'a'],
    sortMode: 'az',
  });
  assert.equal(result.ok, true);

  const loaded = loadLibrary(storage, []);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.deepEqual(loaded.trash, trash);
  assert.deepEqual(loaded.customOrder, ['b', 'a']);
  assert.equal(loaded.sortMode, 'az');
  assert.equal(loaded.activeScriptId, 'b');
});

test('legacy arrays tolerate a stale active selection key', () => {
  const storage = new MemoryStorage();
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify([script('a'), script('b')]));
  storage.put(QUICKQUE_ACTIVE_SCRIPT_KEY, 'deleted');
  const loaded = loadLibrary(storage, []);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.activeScriptId, 'a');
});

test('legacy scripts and Trash are stamped with the supplied presentation snapshot', () => {
  const storage = new MemoryStorage();
  const active = script('active');
  const deleted = script('deleted');
  delete active.presentation;
  delete deleted.presentation;
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify({
    version: 2,
    scripts: [active],
    activeScriptId: 'active',
    trash: [{ script: deleted, deletedAt: 2 }],
    customOrder: ['active'],
    sortMode: 'custom',
  }));
  const currentDefaults = {
    ...DEFAULT_PRESENTATION,
    fontSize: 80,
  };
  const fallback = {
    ...DEFAULT_PRESENTATION,
    fontSize: 66,
    speed: 150,
    backgroundColor: '#FFFFFF',
  };
  const loaded = loadLibrary(storage, [], currentDefaults, fallback);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.needsMigration, true);
  assert.deepEqual(loaded.scripts[0].presentation, fallback);
  assert.deepEqual(loaded.trash[0].script.presentation, fallback);
  assert.equal(persistLibrary(storage, loaded.scripts, loaded.activeScriptId, {
    trash: loaded.trash,
    customOrder: loaded.customOrder,
    sortMode: loaded.sortMode,
  }).ok, true);
  const saved = JSON.parse(storage.getItem(QUICKQUE_SCRIPTS_KEY) as string);
  assert.deepEqual(saved.trash[0].script.presentation, fallback);
  const reloaded = loadLibrary(storage, [], currentDefaults, {
    ...DEFAULT_PRESENTATION,
    speed: 1,
  });
  assert.equal(reloaded.ok, true);
  if (!reloaded.ok) return;
  assert.equal(reloaded.scripts[0].presentation?.speed, 150);
  assert.equal(reloaded.trash[0].script.presentation?.speed, 150);
});

test('rejects malformed metadata without writing', () => {
  const storage = new MemoryStorage();
  const original = JSON.stringify({
    version: 1,
    scripts: [script('a')],
    activeScriptId: 'a',
    trash: [],
    customOrder: ['missing'],
    sortMode: 'custom',
  });
  storage.put(QUICKQUE_SCRIPTS_KEY, original);
  const loaded = loadLibrary(storage, []);
  assert.deepEqual(loaded, {
    ok: false,
    error: storageErrors.malformedLibrary,
  });
  assert.equal(storage.getItem(QUICKQUE_SCRIPTS_KEY), original);
});

test('round-trips actor metadata, notes, roles, and turbo provenance', () => {
  const storage = new MemoryStorage();
  const actorScript = script('actor');
  actorScript.actor = {
    enabled: true,
    characters: [{
      id: 'partner',
      name: 'Partner',
      age: '30s',
      gender: 'non-binary',
      style: 'restrained',
      voice: { engine: 'turbo', voiceId: 'rights-cleared-1', rate: 1.15 },
    }],
    myRoleIds: [],
  };
  actorScript.sections[0].notes = 'Pause before the last line.';
  actorScript.sections[0].characterId = 'partner';
  assert.equal(persistLibrary(storage, [actorScript], 'actor').ok, true);
  const loaded = loadLibrary(storage, []);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.ok(loaded.scripts[0].actor);
  assert.ok(isValidActor(loaded.scripts[0].actor));
  assert.equal(loaded.scripts[0].actor.characters[0].voice.engine, 'turbo');
  assert.equal(loaded.scripts[0].sections[0].notes, actorScript.sections[0].notes);
  assert.equal(loaded.scripts[0].sections[0].characterId, 'partner');
});

test('invalid actor fields and selected roles fail closed without overwriting storage', () => {
  const storage = new MemoryStorage();
  const valid = script('valid');
  storage.put(QUICKQUE_SCRIPTS_KEY, JSON.stringify([valid]));
  const malformed = {
    ...valid,
    actor: {
      enabled: true,
      characters: [{
        id: 'partner',
        name: 'x'.repeat(201),
        age: '',
        gender: '',
        style: '',
        voice: { engine: 'system', voiceId: '', rate: 1 },
      }],
      myRoleIds: ['missing'],
    },
  };
  assert.equal(parseLibraryData(JSON.stringify([malformed])).ok, false);
  assert.equal(loadLibrary(storage, []).ok, true);
});

test('dangling actor assignments are explicitly unassigned before persistence', () => {
  const storage = new MemoryStorage();
  const actorScript = script('dangling');
  actorScript.actor = {
    enabled: true,
    characters: [{
      id: 'partner',
      name: 'Partner',
      age: '',
      gender: '',
      style: '',
      voice: { engine: 'system', voiceId: '', rate: 1 },
    }],
    myRoleIds: [],
  };
  actorScript.sections[0].characterId = 'removed-character';
  assert.equal(persistLibrary(storage, [actorScript], 'dangling').ok, true);
  const parsed = parseLibraryData(storage.getItem(QUICKQUE_SCRIPTS_KEY) as string);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.library.scripts[0].sections[0].characterId, null);
});

test('imports retain actor metadata but drop unknown audio/model payloads', () => {
  const source = script('safe-import') as Script & Record<string, unknown>;
  source.audioBlob = 'generated audio must not persist';
  source.modelWeights = { bytes: [1, 2, 3] };
  source.sections[0] = {
    ...source.sections[0],
    generatedAudio: 'discard',
  };
  source.actor = {
    enabled: true,
    characters: [{
      id: 'partner',
      name: 'Partner',
      age: '',
      gender: '',
      style: 'quiet',
      voice: {
        engine: 'turbo',
        voiceId: 'rights-cleared-1',
        rate: 1,
        model: 'discard',
      },
      referenceAudio: 'discard',
      model: 'discard',
    },
    ],
    myRoleIds: [],
  };

  const parsed = parseLibraryData(JSON.stringify([source]));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const imported = parsed.library.scripts[0] as Script & Record<string, unknown>;
  assert.equal(imported.audioBlob, undefined);
  assert.equal(imported.modelWeights, undefined);
  assert.equal((imported.sections[0] as Script['sections'][number] & Record<string, unknown>).generatedAudio, undefined);
  const character = imported.actor?.characters[0] as typeof imported.actor.characters[number] & Record<string, unknown>;
  assert.equal(character.referenceAudio, undefined);
  assert.equal(character.model, undefined);
  assert.equal((character.voice as typeof character.voice & Record<string, unknown>).model, undefined);
  assert.equal(character.voice.engine, 'turbo');
  assert.equal(character.voice.voiceId, 'rights-cleared-1');
});
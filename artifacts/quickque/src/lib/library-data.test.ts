import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialScripts,
  parseRecoveryJson,
  parseImportJson,
  parseScriptsJson,
  canWriteNativeLibrary,
  mergeNativeHydration,
  resolveNativeHydration,
  serializeScripts,
} from './library-data.ts';
import { DEFAULT_PRESENTATION } from './presentation-preferences.ts';

test('a new install contains exactly one unchanged welcome script', () => {
  const scripts = createInitialScripts(123);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].id, 'seed-1');
  assert.equal(scripts[0].title, 'Welcome to Quickque');
  assert.equal(
    scripts[0].sections[0].content,
    'Welcome to Quickque. This is a personal teleprompter designed for live meetings.\n\nIt helps you stay on track while presenting, without feeling like you are reading a script.',
  );
  assert.equal(
    scripts[0].sections[1].content,
    "If you need to pause for an interruption, just press the Space bar.\n\nYou won't lose your place. A clear marker shows exactly where you left off.\n\nUse the left and right arrow keys to jump between sections.",
  );
});

test('valid existing scripts are preserved and malformed source is rejected', () => {
  const existing = [
    {
      id: 'user-script',
      title: 'My script',
      createdAt: 10,
      updatedAt: 20,
      presentation: { ...DEFAULT_PRESENTATION },
      sections: [{ id: 'section', title: 'Part one', content: 'Keep this.' }],
    },
  ];
  const serialized = JSON.stringify(existing);
  assert.deepEqual(parseScriptsJson(serialized), existing.map(script => ({ ...script, purpose: 'presentation' })));
  assert.equal(parseScriptsJson('{"scripts":[]}'), null);
  assert.equal(parseScriptsJson('not json'), null);
});

test('native and recovery parsing stamp legacy scripts using the current defaults', () => {
  const legacy = [{
    id: 'native',
    title: 'Native',
    createdAt: 1,
    updatedAt: 1,
    sections: [{ id: 'native-section', title: 'Section', content: 'Text' }],
  }];
  const defaults = { ...DEFAULT_PRESENTATION, fontSize: 72 };
  assert.deepEqual(parseScriptsJson(JSON.stringify(legacy), defaults)?.[0].presentation, defaults);
  const recovery = parseRecoveryJson(JSON.stringify({
    scriptsJson: JSON.stringify(legacy),
  }), defaults);
  assert.deepEqual(recovery?.scripts[0].presentation, defaults);
});

test('accepts the native local-library wrapper and rejects other formats', () => {
  const scripts = createInitialScripts(321);
  const wrapped = JSON.stringify({
    format: 'com.quickque.local-library',
    version: 1,
    scripts,
  });
  assert.deepEqual(parseImportJson(wrapped), scripts);
  assert.deepEqual(parseImportJson(JSON.stringify(scripts)), scripts);
  assert.equal(
    parseImportJson(
      JSON.stringify({
        format: 'com.quickque.local-library',
        version: 2,
        scripts,
      }),
    ),
    null,
  );
  assert.equal(
    parseImportJson(
      JSON.stringify({
        format: 'other',
        version: 1,
        scripts,
      }),
    ),
    null,
  );
  assert.equal(
    parseImportJson(
      JSON.stringify({
        format: 'com.quickque.local-library',
        version: 1,
        scripts,
        extra: true,
      }),
    ),
    null,
  );
});

test('delayed native hydration keeps every synchronous local mutation', () => {
  const base = createInitialScripts(654);
  const nativeScripts = base;
  const created = {
    ...base[0],
    id: 'created',
    title: 'Created',
  };
  const updated = {
    ...base[0],
    title: 'Updated before native load',
  };
  const duplicate = {
    ...base[0],
    id: 'duplicate',
    title: `${base[0].title} (Copy)`,
  };
  const imported = {
    ...base[0],
    id: 'imported',
    title: 'Imported before native load',
  };
  const mutations: Array<[string, typeof base]> = [
    ['create', [created, ...base]],
    ['update', [updated]],
    ['delete', []],
    ['duplicate', [duplicate, ...base]],
    ['import', [imported, ...base]],
  ];

  for (const [name, localScripts] of mutations) {
    const decision = resolveNativeHydration(0, 1, localScripts, nativeScripts);
    assert.equal(decision.source, 'local', name);
    assert.equal(decision.shouldSaveNative, true, name);
    assert.deepEqual(decision.scripts, localScripts, name);
    assert.deepEqual(
      parseScriptsJson(serializeScripts(decision.scripts)),
      localScripts,
      name,
    );
  }
});

test('valid native scripts are adopted when the browser has no live edit', () => {
  const local = createInitialScripts(700);
  const native = {
    ...local[0],
    id: 'native-script',
    title: 'Native script',
  };
  const decision = mergeNativeHydration(0, 0, local, [native]);
  assert.equal(decision.source, 'native');
  assert.equal(decision.shouldSaveNative, false);
  assert.deepEqual(decision.scripts, [native]);
});

test('a browser edit made during native hydration remains authoritative', () => {
  const local = createInitialScripts(701);
  const edited = {
    ...local[0],
    title: 'Edited before native load',
  };
  const native = {
    ...local[0],
    id: 'native-script',
    title: 'Native script',
  };
  const decision = mergeNativeHydration(0, 1, [edited], [native]);
  assert.equal(decision.source, 'local');
  assert.equal(decision.shouldSaveNative, true);
  assert.deepEqual(decision.scripts, [edited]);
});

test('native hydration never resurrects a script present in browser trash', () => {
  const local = createInitialScripts(702);
  const deleted = {
    ...local[0],
    id: 'deleted-script',
    title: 'Deleted script',
  };
  const current = {
    ...local[0],
    id: 'current-script',
    title: 'Current script',
    sections: local[0].sections.map((section, index) => ({
      ...section,
      id: `current-section-${index}`,
    })),
  };
  const decision = mergeNativeHydration(
    0,
    0,
    local,
    [deleted, current],
    new Set([deleted.id, ...deleted.sections.map(section => section.id)]),
  );
  assert.deepEqual(decision.scripts, [current]);
  assert.equal(decision.scripts.some(script => script.id === deleted.id), false);
});

test('recovery and stale native sessions block queued writes', () => {
  assert.equal(
    canWriteNativeLibrary('/scripts', '/scripts', 2, 2, true, false, true, false),
    false,
  );
  assert.equal(
    canWriteNativeLibrary('/scripts', '/scripts', 1, 2, false, false, true, false),
    false,
  );
  assert.equal(
    canWriteNativeLibrary('/scripts', '/scripts', 2, 2, false, false, true, false),
    true,
  );
});

test('a valid recovery copy can be selected without changing its scripts', () => {
  const scripts = createInitialScripts(456);
  const serialized = serializeScripts(scripts);
  const recovery = parseRecoveryJson(
    JSON.stringify({ version: 1, scriptsJson: serialized, updatedAt: 789 }),
  );
  assert.ok(recovery);
  assert.equal(recovery.serialized, serialized);
  assert.deepEqual(recovery.scripts, scripts);
  assert.equal(
    parseRecoveryJson(JSON.stringify({ scriptsJson: '{"broken":true}' })),
    null,
  );
});

test('native serialization preserves actor metadata and leaves turbo unavailable', () => {
  const scripts = createInitialScripts(789);
  scripts[0].actor = {
    enabled: true,
    characters: [{
      id: 'partner',
      name: 'Partner',
      age: '',
      gender: '',
      style: 'calm',
      voice: { engine: 'turbo', voiceId: 'metadata-only', rate: 1 },
    }],
    myRoleIds: [],
  };
  scripts[0].sections[0].notes = 'Do not read this cue.';
  scripts[0].sections[0].characterId = 'partner';
  const parsed = parseScriptsJson(serializeScripts(scripts));
  assert.deepEqual(parsed, scripts);
  assert.equal(parsed?.[0].actor?.characters[0].voice.engine, 'turbo');
  assert.equal(parsed?.[0].sections[0].notes, 'Do not read this cue.');
});
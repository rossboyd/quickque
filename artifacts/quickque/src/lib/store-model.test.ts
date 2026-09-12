import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deleteScriptsState,
  restoreScriptsState,
  permanentlyDeleteScriptsState,
  reorderScriptsState,
  mergeImportedLibrary,
  type LibraryState,
} from './store-model.ts';
import type { Script } from './types.ts';
import { DEFAULT_PRESENTATION } from './presentation-preferences.ts';
import { isValidActor } from './actor-model.ts';

function script(id: string): Script {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    presentation: { ...DEFAULT_PRESENTATION },
    sections: [{ id: `${id}-section`, title: 'Section', content: id }],
  };
}

function state(): LibraryState {
  return {
    scripts: [script('a'), script('b'), script('c')],
    trash: [],
    customOrder: ['a', 'b', 'c'],
    sortMode: 'custom',
    activeScriptId: 'b',
  };
}

test('delete moves scripts to trash and selects first remaining custom item', () => {
  const next = deleteScriptsState(state(), ['b'], 100);
  assert.ok(next);
  assert.deepEqual(next.customOrder, ['a', 'c']);
  assert.equal(next.activeScriptId, 'a');
  assert.deepEqual(next.trash.map(entry => [entry.script.id, entry.deletedAt]), [['b', 100]]);
});

test('restore prepends scripts and selects the first restored ID', () => {
  const deleted = deleteScriptsState(state(), ['a', 'c'], 100);
  assert.ok(deleted);
  const restored = restoreScriptsState(deleted, ['c', 'a']);
  assert.ok(restored);
  assert.deepEqual(restored.customOrder, ['c', 'a', 'b']);
  assert.equal(restored.activeScriptId, 'c');
  assert.equal(restored.trash.length, 0);
});

test('permanent deletion and reordering are all-or-nothing', () => {
  const deleted = deleteScriptsState(state(), ['a'], 100);
  assert.ok(deleted);
  const permanentlyDeleted = permanentlyDeleteScriptsState(deleted, ['a']);
  assert.ok(permanentlyDeleted);
  assert.equal(permanentlyDeleted.trash.length, 0);
  assert.equal(reorderScriptsState(permanentlyDeleted, ['missing']), null);
  assert.deepEqual(
    reorderScriptsState(permanentlyDeleted, ['c', 'b'])?.customOrder,
    ['c', 'b'],
  );
});

test('portable/full import merge regenerates colliding script and section identities', () => {
  const destination = state();
  const imported = {
    scripts: [script('a')],
    trash: [{ script: script('c'), deletedAt: 50 }],
    customOrder: ['a'],
  };
  const ids = ['fresh-script', 'fresh-section', 'fresh-trash', 'fresh-trash-section'];
  const merged = mergeImportedLibrary(
    imported,
    destination.scripts,
    destination.trash,
    () => ids.shift() as string,
  );
  assert.ok(merged);
  assert.equal(merged.scripts[0].id, 'fresh-script');
  assert.equal(merged.scripts[0].sections[0].id, 'fresh-section');
  assert.equal(merged.trash[0].script.id, 'fresh-trash');
  assert.equal(merged.trash[0].script.sections[0].id, 'fresh-trash-section');
  const allIds = [
    ...destination.scripts.flatMap(item => [item.id, ...item.sections.map(section => section.id)]),
    ...destination.trash.flatMap(item => [item.script.id, ...item.script.sections.map(section => section.id)]),
    ...merged.scripts.flatMap(item => [item.id, ...item.sections.map(section => section.id)]),
    ...merged.trash.flatMap(item => [item.script.id, ...item.script.sections.map(section => section.id)]),
  ];
  assert.equal(new Set(allIds).size, allIds.length);
  assert.deepEqual(merged.order, ['fresh-script']);
});

test('import remapping preserves each script presentation without sharing it', () => {
  const destination = state();
  const source = script('imported');
  source.presentation = {
    ...DEFAULT_PRESENTATION,
    lineSpacing: 2.5,
    cueStyle: 'hidden',
  };
  const merged = mergeImportedLibrary({
    scripts: [source],
    trash: [],
    customOrder: ['imported'],
  }, destination.scripts, destination.trash);
  assert.ok(merged);
  assert.deepEqual(merged.scripts[0].presentation, source.presentation);
  assert.notEqual(merged.scripts[0].presentation, source.presentation);
});

test('actor import remaps character identities and every assigned turn', () => {
  const destination = state();
  const source = script('actor-source');
  source.actor = {
    enabled: true,
    characters: [
      {
        id: 'alex',
        name: 'Alex',
        age: '',
        gender: '',
        style: 'warm',
        voice: { engine: 'system', voiceId: 'voice-alex', rate: 1 },
      },
      {
        id: 'sam',
        name: 'Sam',
        age: '',
        gender: '',
        style: 'dry',
        voice: { engine: 'turbo', voiceId: 'voice-sam', rate: 1.2 },
      },
    ],
    myRoleIds: ['alex'],
  };
  source.sections[0].characterId = 'alex';
  const merged = mergeImportedLibrary({
    scripts: [source],
    trash: [],
    customOrder: ['actor-source'],
  }, destination.scripts, destination.trash, (() => {
    const ids = ['fresh-script', 'fresh-section', 'new-alex', 'new-sam'];
    return () => ids.shift() as string;
  })());
  assert.ok(merged);
  const imported = merged.scripts[0];
  assert.ok(imported.actor);
  assert.ok(isValidActor(imported.actor));
  assert.notEqual(imported.actor.characters[0].id, 'alex');
  assert.notEqual(imported.actor.characters[1].id, 'sam');
  assert.equal(imported.sections[0].characterId, imported.actor.characters[0].id);
  assert.deepEqual(imported.actor.myRoleIds, [imported.actor.characters[0].id]);
  assert.equal(imported.actor.characters[1].voice.engine, 'turbo');
});

test('disabled actors still deep-clone cast roles and assigned turns on import', () => {
  const source = script('a');
  source.actor = {
    enabled: false,
    characters: [{
      id: 'partner',
      name: 'Partner',
      age: '',
      gender: '',
      style: 'quiet',
      voice: { engine: 'system', voiceId: 'voice-partner', rate: 1 },
    }],
    myRoleIds: ['partner'],
  };
  source.sections[0].characterId = 'partner';

  const merged = mergeImportedLibrary({
    scripts: [source],
    trash: [],
    customOrder: ['a'],
  }, state().scripts, [], (() => {
    const ids = ['new-script', 'new-section', 'new-character'];
    return () => ids.shift() as string;
  })());
  assert.ok(merged);
  const imported = merged.scripts[0];
  assert.equal(imported.actor?.enabled, false);
  assert.ok(imported.actor);
  assert.equal(imported.actor.characters[0].id, 'new-character');
  assert.deepEqual(imported.actor.myRoleIds, ['new-character']);
  assert.equal(imported.sections[0].characterId, 'new-character');
  assert.notEqual(imported.actor, source.actor);
  assert.notEqual(imported.actor.characters, source.actor.characters);
});
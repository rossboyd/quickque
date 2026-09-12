import assert from 'node:assert/strict';
import test from 'node:test';
import { getScriptPurpose, getSceneSetupIssues } from './script-purpose.ts';
import { cloneScriptData } from './actor-model.ts';
import { parseScriptsJson, parseImportJson, serializeScripts } from './library-data.ts';
import { createLibraryEnvelope, parseLibraryData, persistLibrary, loadLibrary } from './store-persistence.ts';
import { mergeImportedLibrary, deleteScriptsState, restoreScriptsState, type LibraryState } from './store-model.ts';
import { DEFAULT_PRESENTATION } from './presentation-preferences.ts';
import type { Script } from './types.ts';

function performance(): Script {
  return {
    id: 'scene', title: 'Scene', purpose: 'performance', createdAt: 1, updatedAt: 1,
    presentation: { ...DEFAULT_PRESENTATION },
    sections: [{ id: 'turn', title: 'Turn', content: 'Hello there.', characterId: 'partner' }],
    actor: { enabled: false, characters: [{ id: 'partner', name: 'Alex', age: '', gender: '', style: '', voice: { engine: 'system', voiceId: 'local-1', rate: 1 } }], myRoleIds: [] },
  };
}

test('purpose stays performance with partner audio disabled across cloning, export and native import', () => {
  const script = performance();
  assert.equal(getScriptPurpose(script), 'performance');
  assert.equal(cloneScriptData(script).purpose, 'performance');
  const json = serializeScripts([script]);
  assert.equal(parseScriptsJson(json)?.[0].purpose, 'performance');
  assert.equal(parseImportJson(json)?.[0].purpose, 'performance');
  const native = JSON.stringify({ format: 'com.quickque.local-library', version: 1, scripts: [script] });
  assert.equal(parseImportJson(native)?.[0].purpose, 'performance');
  const backup = parseLibraryData(JSON.stringify(createLibraryEnvelope([script], script.id)));
  assert.ok(backup.ok);
  assert.equal(backup.library.scripts[0].purpose, 'performance');
});

test('legacy enabled scenes migrate to performance and explicit presentation takes precedence', () => {
  const script = performance();
  delete script.purpose;
  script.actor!.enabled = true;
  assert.equal(parseScriptsJson(JSON.stringify([script]))?.[0].purpose, 'performance');
  script.purpose = 'presentation';
  assert.equal(getScriptPurpose(script), 'presentation');
  assert.deepEqual(getSceneSetupIssues(script), []);
  delete script.actor;
  delete script.purpose;
  assert.equal(parseScriptsJson(JSON.stringify([script]))?.[0].purpose, 'presentation');
});

test('missing purpose in v2 cache is migrated once and persisted explicitly', () => {
  const script = performance();
  delete script.purpose;
  script.actor!.enabled = true;
  let bytes = JSON.stringify({ version: 2, scripts: [script], trash: [], customOrder: ['scene'], sortMode: 'custom', activeScriptId: 'scene' });
  const storage = { getItem: () => bytes, setItem: (_key: string, next: string) => { bytes = next; } };
  const loaded = loadLibrary(storage, []);
  assert.ok(loaded.ok);
  assert.equal(loaded.needsMigration, true);
  assert.equal(loaded.scripts[0].purpose, 'performance');
  assert.ok(persistLibrary(storage, loaded.scripts, 'scene').ok);
  const reloaded = loadLibrary(storage, []);
  assert.ok(reloaded.ok);
  assert.equal(reloaded.needsMigration, false);
});

test('performance purpose survives trash restore and import identity remapping', () => {
  const script = performance();
  const state: LibraryState = { scripts: [script], trash: [], customOrder: [script.id], sortMode: 'custom', activeScriptId: script.id };
  const deleted = deleteScriptsState(state, [script.id], 2);
  assert.ok(deleted);
  const restored = restoreScriptsState(deleted, [script.id]);
  assert.ok(restored);
  assert.equal(restored.scripts[0].purpose, 'performance');
  let counter = 0;
  const imported = mergeImportedLibrary({ scripts: [script], trash: [], customOrder: [script.id] }, state.scripts, [], () => `fresh-${counter++}`);
  assert.ok(imported);
  assert.equal(imported.scripts[0].purpose, 'performance');
  assert.equal(imported.scripts[0].actor?.enabled, false);
});

test('unknown purposes are rejected by portable and persisted readers', () => {
  const malformed = { ...performance(), purpose: 'mystery' };
  assert.equal(parseScriptsJson(JSON.stringify([malformed])), null);
  assert.equal(parseImportJson(JSON.stringify([malformed])), null);
  assert.equal(parseLibraryData(JSON.stringify([malformed])).ok, false);
});

test('preflight reports every unassigned or empty turn and unavailable partner voice', () => {
  const script = performance();
  script.actor!.enabled = true;
  script.sections.push({ id: 'missing', title: 'Unassigned', content: '', characterId: null });
  const issues = getSceneSetupIssues(script, new Set());
  assert.equal(issues.length, 3);
  assert.equal(issues.filter(issue => issue.sectionId === 'missing').length, 2);
  assert.ok(issues.some(issue => issue.characterId === 'partner'));
  script.sections.pop();
  assert.equal(getSceneSetupIssues(script, new Set(['local-1'])).length, 0);
  script.actor!.myRoleIds = ['partner'];
  assert.equal(getSceneSetupIssues(script, new Set()).length, 0);
  script.actor!.enabled = false;
  script.sections[0].characterId = null;
  assert.equal(getSceneSetupIssues(script, new Set()).length, 0);
});

test('rehearsal accepts installed Chatterbox and blocks it until downloaded', () => {
  const script = performance();
  script.actor!.enabled = true;
  script.actor!.characters[0].voice = { engine: 'turbo', voiceId: 'chatterbox-turbo:default-en', rate: 1 };
  assert.deepEqual(getSceneSetupIssues(script, new Set(['chatterbox-turbo:default-en'])), []);
  assert.equal(getSceneSetupIssues(script, new Set()).length, 1);
});

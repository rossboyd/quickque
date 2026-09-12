import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { QUICKQUE_STORAGE_VERSION, createLibraryEnvelope } from '../../quickque/src/lib/store-persistence.ts';
import { getVisibleScripts } from '../../quickque/src/lib/library-management.ts';
import { deleteScriptsState, restoreScriptsState, mergeImportedLibrary } from '../../quickque/src/lib/store-model.ts';

const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8');
const article = slug => JSON.parse(read(`../content/guide/${slug}.json`)).body;
const script = (id, content = 'Body text') => ({
  id, title: `Script ${id}`, createdAt: 1, updatedAt: 1,
  sections: [{ id: `${id}-section`, title: 'Section heading', content }],
});

test('guide control labels exist in the current app, not just in the guide', () => {
  const library = read('../../quickque/src/pages/library.tsx');
  const settings = read('../../quickque/src/components/settings-dialog.tsx');
  for (const label of ['New script', 'Move to Trash', 'Restore', 'Rehearse', 'Export as JSON']) {
    assert.ok(library.includes(label), `App label changed: ${label}; re-audit scripts guide`);
    assert.ok(article('scripts').includes(label), `Guide missing current label: ${label}`);
  }
  for (const label of ['Export Full Backup', 'Import Backup JSON']) {
    assert.ok(settings.includes(label), `App backup label changed: ${label}`);
    assert.ok(article('backup-restore').includes(label), `Guide backup label changed: ${label}`);
  }
  for (const slug of ['scripts', 'backup-restore', 'privacy', 'updating-uninstalling']) {
    assert.doesNotMatch(article(slug), /\*\*(Backup JSON|Restore JSON)\*\*/, `Outdated button label in ${slug}`);
  }
});

test('full-backup guide matches the real envelope and additive import behavior', () => {
  const live = script('live');
  const deleted = script('deleted');
  const envelope = createLibraryEnvelope([live], live.id, {
    trash: [{ script: deleted, deletedAt: 5 }], customOrder: [live.id], sortMode: 'az',
  });
  assert.equal(envelope.version, QUICKQUE_STORAGE_VERSION);
  assert.deepEqual(Object.keys(envelope).sort(), ['version', 'scripts', 'activeScriptId', 'trash', 'customOrder', 'sortMode'].sort());
  const docs = article('backup-restore');
  assert.match(docs, new RegExp(`version ${QUICKQUE_STORAGE_VERSION}|v${QUICKQUE_STORAGE_VERSION}`, 'i'));
  for (const term of [/Trash/, /custom order/i, /sort/i, /active|selection|selected/i, /collid|collision/i]) assert.match(docs, term);
  let id = 0;
  const imported = mergeImportedLibrary(envelope, [live], [], () => `imported-${++id}`);
  assert.ok(imported);
  assert.notEqual(imported.scripts[0].id, live.id);
  assert.equal(imported.trash[0].script.id, deleted.id, 'Non-colliding identities are retained');
  assert.equal(envelope.activeScriptId, live.id, 'The source envelope is not mutated');
});

test('scripts guide covers actual full-content search and recoverable Trash', () => {
  const item = script('sample', 'unique spoken content');
  assert.equal(getVisibleScripts([item], 'spoken', 'custom', [item.id]).length, 1);
  const state = { scripts: [item], trash: [], customOrder: [item.id], sortMode: 'custom', activeScriptId: item.id };
  const removed = deleteScriptsState(state, [item.id], 100);
  assert.equal(removed.scripts.length, 0);
  assert.equal(removed.trash[0].script.id, item.id);
  assert.equal(restoreScriptsState(removed, [item.id]).scripts[0].id, item.id);
  const docs = article('scripts');
  assert.match(docs, /section (titles|headings)/i);
  assert.match(docs, /content|body text/i);
  assert.match(docs, /permanent/i);
  assert.match(docs, /Trash/);
});
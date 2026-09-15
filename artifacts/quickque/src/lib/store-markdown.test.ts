import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScriptMarkdown, scriptToMarkdown } from './script-markdown.ts';
import { cloneActorWithFreshCharacterIds, clonePortableScript, deleteActorCharacter, isValidActor } from './actor-model.ts';
import { parseImportJson, serializeScripts } from './library-data.ts';
import { createLibraryEnvelope, parseLibraryData } from './store-persistence.ts';
import { getCharacterColor, nextCharacterColor } from './actor-colors.ts';
import type { Script } from './types.ts';

function fixture(): Script {
  return { id: 'play', title: 'The return', purpose: 'performance', createdAt: 1, updatedAt: 1,
    actor: { enabled: true, myRoleIds: ['alex'], characters: [
      { id: 'alex', name: 'Alex', accentColor: '#14b8a6', age: '', gender: '', style: '', voice: { engine: 'system', voiceId: '', rate: 1 } },
      { id: 'jamie', name: 'Jamie', accentColor: '#f59e0b', age: '30s', gender: '', style: 'Quiet', voice: { engine: 'system', voiceId: 'local-1', rate: 1 } },
    ] }, sections: [
      { id: 'one', title: 'Opening', characterId: 'alex', notes: 'Take a breath.\nThen speak.', content: '\nWelcome back.\n\n# literal heading\n**Jamie:**\n> literal dialogue\n\\backslash\n' },
      { id: 'two', title: 'Reply', characterId: 'jamie', content: 'I had to come back.' },
    ] };
}

test('Markdown round-trip preserves dialogue whitespace, literal markup, identities, notes and cast settings', () => {
  const script = fixture();
  const result = parseScriptMarkdown(scriptToMarkdown(script), script);
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.deepEqual(result.updates.sections, script.sections);
  assert.deepEqual(result.updates.actor, script.actor);
  assert.equal(result.updates.title, script.title);
});

test('writing character cues creates turns, reuses cast and allocates colours without changing existing roles', () => {
  const script = fixture();
  let id = 0;
  const result = parseScriptMarkdown('# New scene\n## Opening\n**Alex:** Hello.\n> Quietly\n**Jamie:** Welcome.\n**Sam:** Good evening.', script, () => `new-${++id}`);
  assert.ok(result.ok);
  assert.equal(result.updates.sections?.length, 3);
  assert.equal(result.updates.sections?.[0].notes, 'Quietly');
  assert.equal(result.updates.sections?.[0].content, 'Hello.');
  assert.deepEqual(result.updates.actor?.myRoleIds, ['alex']);
  assert.equal(result.updates.actor?.characters[1].voice.voiceId, 'local-1');
  assert.deepEqual(result.newCharacters, ['Sam']);
  assert.equal(result.updates.actor?.characters[2].accentColor, nextCharacterColor(script.actor!.characters));
  assert.equal(script.actor?.characters.length, 2);
});

test('removing character markup unassigns dialogue while retaining cast, colours and roles', () => {
  const script = fixture();
  const result = parseScriptMarkdown('# The return\n## Opening\n\nA monologue.', script);
  assert.ok(result.ok);
  assert.equal(result.updates.sections?.[0].characterId, null);
  assert.deepEqual(result.updates.actor, script.actor);
});

test('plain presentation stays a presentation; character markup enables performance setup', () => {
  const script = { ...fixture(), purpose: 'presentation' as const, actor: undefined, sections: [{ id: 'one', title: 'Introduction', content: 'Hello.' }] };
  const plain = parseScriptMarkdown(scriptToMarkdown(script), script);
  assert.ok(plain.ok);
  assert.equal(plain.updates.purpose, undefined);
  assert.deepEqual(plain.updates.sections, script.sections);
  const scene = parseScriptMarkdown('**Alex:** Hello.', script);
  assert.ok(scene.ok);
  assert.equal(scene.updates.purpose, 'performance');
});

test('portable Markdown excludes personal notes by default and includes marked notes explicitly', () => {
  const script = fixture();
  script.personalNotes = [{
    id: 'note-1',
    sectionId: 'one',
    content: 'Breathe before the reply.',
    createdAt: 1,
    updatedAt: 1,
  }];
  const portable = scriptToMarkdown(script);
  assert.equal(portable.includes('Breathe before'), false);
  const withNotes = scriptToMarkdown(script, { includePersonalNotes: true });
  assert.match(withNotes, /> \[Personal note\] Breathe before the reply\./);
  const parsed = parseScriptMarkdown(withNotes, script, (() => {
    let id = 0;
    return () => `note-import-${++id}`;
  })());
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.updates.personalNotes?.[0].content, 'Breathe before the reply.');
});

test('portable JSON clones exclude private notes unless explicitly included', () => {
  const script = fixture();
  script.personalNotes = [{
    id: 'private-note',
    sectionId: 'one',
    content: 'Do not share this rehearsal note.',
    createdAt: 1,
    updatedAt: 1,
  }];
  assert.equal(clonePortableScript(script).personalNotes, undefined);
  assert.deepEqual(clonePortableScript(script, true).personalNotes, script.personalNotes);
});

test('invalid Markdown gives errors without mutating the saved script', () => {
  const script = fixture();
  const before = JSON.stringify(script);
  for (const source of ['', '# A\n# B', '## '+ 'a'.repeat(201), '## Turn\n\n'+'a'.repeat(500001)]) {
    assert.equal(parseScriptMarkdown(source, script).ok, false);
  }
  assert.equal(JSON.stringify(script), before);
  script.actor!.characters[1].name = 'Alex';
  assert.equal(parseScriptMarkdown('**Alex:** Hello.', script).ok, false);
});

test('character accents survive backups, portable exports, remapping and cast deletion', () => {
  const script = fixture();
  const imported = parseImportJson(serializeScripts([script]));
  assert.equal(imported?.[0].actor?.characters[0].accentColor, '#14b8a6');
  const backup = parseLibraryData(JSON.stringify(createLibraryEnvelope([script], script.id)));
  assert.ok(backup.ok);
  assert.equal(backup.library.scripts[0].actor?.characters[1].accentColor, '#f59e0b');
  let id = 0;
  const remapped = cloneActorWithFreshCharacterIds(script.actor!, () => `copy-${++id}`);
  assert.equal(remapped?.actor.characters[0].accentColor, '#14b8a6');
  assert.deepEqual(remapped?.actor.myRoleIds, ['copy-1']);
  assert.equal(deleteActorCharacter(script.actor!, 'alex').characters[0].accentColor, '#f59e0b');
  delete script.actor!.characters[0].accentColor;
  assert.ok(isValidActor(script.actor));
  assert.match(getCharacterColor(script.actor!.characters[0]), /^#[0-9a-f]{6}$/);
  script.actor!.characters[0].accentColor = 'url(https://example.test)';
  assert.equal(isValidActor(script.actor), false);
  assert.equal(parseImportJson(serializeScripts([script])), null);
});

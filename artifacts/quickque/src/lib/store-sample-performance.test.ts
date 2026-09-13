import assert from 'node:assert/strict';
import test from 'node:test';
import { createMatildaSample } from './sample-performance.ts';
import { isValidScript, parseImportJson, serializeScripts } from './library-data.ts';
import { getSceneSetupIssues } from './script-purpose.ts';
import { scriptToMarkdown, parseScriptMarkdown } from './script-markdown.ts';

test('Matilda sample preserves excerpt order, four coloured characters and separate stage directions', () => {
  let id = 0;
  const script = createMatildaSample([], 123, () => `sample-${++id}`);
  assert.ok(isValidScript(script));
  assert.equal(script.purpose, 'performance');
  assert.equal(script.sections.length, 14);
  assert.deepEqual(script.actor?.characters.map(character => character.name), ['Matilda', 'Miss Honey', 'Nigel', 'Lavender']);
  assert.equal(new Set(script.actor?.characters.map(character => character.accentColor)).size, 4);
  const matilda = script.actor!.characters[0];
  assert.deepEqual(script.actor?.myRoleIds, [matilda.id]);
  assert.equal(script.sections.filter(section => section.characterId === matilda.id).length, 3);
  assert.equal(script.sections[0].content, 'Me, me, me, oooh, oooh, me, pick me miss, I can, mememememe—');
  assert.equal(script.sections.at(-1)?.content, 'A few? What books did you read?');
  assert.match(script.sections[1].notes!, /NIGEL opens his mouth/);
  assert.match(script.sections[2].notes!, /NIGEL droops/);
  assert.equal(script.sections.filter(section => section.notes).length, 2);
  assert.ok(script.sections.every(section => !section.content.includes('NIGEL')));
  const roundtrip = parseScriptMarkdown(scriptToMarkdown(script), script);
  assert.ok(roundtrip.ok);
  assert.deepEqual(roundtrip.updates.sections, script.sections);
  assert.deepEqual(parseImportJson(serializeScripts([script]))?.[0].actor, script.actor);
});

test('sample uses only discovered English voices and reports setup issues when none are available', () => {
  const script = createMatildaSample([
    { id: 'french', name: 'French', language: 'fr-FR', engine: 'turbo' },
    { id: 'english-1', name: 'English 1', language: 'en-GB', engine: 'turbo' },
    { id: 'english-2', name: 'English 2', language: 'en-US', engine: 'turbo' },
  ]);
  assert.deepEqual(script.actor?.characters.map(character => character.voice.voiceId), ['', 'english-1', 'english-2', 'english-1']);
  assert.deepEqual(getSceneSetupIssues(script, new Set(['english-1', 'english-2'])), []);
  assert.equal(getSceneSetupIssues(createMatildaSample()).length, 3);
  const another = createMatildaSample();
  assert.notEqual(script.id, another.id);
  assert.ok(script.sections.every(section => !another.sections.some(other => other.id === section.id)));
});

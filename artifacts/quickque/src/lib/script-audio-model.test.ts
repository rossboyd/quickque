import test from 'node:test';
import assert from 'node:assert/strict';
import { audioRequest, scriptAudioEntries, DEFAULT_AUDIO_VOICE } from './script-audio-model.ts';
import type { Script } from './types.ts';
const script: Script = {
  id: 's', title: 'Sample', purpose: 'performance', createdAt: 1, updatedAt: 1,
  actor: { enabled: true, myRoleIds: ['me'], characters: ['me', 'ai', 'system'].map(id => ({ id, name: id, age: '', gender: '', style: '', voice: { engine: id === 'system' ? 'system' : 'turbo', voiceId: DEFAULT_AUDIO_VOICE, rate: 1 } })) },
  sections: [
    { id: 'a', title: 'Act one', content: 'My line.', characterId: 'me' },
    { id: 'b', title: 'Stage', content: 'Partner line.', notes: 'Exit stage left.', characterId: 'ai' },
    { id: 'c', title: '', content: 'System line.', characterId: 'system' },
    { id: 'd', title: 'Cue', content: 'Unassigned.', characterId: null },
  ],
};
test('only Chatterbox AI Partner dialogue enters performance generation', () => {
  assert.deepEqual(scriptAudioEntries(script), [{ id: 'b', text: 'Partner line.', voiceId: DEFAULT_AUDIO_VOICE, rate: 1 }]);
  assert.deepEqual(scriptAudioEntries({ ...script, actor: { ...script.actor!, enabled: false } }), []);
});
test('presentation narration includes script text without notes or section titles', () => {
  const entries = scriptAudioEntries({ ...script, purpose: 'presentation' });
  assert.equal(entries.length, 4);
  assert.equal(entries[1].text, 'Partner line.');
});
test('cache revision ignores cosmetic edits and changes with dialogue, voice, assignment and order', async () => {
  const original = await audioRequest(script);
  assert.equal((await audioRequest({ ...script, title: 'Renamed', updatedAt: 900 })).revision, original.revision);
  assert.notEqual((await audioRequest({ ...script, sections: script.sections.map(s => s.id === 'b' ? { ...s, content: 'New line' } : s) })).revision, original.revision);
  assert.notEqual((await audioRequest({ ...script, actor: { ...script.actor!, myRoleIds: ['me', 'ai'] } })).revision, original.revision);
  const talk = { ...script, purpose: 'presentation' as const };
  assert.notEqual((await audioRequest(talk)).revision, (await audioRequest({ ...talk, sections: [...talk.sections].reverse() })).revision);
});

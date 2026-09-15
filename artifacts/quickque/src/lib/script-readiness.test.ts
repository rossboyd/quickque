import assert from 'node:assert/strict';
import test from 'node:test';
import type { Script } from './types.ts';
import {
  clearSetupCheckpoint,
  getDeliverySuggestions,
  getScriptFingerprint,
  getScriptReadiness,
  loadSetupCheckpoint,
  saveSetupCheckpoint,
} from './script-readiness.ts';
import { scriptAudioEntries } from './script-audio-model.ts';
import { deleteActorCharacter } from './actor-model.ts';

const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

function script(overrides: Partial<Script> = {}): Script {
  return {
    id: 'scene-1',
    title: 'A scene',
    purpose: 'performance',
    createdAt: 1,
    updatedAt: 1,
    actor: {
      enabled: true,
      characters: [{
        id: 'alex',
        name: 'Alex',
        age: '',
        gender: '',
        style: '',
        voice: { engine: 'turbo', voiceId: 'voice-1', voiceRevision: 2, rate: 1 },
      }],
      myRoleIds: ['alex'],
    },
    sections: [{
      id: 'turn-1',
      title: 'Opening',
      content: 'Hello.',
      characterId: 'alex',
      notes: 'angry',
    }],
    ...overrides,
  };
}

test('legacy role selections do not count as explicit confirmation', () => {
  const result = getScriptReadiness(script());
  assert.equal(result.ready, false);
  assert.equal(result.issues.some(issue => issue.code === 'role-unconfirmed'), true);
});

test('computer partners require available matching local voice and revision', () => {
  const value = script({
    actor: {
      ...script().actor!,
      myRoleIds: [],
      roleAssignments: { alex: 'computer-partner' },
    },
  });
  const missing = getScriptReadiness(value, { availableVoices: [{ referenceId: 'voice-1', revision: 1 }] });
  assert.equal(missing.issues.some(issue => issue.code === 'voice-outdated'), true);
  const ready = getScriptReadiness(value, {
    availableVoices: [{ referenceId: 'voice-1', revision: 2 }],
    audioReady: true,
  });
  assert.equal(ready.ready, true);
});

test('another-person and my-role are both human and never enter TTS', () => {
  const value = script({
    actor: {
      ...script().actor!,
      myRoleIds: ['alex'],
      roleAssignments: { alex: 'another-person' },
    },
  });
  const result = getScriptReadiness(value, { audioReady: false });
  assert.equal(result.ready, true);
  assert.deepEqual(scriptAudioEntries(value), []);
});

test('stale role assignments are removed when a character is deleted', () => {
  const value = script({
    actor: {
      ...script().actor!,
      roleAssignments: { alex: 'computer-partner' },
    },
  });
  const actor = value.actor!;
  const cleaned = deleteActorCharacter(actor, 'alex');
  assert.deepEqual(cleaned.roleAssignments, {});
  assert.equal(getScriptReadiness({ ...value, actor: cleaned }).issues.some(issue => issue.code === 'role-unconfirmed'), false);
});

test('checkpoint is resumable but invalidated by script changes', () => {
  const memory = storage();
  const value = script();
  assert.equal(saveSetupCheckpoint({
    scriptId: value.id,
    scriptFingerprint: getScriptFingerprint(value),
    currentStep: 'choose-your-role',
    completedSteps: ['add-script', 'review-script-and-cast'],
    mode: 'practice-without-partner-audio',
    roleAssignments: {},
  }, memory), true);
  assert.equal(loadSetupCheckpoint(value.id, value, memory)?.currentStep, 'choose-your-role');
  assert.equal(loadSetupCheckpoint(value.id, { ...value, title: 'Changed' }, memory), null);
  assert.equal(clearSetupCheckpoint(value.id, memory), true);
  assert.equal(loadSetupCheckpoint(value.id, undefined, memory), null);
});

test('delivery suggestions quote notes and stay conservative', () => {
  const suggestions = getDeliverySuggestions(script());
  assert.equal(suggestions[0]?.tags[0], 'angry');
  assert.equal(suggestions[0]?.sourceExcerpt, 'angry');
  assert.match(suggestions[0]?.explanation ?? '', /preview and approve/i);
  const unclear = getDeliverySuggestions(script({
    sections: [{ ...script().sections[0], notes: 'angry and calm' }],
  }));
  assert.equal(unclear[0]?.status, 'needs-your-choice');
});

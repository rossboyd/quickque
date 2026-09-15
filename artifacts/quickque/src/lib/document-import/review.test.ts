import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignImportTurn,
  createImportReviewDraft,
  mergeImportCharacter,
  splitUnstructuredImport,
  treatImportTurnAsDialogue,
  treatImportTurnAsDirection,
  validateImportReviewDraft,
} from './review.ts';

const scene = (text: string, format: 'txt' | 'md' | 'pdf' = 'md') => createImportReviewDraft({
  title: 'Scene',
  text,
  fileName: `scene.${format}`,
  format,
  purpose: 'performance',
});

test('continuation variants and case resolve to one reviewed character without changing dialogue', () => {
  const draft = scene([
    '**BREWSTER:** First.',
    "**Brewster (CONT'D):** Second.",
    '**Brewster (CONT’D):** Third.',
    '**Brewster (continued):** Fourth.',
    "**(CONT'D):** Fifth.",
  ].join('\n'));
  assert.equal(draft.characters.length, 1);
  assert.equal(draft.characters[0].name, 'BREWSTER');
  assert.deepEqual(draft.sections.map(turn => turn.content), ['First.', 'Second.', 'Third.', 'Fourth.', 'Fifth.']);
  assert.ok(draft.sections.every(turn => turn.characterId === draft.characters[0].id));
  assert.deepEqual(draft.issues, []);
});

test('standalone continuation without prior context stays visible and unassigned', () => {
  const draft = scene("**(CONT'D):** Keep every word.");
  assert.equal(draft.characters.length, 0);
  assert.equal(draft.sections[0].content, 'Keep every word.');
  assert.equal(draft.sections[0].characterId, null);
  assert.match(draft.issues[0].message, /Choose who/);
});

test('similar names remain separate until explicitly merged', () => {
  const draft = scene('**Ann:** Hi.\n**Anna:** Hello.');
  assert.deepEqual(draft.characters.map(character => character.name), ['Ann', 'Anna']);
  const merged = mergeImportCharacter(draft, draft.characters[1].id, draft.characters[0].id);
  assert.equal(merged.characters.length, 1);
  assert.ok(merged.sections.every(turn => turn.characterId === merged.characters[0].id));
});

test('plain text parsing is conservative and keeps directions separate', () => {
  const draft = scene('BREWSTER:\n(quietly)\nKeep the literal **markup**.\n\nANNA:\nReply.', 'txt');
  assert.equal(draft.sections.length, 2);
  assert.equal(draft.sections[0].notes, '(quietly)');
  assert.match(draft.sections[0].content, /\*\*markup\*\*/);
  assert.equal(draft.sections[1].content, 'Reply.');
});

test('ambiguous PDF remains unstructured with manual guidance', () => {
  const draft = scene('Brewster says hello in a complex two-column layout.', 'pdf');
  assert.equal(draft.structured, false);
  assert.equal(draft.sections[0].content, draft.provenance.originalText);
  assert.match(draft.issues[0].message, /No reliable speaker cues/);
});

test('presentation confirmation retains exact source as one section', () => {
  const text = '**BREWSTER:** This remains presentation text.';
  const draft = createImportReviewDraft({
    title: 'Talk',
    text,
    fileName: 'talk.md',
    format: 'md',
    purpose: 'presentation',
  });
  assert.equal(draft.characters.length, 0);
  assert.deepEqual(draft.sections.map(section => section.content), [text]);
});

test('manual assignment preserves dialogue and clears continuation review', () => {
  const draft = scene("**(CONT'D):** Keep this.");
  const withCharacter = {
    ...draft,
    characters: [{
      id: 'manual',
      name: 'Brewster',
      age: '',
      gender: '',
      style: '',
      voice: { engine: 'turbo' as const, voiceId: '', rate: 1 },
    }],
  };
  const assigned = assignImportTurn(withCharacter, draft.sections[0].id, 'manual');
  assert.equal(assigned.sections[0].content, 'Keep this.');
  assert.equal(assigned.sections[0].characterId, 'manual');
  assert.deepEqual(assigned.issues, []);
});

test('headings and opening directions are preserved with the following turn', () => {
  const draft = scene('# Scene one\n## Kitchen\n> Before sunrise\n**ANN:** Morning.\n## Hall\n**BOB:** Hello.');
  assert.equal(draft.sections[0].notes, '# Scene one\n## Kitchen\n> Before sunrise');
  assert.equal(draft.sections[0].content, 'Morning.');
  assert.equal(draft.sections[1].notes, '## Hall');
  assert.equal(draft.sections[1].content, 'Hello.');
});

test('assigning one ambiguous continuation leaves the others flagged', () => {
  const draft = scene("**(CONT'D):** First.\n**(CONT'D):** Second.");
  assert.equal(draft.issues.length, 2);
  const assigned = assignImportTurn(draft, draft.sections[0].id, 'manual');
  assert.equal(assigned.issues.length, 1);
  assert.equal(assigned.issues[0].sectionId, draft.sections[1].id);
});

test('a direction after dialogue is not converted into spoken content', () => {
  const draft = scene('**ANN:** Morning.\n(She exits.)\n**BOB:** Hello.');
  assert.equal(draft.sections[0].content, 'Morning.');
  assert.equal(draft.sections[1].notes, '(She exits.)');
  assert.equal(draft.sections[1].content, 'Hello.');
});

test('plain screenplay headings remain directions rather than cast members', () => {
  const draft = scene('ACT ONE\nINT. KITCHEN - DAY\n\nANN:\nMorning.\n\nCUT TO:\nEXT. GARDEN - DAY\n\nBOB:\nHello.', 'txt');
  assert.deepEqual(draft.characters.map(character => character.name), ['ANN', 'BOB']);
  assert.match(draft.sections[0].notes ?? '', /ACT ONE/);
  assert.match(draft.sections[0].notes ?? '', /INT\. KITCHEN/);
  assert.match(draft.sections[1].notes ?? '', /CUT TO:/);
  assert.match(draft.sections[1].notes ?? '', /EXT\. GARDEN/);
});

test('dialogue after a parenthetical remains spoken by the same character', () => {
  const draft = scene('**ANN:** Morning.\n(beat)\nActually, wait.');
  assert.equal(draft.sections.length, 2);
  assert.equal(draft.sections[1].notes, '(beat)');
  assert.equal(draft.sections[1].content, 'Actually, wait.');
  assert.equal(draft.sections[1].characterId, draft.sections[0].characterId);
});

test('clear cues are candidates after DOCX, RTF and PDF extraction', () => {
  for (const format of ['docx', 'rtf', 'pdf'] as const) {
    const draft = scene('ANN:\nHello.\n\nBOB:\nHi.', format);
    assert.deepEqual(draft.characters.map(character => character.name), ['ANN', 'BOB']);
    assert.equal(draft.sections.length, 2);
  }
});

test('plain continuation suffixes resolve across extracted formats', () => {
  for (const format of ['txt', 'docx', 'rtf', 'pdf'] as const) {
    const draft = scene("ANN:\nFirst.\n\nANN (CONT'D):\nSecond.\n\nANN (CONTINUED):\nThird.", format);
    assert.equal(draft.characters.length, 1);
    assert.deepEqual(draft.sections.map(section => section.content.trim()), ['First.', 'Second.', 'Third.']);
  }
});

test('unstructured performance requires explicit manual structuring', () => {
  const draft = scene('First paragraph.\n\nSecond paragraph.', 'pdf');
  assert.equal(draft.issues.length, 1);
  assert.match(validateImportReviewDraft(draft) ?? '', /Resolve every structural/);
  const split = splitUnstructuredImport(draft);
  assert.equal(split.issues.length, 0);
  assert.match(validateImportReviewDraft(split) ?? '', /Assign a speaker/);
  assert.deepEqual(split.sections.map(section => section.content), ['First paragraph.', 'Second paragraph.']);
});

test('a falsely detected cue can be restored as exact dialogue', () => {
  const draft = scene('ANN:\nHello.', 'docx');
  const corrected = treatImportTurnAsDialogue(draft, draft.sections[0].id);
  assert.equal(corrected.sections[0].characterId, null);
  assert.equal(corrected.sections[0].content, 'ANN:\nHello.');
});

test('an inline false cue is restored byte-for-byte', () => {
  const draft = scene('ANN: Hello there.', 'rtf');
  const corrected = treatImportTurnAsDialogue(draft, draft.sections[0].id);
  assert.equal(corrected.sections[0].content, 'ANN: Hello there.');
});

test('reclassifying a false cue removes its orphaned cast entry', () => {
  const draft = scene('A MOMENT LATER\nANN:\nHello.', 'txt');
  assert.deepEqual(draft.characters.map(character => character.name), ['A MOMENT LATER', 'ANN']);
  const corrected = treatImportTurnAsDirection(draft, draft.sections[0].id);
  assert.deepEqual(corrected.characters.map(character => character.name), ['ANN']);
  assert.equal(corrected.sections[0].content, '');
  assert.match(corrected.sections[0].notes ?? '', /A MOMENT LATER/);
});

test('spoken performance turns must all have reviewed assignments', () => {
  const draft = scene('ANN:\nHello.', 'txt');
  const unassigned = assignImportTurn(draft, draft.sections[0].id, null);
  assert.match(validateImportReviewDraft(unassigned) ?? '', /Assign a speaker/);
});
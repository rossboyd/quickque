import assert from 'node:assert/strict';
import test from 'node:test';
import { ReaderTokenizationCache } from './reader-tokenization.ts';

const sections = [
  { id: 'first', title: 'First', content: 'Hello, reader.' },
  { id: 'second', title: 'Second', content: 'Keep your place.' },
];

test('presentation commits with defensively cloned sections retain Flow token identity', () => {
  const cache = new ReaderTokenizationCache();
  const beforePreferenceCommit = cache.get('script-1', sections);

  // commitLibrary clones every section even though updating presentation does
  // not alter copy. Flow must receive the original token array/aligner input.
  const clonedByPreferenceCommit = sections.map(section => ({ ...section }));
  const afterPreferenceCommit = cache.get('script-1', clonedByPreferenceCommit);

  assert.strictEqual(afterPreferenceCommit, beforePreferenceCommit);
  assert.strictEqual(afterPreferenceCommit.tokens, beforePreferenceCommit.tokens);
  assert.strictEqual(
    afterPreferenceCommit.enrichedSections,
    beforePreferenceCommit.enrichedSections,
  );
});

test('copy or section metadata edits intentionally rebuild Flow tokenization', () => {
  const cache = new ReaderTokenizationCache();
  const original = cache.get('script-1', sections);
  const changedCopy = cache.get('script-1', [
    { ...sections[0], content: 'Hello, changed reader.' },
    sections[1],
  ]);
  const changedTitle = cache.get('script-1', [
    { ...sections[0], title: 'Renamed' },
    sections[1],
  ]);

  assert.notStrictEqual(changedCopy.tokens, original.tokens);
  assert.notStrictEqual(changedTitle.enrichedSections, changedCopy.enrichedSections);
});
import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisibleScripts } from './library-management.ts';
import type { Script } from './types.ts';

function script(id: string, title: string, updatedAt: number, body = ''): Script {
  return {
    id,
    title,
    createdAt: updatedAt,
    updatedAt,
    sections: [{ id: `${id}-section`, title: 'Notes', content: body }],
  };
}

const scripts = [
  script('one', 'Bravo', 10, 'A searchable phrase'),
  script('two', 'alpha', 30),
  script('three', 'Charlie', 20),
];

test('searches title, section title, and body case-insensitively after trimming', () => {
  assert.deepEqual(
    getVisibleScripts(scripts, '  SEARCHABLE PHRASE ', 'custom', ['one', 'two', 'three'])
      .map(item => item.id),
    ['one'],
  );
  assert.deepEqual(
    getVisibleScripts(scripts, ' notes ', 'custom', ['one', 'two', 'three'])
      .map(item => item.id),
    ['one', 'two', 'three'],
  );
});

test('sorts newest, oldest, and title order stably', () => {
  assert.deepEqual(getVisibleScripts(scripts, '', 'newest', []).map(item => item.id), [
    'two', 'three', 'one',
  ]);
  assert.deepEqual(getVisibleScripts(scripts, '', 'oldest', []).map(item => item.id), [
    'one', 'three', 'two',
  ]);
  assert.deepEqual(getVisibleScripts(scripts, '', 'az', []).map(item => item.id), [
    'two', 'one', 'three',
  ]);
  assert.deepEqual(getVisibleScripts(scripts, '', 'za', []).map(item => item.id), [
    'three', 'one', 'two',
  ]);
});

test('newest and oldest use creation time rather than edit recency', () => {
  const edited = scripts.map(item => ({ ...item, sections: item.sections.map(section => ({ ...section })) }));
  edited[0].updatedAt = 10_000;
  edited[2].updatedAt = 1;
  assert.deepEqual(getVisibleScripts(edited, '', 'newest', []).map(item => item.id), [
    'two', 'three', 'one',
  ]);
});

test('custom order keeps omitted scripts stable at the end', () => {
  assert.deepEqual(
    getVisibleScripts(scripts, '', 'custom', ['three', 'one']).map(item => item.id),
    ['three', 'one', 'two'],
  );
});
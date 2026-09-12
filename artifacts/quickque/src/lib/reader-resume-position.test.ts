import assert from 'node:assert/strict';
import test from 'node:test';
import type { Script } from './types.ts';
import {
  clearResumePosition,
  MAX_READER_RESUME_ENVELOPE_BYTES,
  MAX_READER_RESUME_POSITIONS,
  pruneResumePositions,
  QUICKQUE_READER_RESUME_KEY,
  readResumePosition,
  saveResumePosition,
} from './reader-resume-position.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  shouldThrowOnGet = false;
  shouldThrowOnSet = false;
  setCalls = 0;

  getItem(key: string): string | null {
    if (this.shouldThrowOnGet) throw new Error('read failed');
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrowOnSet) throw new Error('write failed');
    this.setCalls += 1;
    this.values.set(key, value);
  }

  put(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function script(
  sections: Script['sections'] = [
    { id: 'first', title: 'First', content: 'Hello, reader.' },
    { id: 'second', title: 'Second', content: 'Keep your place.' },
  ],
): Script {
  return {
    id: 'script-1',
    title: 'A script',
    sections,
    createdAt: 1,
    updatedAt: 1,
  };
}

test('saves only a section/source offset and resolves it to the rendered anchor', () => {
  const storage = new MemoryStorage();
  const current = script();

  // first:2 is the "reader" token span. The preceding "Hello, " occupies
  // UTF-16 source offsets 0 through 6.
  const saved = saveResumePosition(current, 'first:2', false, storage);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(saved.position, {
    anchorId: 'first:2',
    sectionId: 'first',
    sourceOffset: 7,
    completed: false,
  });

  const raw = storage.getItem(QUICKQUE_READER_RESUME_KEY);
  assert.ok(raw);
  assert.doesNotMatch(raw, /reader|Hello|transcript|audio|elapsed|text/);
  const envelope = JSON.parse(raw);
  assert.deepEqual(envelope.positions['script-1'], {
    fingerprint: envelope.positions['script-1'].fingerprint,
    sectionId: 'first',
    sourceOffset: 7,
    completed: false,
  });

  assert.deepEqual(readResumePosition(current, storage), saved);
});

test('keeps a title-only edit valid because the fingerprint covers copy, not presentation metadata', () => {
  const storage = new MemoryStorage();
  const current = script();
  assert.equal(saveResumePosition(current, 'second:0', false, storage).ok, true);

  const renamed = script([
    current.sections[0],
    { ...current.sections[1], title: 'Renamed' },
  ]);
  const read = readResumePosition(renamed, storage);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.position?.anchorId, 'second:0');
  assert.equal(read.position?.sourceOffset, 0);
});

test('resets safely when copy changes or its saved section is deleted', () => {
  const storage = new MemoryStorage();
  const current = script();
  assert.equal(saveResumePosition(current, 'second:0', false, storage).ok, true);

  const edited = script([
    current.sections[0],
    { ...current.sections[1], content: 'A changed line.' },
  ]);
  assert.deepEqual(readResumePosition(edited, storage), { ok: true, position: null });

  const deleted = script([current.sections[0]]);
  assert.deepEqual(readResumePosition(deleted, storage), { ok: true, position: null });
});

test('completed positions retain completion but expose no end anchor', () => {
  const storage = new MemoryStorage();
  const current = script();
  const saved = saveResumePosition(current, 'second:5', true, storage);
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.position.anchorId, null);
  assert.equal(saved.position.completed, true);

  const read = readResumePosition(current, storage);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.deepEqual(read.position, {
    anchorId: null,
    sectionId: 'second',
    sourceOffset: 15,
    completed: true,
  });
});

test('rejects anchors that are not current rendered anchors without writing', () => {
  const storage = new MemoryStorage();
  const current = script();

  assert.deepEqual(
    saveResumePosition(current, 'first:999', false, storage),
    { ok: false, error: 'Reader anchor is not present in the current script.' },
  );
  assert.equal(storage.getItem(QUICKQUE_READER_RESUME_KEY), null);
});

test('malformed or out-of-range saved locations fall back without throwing', () => {
  const storage = new MemoryStorage();
  const current = script();
  const fingerprint = (() => {
    const saved = saveResumePosition(current, 'first:0', false, storage);
    assert.equal(saved.ok, true);
    return saved.ok
      ? JSON.parse(storage.getItem(QUICKQUE_READER_RESUME_KEY) as string).positions['script-1'].fingerprint
      : '';
  })();

  storage.put(QUICKQUE_READER_RESUME_KEY, JSON.stringify({
    version: 1,
    positions: {
      'script-1': {
        fingerprint,
        sectionId: 'first',
        sourceOffset: current.sections[0].content.length,
        completed: false,
      },
    },
  }));
  assert.deepEqual(readResumePosition(current, storage), { ok: true, position: null });

  storage.put(QUICKQUE_READER_RESUME_KEY, '{malformed');
  assert.deepEqual(readResumePosition(current, storage), { ok: true, position: null });
});

test('clear removes one script position and leaves the dedicated key separate from exports', () => {
  const storage = new MemoryStorage();
  const current = script();
  const other = { ...current, id: 'script-2' };
  assert.equal(saveResumePosition(current, 'first:0', false, storage).ok, true);
  assert.equal(saveResumePosition(other, 'second:0', false, storage).ok, true);

  assert.deepEqual(clearResumePosition(current.id, storage), { ok: true });
  assert.deepEqual(readResumePosition(current, storage), { ok: true, position: null });
  assert.equal(readResumePosition(other, storage).ok, true);
  assert.equal(storage.getItem('quickque_scripts'), null);
});

test('storage failures are explicit results rather than thrown errors', () => {
  const storage = new MemoryStorage();
  const current = script();

  storage.shouldThrowOnGet = true;
  assert.deepEqual(readResumePosition(current, storage), {
    ok: false,
    error: 'Failed to read reader resume position.',
  });
  assert.deepEqual(saveResumePosition(current, 'first:0', false, storage), {
    ok: false,
    error: 'Failed to save reader resume position.',
  });
  assert.deepEqual(clearResumePosition(current.id, storage), {
    ok: false,
    error: 'Failed to clear reader resume position.',
  });

  storage.shouldThrowOnGet = false;
  storage.shouldThrowOnSet = true;
  assert.deepEqual(saveResumePosition(current, 'first:0', false, storage), {
    ok: false,
    error: 'Failed to save reader resume position.',
  });
});

test('repeated checkpoints reuse the saved value without repeated storage writes', () => {
  const storage = new MemoryStorage();
  const current = script();
  assert.equal(saveResumePosition(current, 'first:0', false, storage).ok, true);
  const writesAfterFirstSave = storage.setCalls;
  assert.equal(saveResumePosition(current, 'first:0', false, storage).ok, true);
  assert.equal(storage.setCalls, writesAfterFirstSave);
});

test('the resume envelope stays bounded while preserving the newest checkpoint', () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < MAX_READER_RESUME_POSITIONS + 8; index += 1) {
    const current = {
      ...script(),
      id: `script-${index}`,
    };
    assert.equal(saveResumePosition(current, 'first:0', false, storage).ok, true);
  }

  const raw = storage.getItem(QUICKQUE_READER_RESUME_KEY);
  assert.ok(raw);
  assert.ok(raw.length <= MAX_READER_RESUME_ENVELOPE_BYTES);
  const envelope = JSON.parse(raw);
  assert.ok(Object.keys(envelope.positions).length <= MAX_READER_RESUME_POSITIONS);
  assert.equal(
    readResumePosition({ ...script(), id: `script-${MAX_READER_RESUME_POSITIONS + 7}` }, storage).ok,
    true,
  );
});

test('prune removes positions for deleted scripts and reports storage failures', () => {
  const storage = new MemoryStorage();
  const first = { ...script(), id: 'script-first' };
  const second = { ...script(), id: 'script-second' };
  assert.equal(saveResumePosition(first, 'first:0', false, storage).ok, true);
  assert.equal(saveResumePosition(second, 'second:0', false, storage).ok, true);

  assert.deepEqual(pruneResumePositions(['script-second'], storage), { ok: true });
  assert.deepEqual(readResumePosition(first, storage), { ok: true, position: null });
  assert.equal(readResumePosition(second, storage).ok, true);

  storage.shouldThrowOnSet = true;
  assert.equal(saveResumePosition(first, 'first:1', false, storage).ok, false);
  assert.deepEqual(pruneResumePositions([], storage), {
    ok: false,
    error: 'Failed to prune reader resume positions.',
  });
});
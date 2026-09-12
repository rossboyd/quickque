import test from 'node:test';
import assert from 'node:assert/strict';
import { runExtraction } from './worker-task.ts';

function setup() {
  const fake = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onerror: null as ((event: { preventDefault(): void }) => void) | null,
    onmessageerror: null as (() => void) | null,
    terminated: false,
    posted: false,
    terminate() { this.terminated = true; },
    postMessage() { this.posted = true; },
  };
  const file = { name: 'speech.txt', size: 2, arrayBuffer: async () => new ArrayBuffer(2) };
  return { fake, file, factory: () => fake as unknown as Worker };
}

test('cancel before reading never constructs a worker', async () => {
  const { fake, file } = setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runExtraction(file, controller.signal, () => {
    assert.fail('Worker must not start');
  }), { name: 'AbortError' });
  assert.equal(fake.posted, false);
});

test('cancel during extraction terminates worker and ignores late results', async () => {
  const { fake, file, factory } = setup();
  const controller = new AbortController();
  const result = runExtraction(file, controller.signal, factory);
  await Promise.resolve();
  assert.equal(fake.posted, true);
  controller.abort();
  fake.onmessage?.({ data: { ok: true, result: { text: 'Late text' } } });
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(fake.terminated, true);
});

test('cancel while file read is pending never posts bytes', async () => {
  const { fake, file, factory } = setup();
  let done!: (value: ArrayBuffer) => void;
  file.arrayBuffer = () => new Promise(resolve => { done = resolve; });
  const controller = new AbortController();
  const result = runExtraction(file, controller.signal, factory);
  controller.abort();
  done(new ArrayBuffer(2));
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(fake.posted, false);
});

test('processing timeout terminates even an unresponsive worker', async () => {
  const { fake, file, factory } = setup();
  await assert.rejects(runExtraction(file, undefined, factory, 5), /took too long/);
  assert.equal(fake.terminated, true);
});

test('successful extraction releases the worker', async () => {
  const { fake, file, factory } = setup();
  const promise = runExtraction(file, undefined, factory);
  const result = { title: 'speech', text: 'Hello\n\n世界', format: 'txt', warnings: [] };
  fake.onmessage?.({ data: { ok: true, result } });
  assert.deepEqual(await promise, result);
  assert.equal(fake.terminated, true);
});

test('parser, worker startup, unreadable file, and invalid results fail explicitly', async () => {
  const { fake, file, factory } = setup();
  const promise = runExtraction(file, undefined, factory);
  fake.onmessage?.({ data: { ok: false, error: 'Scanned PDF: use OCR elsewhere.' } });
  await assert.rejects(promise, /OCR/);
  await assert.rejects(runExtraction(file, undefined, () => { throw new Error('CSP blocked'); }), /CSP/);
  await assert.rejects(runExtraction({ ...file, arrayBuffer: async () => { throw new Error(); } }, undefined, factory), /permissions/);
  const invalid = runExtraction(file, undefined, factory);
  fake.onmessage?.({ data: { ok: true, result: { text: '' } } });
  await assert.rejects(invalid, /No readable text/);
});
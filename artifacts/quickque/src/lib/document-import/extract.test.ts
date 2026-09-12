import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';
import { extractDocument } from './extract.ts';
import { IMPORT_LIMITS, validateFile } from './types.ts';

const fixtures = new URL('./fixtures/', import.meta.url);

async function fixture(name: string): Promise<ArrayBuffer> {
  const bytes = await readFile(new URL(name, fixtures));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('validates supported extensions and rejects unsafe file sizes', () => {
  assert.equal(validateFile('speech.TXT', 12), 'txt');
  assert.equal(validateFile('speech.docx', 12), 'docx');
  assert.equal(validateFile('speech.rtf', 12), 'rtf');
  assert.equal(validateFile('speech.pdf', 12), 'pdf');
  assert.throws(() => validateFile('speech.doc', 12), /Unsupported/);
  assert.throws(() => validateFile('speech.pdf', IMPORT_LIMITS.fileBytes + 1), /10 MB/);
});

test('extracts plain Unicode text without rendering markup', async () => {
  const result = await extractDocument('unicode.txt', await fixture('unicode.txt'));
  assert.equal(result.format, 'txt');
  assert.match(result.text, /Quickque — 世界/);
  assert.match(result.text, /<script>alert/);
});

test('extracts RTF paragraphs and Unicode while skipping rich payloads', async () => {
  const result = await extractDocument('unicode.rtf', await fixture('unicode.rtf'));
  assert.match(result.text, /Quickque 世界/);
  assert.match(result.text, /<script>not executed<\/script>/);
  assert.ok(result.warnings.length > 0);
});

test('decodes RTF Windows-1252 hex escapes and separates paragraphs', async () => {
  const source = String.raw`{\rtf1\ansi\ansicpg1252\pard \'93Quoted\'94\par Next}`;
  const bytes = new TextEncoder().encode(source);
  const result = await extractDocument('quoted.rtf', bytes.buffer);
  assert.match(result.text, /“Quoted”\n\nNext/);
});

test('skips RTF field instructions while retaining visible field results', async () => {
  const source = String.raw`{\rtf1\ansi{\field{\*\fldinst HYPERLINK "https://not-read.example"}{\fldrslt Visible link}}}`;
  const result = await extractDocument('field.rtf', new TextEncoder().encode(source).buffer);
  assert.equal(result.text, 'Visible link');
});

test('rejects RTF code pages that the local reader cannot decode', async () => {
  const source = String.raw`{\rtf1\ansi\ansicpg932 text}`;
  await assert.rejects(extractDocument('unsupported.rtf', new TextEncoder().encode(source).buffer), /code page/i);
});

test('extracts a real DOCX ZIP with bounded streaming expansion', async () => {
  const result = await extractDocument('tiny-unicode.docx', await fixture('tiny-unicode.docx'));
  assert.equal(result.title, 'Fixture document');
  assert.match(result.text, /Quickque — 世界\tscript/);
  assert.match(result.text, /Second paragraph/);
});

test('DOCX XML is namespace-aware and ignores field instructions', async () => {
  const xml = '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:r><x:fldinst>https://not-read.example</x:fldinst><x:fldrslt>Visible link</x:fldrslt></x:r></x:p></x:body></x:document>';
  const archive = zipSync({ 'word/document.xml': new TextEncoder().encode(xml) });
  const result = await extractDocument('namespaced.docx', archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength));
  assert.equal(result.text, 'Visible link');
});

test('encrypted and malformed DOCX files fail explicitly', async () => {
  const archive = new Uint8Array(await fixture('tiny-unicode.docx'));
  for (let offset = 0; offset + 4 <= archive.length; offset += 1) {
    const signature = archive[offset] | (archive[offset + 1] << 8) | (archive[offset + 2] << 16) | (archive[offset + 3] << 24);
    if ((signature >>> 0) === 0x04034b50) archive[offset + 6] |= 1;
    if ((signature >>> 0) === 0x02014b50) archive[offset + 8] |= 1;
  }
  await assert.rejects(extractDocument('encrypted.docx', archive.buffer), /Encrypted DOCX/i);

  const malformed = zipSync({
    'word/document.xml': new TextEncoder().encode('<!DOCTYPE document><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'),
  });
  await assert.rejects(
    extractDocument('malformed.docx', malformed.buffer.slice(malformed.byteOffset, malformed.byteOffset + malformed.byteLength)),
    /DTD|malformed|incomplete/i,
  );
});

test('empty and overlong text are rejected before a script can be saved', async () => {
  await assert.rejects(extractDocument('empty.txt', new ArrayBuffer(0)), /empty/i);
  await assert.rejects(
    extractDocument('empty.rtf', new TextEncoder().encode(String.raw`{\rtf1\ansi}`).buffer),
    /no readable|empty/i,
  );
  const emptyDocx = zipSync({
    'word/document.xml': new TextEncoder().encode('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t/></w:r></w:p></w:body></w:document>'),
  });
  await assert.rejects(
    extractDocument('empty.docx', emptyDocx.buffer.slice(emptyDocx.byteOffset, emptyDocx.byteOffset + emptyDocx.byteLength)),
    /no readable|empty/i,
  );
  const overlong = new TextEncoder().encode('x'.repeat(IMPORT_LIMITS.outputChars + 1));
  await assert.rejects(extractDocument('overlong.txt', overlong.buffer), /500,000/i);
});

test('extracts text from a real tiny PDF fixture', async () => {
  const result = await extractDocument('tiny-text.pdf', await fixture('tiny-text.pdf'));
  assert.equal(result.format, 'pdf');
  assert.match(result.text, /Cafeé PDF/);
  assert.match(result.text, /Second paragraph/);
});

test('extracts an ordinary Flate-compressed PDF with guarded decoders', async () => {
  const result = await extractDocument('tiny-compressed.pdf', await fixture('tiny-compressed.pdf'));
  assert.match(result.text, /Compressed Cafeé/);
  assert.match(result.text, /Unicode paragraph/);
});

test('reports image-only PDFs as an actionable OCR error', async () => {
  await assert.rejects(
    extractDocument('scanned-image-only.pdf', await fixture('scanned-image-only.pdf')),
    /no extractable text|scanned|OCR/i,
  );
});

test('malformed files fail explicitly instead of producing an empty script', async () => {
  await assert.rejects(
    extractDocument('bad.rtf', new TextEncoder().encode('{\\rtf1 unclosed').buffer),
    /malformed|incomplete/i,
  );
  await assert.rejects(
    extractDocument('bad.docx', new TextEncoder().encode('not a zip').buffer),
    /DOCX|corrupt/i,
  );
  await assert.rejects(
    extractDocument('bad.pdf', new TextEncoder().encode('%PDF-1.7\\nnot a document').buffer),
    /PDF|corrupt|stream/i,
  );
});

test('a ZIP whose members actually expand past the bound is rejected', async () => {
  const expanded = new Uint8Array(IMPORT_LIMITS.expandedBytes + 1);
  expanded.fill(65);
  const archive = zipSync({
    'word/document.xml': expanded,
  });
  await assert.rejects(
    extractDocument('expanded.docx', archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)),
    /32 MB|expands|DOCX/i,
  );
});
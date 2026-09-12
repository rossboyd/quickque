import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { extractDocument } from './extract.ts';
import { IMPORT_LIMITS } from './types.ts';
import { guardPdfWorker } from '../../../scripts/pdf-budget.mjs';

/** Construct byte-accurate PDFs, including compressed and malicious streams. */
function pdf(stream: Uint8Array, filter = '', extraCatalog = '', extraObjects: string[] = [], trailer = '') {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${extraCatalog} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} ${filter} >>\nstream\n${Buffer.from(stream).toString('latin1')}\nendstream`,
    ...extraObjects,
  ];
  let source = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((value, index) => {
    offsets.push(Buffer.byteLength(source, 'latin1'));
    source += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const xref = Buffer.byteLength(source, 'latin1');
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`;
  source += `trailer\n<< /Root 1 0 R /Size ${offsets.length} ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Buffer.from(source, 'latin1');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('PDF safety transform fails closed when upstream hook changes', () => {
  assert.throws(() => guardPdfWorker('unexpected source'), /PDF.js changed/);
  const original = readFileSync(new URL('../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url), 'utf8');
  const guarded = guardPdfWorker(original);
  assert.match(guarded, /__quickquePdfGuardInstalled/);
  assert.match(guarded, /reserve\(size - buffer.byteLength\)/);
  assert.ok(!guarded.includes('this.initializeFromPort(self);'));
});

test('actual PDF expansion is bounded even with escaped filter names and nested parameters', async () => {
  const compressed = deflateSync(Buffer.alloc(IMPORT_LIMITS.expandedBytes + 1, 32));
  for (const filter of ['/Filter /FlateDecode', '/Filter /Fl#61teDecode /DecodeParms << /Predictor 1 >>']) {
    await assert.rejects(extractDocument('bomb.pdf', pdf(compressed, filter)), /32 MB/);
  }
});

test('PDF output is bounded independently of compressed-stream size', async () => {
  // Keep each run inside the page; PDF.js correctly skips off-page glyphs.
  const run = `1 0 0 1 20 240 Tm (${'a'.repeat(50)}) Tj `;
  const stream = Buffer.from(`BT /F1 1 Tf ${run.repeat(10_001)} ET`);
  await assert.rejects(extractDocument('long.pdf', pdf(deflateSync(stream), '/Filter /FlateDecode')), /500,000/);
});

test('PDF JavaScript and external actions are not run or fetched', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => { assert.fail('Extraction must not fetch external or embedded resources'); };
  try {
    const source = pdf(Buffer.from('BT /F1 12 Tf 20 240 Td (<script>safe text</script>) Tj ET'),
      '', '/OpenAction 6 0 R', ['<< /S /JavaScript /JS (fetch\\(https://example.invalid\\)) >>']);
    const result = await extractDocument('action.pdf', source);
    assert.match(result.text, /<script>safe text<\/script>/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('encrypted PDF security dictionaries request an unlocked copy', async () => {
  const key = '00'.repeat(32);
  const locked = pdf(Buffer.from('encrypted data'), '', '', [
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <${key}> /U <${key}> >>`,
  ], `/Encrypt 6 0 R /ID [<${key}> <${key}>]`);
  await assert.rejects(extractDocument('locked.pdf', locked), /encrypted|password-protected/);
});
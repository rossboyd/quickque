import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const pdfRoot = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
export const PDF_RESOURCES_ID = 'virtual:quickque-pdf-resources';
export function pdfResourcesModule() {
  const collect = (directory, extensions) => Object.fromEntries(
    readdirSync(path.join(pdfRoot, directory))
      .filter(name => extensions.some(extension => name.endsWith(extension)))
      .map(name => [name, readFileSync(path.join(pdfRoot, directory, name)).toString('base64')]),
  );
  return `export const cmaps = ${JSON.stringify(collect('cmaps', ['.bcmap']))};
export const fonts = ${JSON.stringify(collect('standard_fonts', ['.pfb', '.ttf']))};`;
}

/**
 * Narrow, fail-closed adaptation of the pinned PDF.js worker, shared by Vite
 * and Node fixture tests. Never modify node_modules or silently omit a hook.
 */
export function guardPdfWorker(source) {
  const replaceOnce = (needle, replacement) => {
    if (source.split(needle).length !== 2) {
      throw new Error('PDF.js changed: review the document-import resource guards before building.');
    }
    source = source.replace(needle, replacement);
  };
  // Importing the PDF.js module inside a real browser worker otherwise starts
  // its own wire protocol and sends "ready" to our parent. We use the handler
  // only through PDF.js's in-process port, never its auto-bootstrap listener.
  replaceOnce('this.initializeFromPort(self);', '/* Quickque owns the outer worker message protocol. */');
  replaceOnce(
    'this._rawMinBufferLength = maybeMinBufferLength || 0;',
    `this._rawMinBufferLength = maybeMinBufferLength || 0;
    globalThis.__quickquePdfBudget.check(this._rawMinBufferLength);`,
  );
  replaceOnce(
    'ensureBuffer(requested) {\n    const buffer = this.buffer;',
    `ensureBuffer(requested) {
    globalThis.__quickquePdfBudget.check(requested);
    const buffer = this.buffer;`,
  );
  replaceOnce(
    'const buffer2 = new Uint8Array(size);\n    buffer2.set(buffer);',
    `globalThis.__quickquePdfBudget.reserve(size - buffer.byteLength);
    const buffer2 = new Uint8Array(size);
    buffer2.set(buffer);`,
  );
  // Reject unreasonable predictor dimensions before bitwise arithmetic wraps.
  replaceOnce(
    'this.pixBytes = colors * bits + 7 >> 3;',
    `globalThis.__quickquePdfBudget.check(columns * colors * bits + 7);
    this.pixBytes = colors * bits + 7 >> 3;`,
  );
  replaceOnce(
    'class StreamsSequenceStream extends DecodeStream {',
    `class QuickqueRasterStream extends DecodeStream {
  constructor(stream) { super(0); this.dict = stream.dict; }
  readBlock() {
    globalThis.__quickquePdfBudget.fail("Raster decoding is not supported by the text-only reader.");
  }
}
class StreamsSequenceStream extends DecodeStream {`,
  );
  for (const name of ['JpegStream', 'JpxStream', 'Jbig2Stream', 'CCITTFaxStream']) {
    replaceOnce(`return new ${name}(stream, maybeLength, params);`, 'return new QuickqueRasterStream(stream);');
  }
  // Text extraction must never decode raster images, including a malicious
  // image codec used as a content-stream filter. Normal PDF images are skipped
  // by getTextContent without invoking these methods.
  for (const className of ['JpegStream', 'JpxStream', 'Jbig2Stream']) {
    const start = source.indexOf(`class ${className} extends DecodeStream`);
    const end = source.indexOf('\nclass ', start + 1);
    if (start < 0 || end < 0) throw new Error(`Missing PDF.js ${className} guard`);
    const body = source.slice(start, end);
    const guarded = body.replace(/(\n  decodeImage\([^)]*\) \{)/, `$1
    globalThis.__quickquePdfBudget.fail("Raster decoding is not supported by the text-only reader.");`);
    if (guarded === body) throw new Error(`Missing PDF.js ${className} decoder`);
    source = source.slice(0, start) + guarded + source.slice(end);
  }
  return `globalThis.__quickquePdfGuardInstalled = true;\n${source}`;
}

export function pdfBudgetPlugin() {
  return {
    name: 'quickque-pdf-resource-budget',
    enforce: 'pre',
    resolveId(id) {
      if (id === PDF_RESOURCES_ID) return '\0' + id;
    },
    load(id) {
      if (id === '\0' + PDF_RESOURCES_ID) return pdfResourcesModule();
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'document-import-licenses.txt',
        source: readFileSync(new URL('../src/lib/document-import/THIRD_PARTY_NOTICES.txt', import.meta.url), 'utf8')
          + '\n\nPDF.js CMap license:\n'
          + readFileSync(path.join(pdfRoot, 'cmaps/LICENSE'), 'utf8')
          + '\n\nPDF.js standard font license:\n'
          + readFileSync(path.join(pdfRoot, 'standard_fonts/LICENSE_FOXIT'), 'utf8')
          + '\n\nLiberation font license:\n'
          + readFileSync(path.join(pdfRoot, 'standard_fonts/LICENSE_LIBERATION'), 'utf8'),
      });
    },
    transform(source, id) {
      if (id.replaceAll('\\', '/').split('?')[0].endsWith('/pdfjs-dist/legacy/build/pdf.worker.mjs')) {
        return { code: guardPdfWorker(source), map: null };
      }
    },
  };
}
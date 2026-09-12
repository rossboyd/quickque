import { IMPORT_LIMITS, PDF_PAGE_LIMIT } from './types.ts';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { cmaps, fonts } from 'virtual:quickque-pdf-resources';

interface PdfBudget {
  used: number;
  error: string | null;
  check(size: number): void;
  reserve(size: number): void;
  fail(message: string): never;
}

const local = globalThis as typeof globalThis & {
  __quickquePdfGuardInstalled?: boolean;
  __quickquePdfBudget: PdfBudget;
  pdfjsWorker?: { WorkerMessageHandler: typeof WorkerMessageHandler };
};

function createBudget(): PdfBudget {
  return {
    used: 0,
    error: null,
    fail(message) {
      this.error = message;
      throw new Error(message);
    },
    check(size) {
      if (!Number.isSafeInteger(size) || size < 0 || size > IMPORT_LIMITS.expandedBytes) {
        this.fail('This PDF exceeds the 32 MB expanded-content safety limit. Export a smaller PDF or TXT file.');
      }
    },
    reserve(size) {
      this.check(size);
      this.check(this.used + size);
      this.used += size;
    },
  };
}

// Fixed, bundled resource names only: no fetch, CDN, document-provided URLs,
// or WKWebView asset-protocol requests. The plugin embeds PDF.js's resources.
function resourceBytes(resources: Record<string, string>, name: string) {
  if (!Object.hasOwn(resources, name)) {
    local.__quickquePdfBudget.fail('This PDF requires font mapping data unavailable locally. Export with embedded fonts or as TXT.');
  }
  return Uint8Array.from(atob(resources[name]), char => char.charCodeAt(0));
}
class LocalCMaps {
  async fetch({ name }: { name: string }) {
    return { cMapData: resourceBytes(cmaps, `${name}.bcmap`), compressionType: 1 };
  }
}
class LocalFonts {
  async fetch({ filename }: { filename: string }) {
    return resourceBytes(fonts, filename);
  }
}

export async function extractPdf(buffer: ArrayBuffer, fileName: string) {
  if (new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 5))) !== '%PDF-') {
    throw new Error('This is not a valid PDF. Open it in a PDF app and export a text-based PDF or TXT file.');
  }
  if (!local.__quickquePdfGuardInstalled) {
    throw new Error('The local PDF safety checks are unavailable. Restart Quickque or import a TXT file instead.');
  }
  local.__quickquePdfBudget = createBudget();
  // Run PDF.js inside our disposable worker, not an untracked nested worker.
  local.pdfjsWorker = { WorkerMessageHandler };
  const budget = local.__quickquePdfBudget;
  const checkBudget = () => { if (budget.error) throw new Error(budget.error); };
  const loading = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    enableXfa: false,
    useSystemFonts: false,
    disableFontFace: true,
    maxImageSize: 0,
    stopAtErrors: true,
    CMapReaderFactory: LocalCMaps,
    StandardFontDataFactory: LocalFonts,
    password: '',
  });
  try {
    const document = await loading.promise;
    checkBudget();
    if (document.numPages > PDF_PAGE_LIMIT) {
      throw new Error('This PDF has more than 500 pages. Split it into smaller documents and try again.');
    }
    if (await document.getPermissions() !== null) {
      throw new Error('This PDF is encrypted. Export an unlocked copy and choose it again.');
    }
    const pages: string[] = [];
    let length = 0;
    let blankPages = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const reader = page.streamTextContent({ includeMarkedContent: false }).getReader();
      let text = '';
      let previousY: number | undefined;
      let previousHeight = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          checkBudget();
          if (chunk.done) break;
          for (const item of chunk.value.items) {
            if (!('str' in item)) continue;
            // Source order is preserved. A large vertical gap is usually a
            // paragraph break; multi-column layouts still require review.
            const y = item.transform[5];
            let separator = '';
            if (text && item.str && previousY !== undefined &&
                Math.abs(y - previousY) > Math.max(previousHeight * 1.5, 3)) {
              separator = text.endsWith('\n') ? '\n' : '\n\n';
            }
            const value = separator + item.str + (item.hasEOL ? '\n' : '');
            length += value.length;
            if (length > IMPORT_LIMITS.outputChars) {
              throw new Error('The extracted text exceeds 500,000 characters. Split the document and try again.');
            }
            text += value;
            if (item.str) {
              previousY = y;
              previousHeight = Math.abs(item.height);
            }
          }
        }
      } finally {
        // loading.destroy() owns teardown. Cancelling an already-failed PDF.js
        // stream races its error reply (notably on resource-limit failures).
        reader.releaseLock();
        page.cleanup();
      }
      if (text.trim()) {
        if (pages.length) length += 2;
        if (length > IMPORT_LIMITS.outputChars) throw new Error('The extracted text exceeds 500,000 characters. Split the document and try again.');
        pages.push(text);
      } else blankPages++;
    }
    checkBudget();
    const text = pages.join('\n\n');
    if (!text.trim()) {
      throw new Error('This PDF has no extractable text. It may be scanned or image-only; copy the text or use OCR elsewhere, then import TXT.');
    }
    return {
      title: fileName.replace(/\.[^.]*$/, '').trim() || 'Imported document',
      text,
      warnings: [
        'PDF reading order, columns and paragraph breaks may differ from the original. Check all text before saving. Images and styling are not retained.',
        ...(blankPages ? [`${blankPages} page(s) had no readable text and were skipped. Scanned content requires OCR elsewhere.`] : []),
      ],
    };
  } catch (error) {
    checkBudget();
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypted/i.test(message)) {
      throw new Error('This PDF is encrypted or password-protected. Export an unlocked copy and choose it again.');
    }
    if (/font|CMap|mapping/i.test(message)) {
      throw new Error('This PDF needs font mapping data unavailable locally. Export it with embedded fonts or copy its text into TXT.');
    }
    if (/32 MB|500|OCR|Split|Raster/i.test(message)) throw error;
    throw new Error('This PDF is corrupt or uses unsupported features. Open it in a PDF app and export a fresh text-based PDF or TXT file.');
  } finally {
    await loading.destroy().catch(() => {});
  }
}
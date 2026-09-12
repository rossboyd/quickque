import { IMPORT_LIMITS, validateFile, type ExtractedDocument } from './types.ts';

/** A disposable worker per document: cancellation also stops synchronous parsers. */
export function runExtraction(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
  signal: AbortSignal | undefined,
  createWorker: () => Worker,
  timeoutMs: number = IMPORT_LIMITS.timeoutMs,
): Promise<ExtractedDocument> {
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result?: ExtractedDocument, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, new DOMException('Document import cancelled.', 'AbortError'));
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      validateFile(file.name, file.size);
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(undefined, new Error(
        'This document took too long to read. Try a smaller document or export it as plain text (.txt).',
      )), timeoutMs);
      worker = createWorker();
      worker.onerror = (event) => {
        event.preventDefault();
        finish(undefined, new Error('The local document reader could not start or stopped unexpectedly. Try again, or export the document as plain text (.txt).'));
      };
      worker.onmessageerror = () => finish(undefined, new Error('The document reader returned unreadable data. Try exporting the document as plain text (.txt).'));
      worker.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message?.ok === true && typeof message.result?.text === 'string' &&
            message.result.text.trim() && message.result.text.length <= IMPORT_LIMITS.outputChars) {
          finish(message.result);
        } else {
          finish(undefined, new Error(typeof message?.error === 'string'
            ? message.error : 'No readable text was extracted. Try exporting the document as plain text (.txt).'));
        }
      };
      file.arrayBuffer().then(buffer => {
        if (settled) return;
        if (buffer.byteLength !== file.size || buffer.byteLength > IMPORT_LIMITS.fileBytes) {
          finish(undefined, new Error('The file changed while reading. Choose the file again (maximum 10 MB).'));
          return;
        }
        try {
          worker!.postMessage({ name: file.name, buffer }, [buffer]);
        } catch {
          finish(undefined, new Error('Could not send this file to the local reader. Try again or use a TXT file.'));
        }
      }, () => finish(undefined, new Error('This file could not be read. Check file access permissions and choose it again.')));
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error('This document could not be opened.'));
    }
  });
}
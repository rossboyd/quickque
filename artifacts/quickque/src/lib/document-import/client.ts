import { runExtraction } from './worker-task';

export function extractDocumentFile(file: File, signal?: AbortSignal) {
  return runExtraction(file, signal, () => new Worker(
    new URL('./worker.ts', import.meta.url),
    { type: 'module', name: 'quickque-document-import' },
  ));
}
export const IMPORT_LIMITS = Object.freeze({
  /** Maximum bytes read from a user-selected file. */
  fileBytes: 10 * 1024 * 1024,
  /** Maximum bytes produced while expanding an archive or compressed stream. */
  expandedBytes: 32 * 1024 * 1024,
  /** Maximum UTF-16 code units returned to the editor. */
  outputChars: 500_000,
  /** The parent worker client uses this value when terminating a stuck worker. */
  timeoutMs: 20_000,
} as const);

/** PDF page count is kept separate so the public limits object remains stable. */
export const PDF_PAGE_LIMIT = 500;

export type DocumentFormat = 'txt' | 'md' | 'docx' | 'rtf' | 'pdf';

export interface ExtractedDocument {
  title: string;
  text: string;
  format: DocumentFormat;
  warnings: string[];
}

/**
 * Validate a file before any bytes are copied to the extraction worker.
 *
 * MIME types are deliberately not accepted here: browser-provided MIME values
 * are optional and are frequently wrong for files dragged from Finder. The
 * extension is only used to select a parser; each parser still validates its
 * own signature.
 */
export function validateFile(name: string, size: number): DocumentFormat {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Choose a document with a filename.');
  }
  if (!Number.isFinite(size) || !Number.isInteger(size) || size < 0) {
    throw new Error('The document size could not be read.');
  }
  if (size > IMPORT_LIMITS.fileBytes) {
    throw new Error('This document is too large. Choose a file no larger than 10 MB.');
  }

  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  const extension = match?.[1].toLowerCase();
  switch (extension) {
    case 'txt':
      return 'txt';
    case 'md':
    case 'markdown':
      return 'md';
    case 'docx':
      return 'docx';
    case 'rtf':
      return 'rtf';
    case 'pdf':
      return 'pdf';
    default:
      throw new Error('Unsupported document type. Choose a TXT, Markdown, DOCX, RTF, or text-based PDF file.');
  }
}
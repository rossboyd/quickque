import { extractDocx } from './docx.ts';
import { extractPdf } from './pdf.ts';
import { extractRtf } from './rtf.ts';
import { decodePlainText } from './txt.ts';
import { IMPORT_LIMITS, validateFile, type DocumentFormat, type ExtractedDocument } from './types.ts';

function titleFromFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.[^.]*$/, '').trim() || 'Imported document';
}

function checkResult(
  value: { title?: string; text: string; warnings: string[] },
  format: DocumentFormat,
  fallbackTitle: string,
): ExtractedDocument {
  if (typeof value.text !== 'string' || !value.text.trim()) {
    throw new Error('No readable text was found in this document.');
  }
  if (value.text.length > IMPORT_LIMITS.outputChars) {
    throw new Error('The extracted text is too long. Choose a document with no more than 500,000 characters.');
  }
  const title = typeof value.title === 'string' && value.title.trim()
    ? value.title.trim()
    : fallbackTitle;
  if (title.length > IMPORT_LIMITS.outputChars) {
    throw new Error('The document title is too long.');
  }
  return {
    title,
    text: value.text,
    format,
    warnings: [...value.warnings],
  };
}

export async function extractDocument(name: string, buffer: ArrayBuffer): Promise<ExtractedDocument> {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('The local document reader received invalid file data.');
  }
  const format = validateFile(name, buffer.byteLength);
  const fallbackTitle = titleFromFilename(name);
  switch (format) {
    case 'txt':
      return checkResult(
        { ...decodePlainText(new Uint8Array(buffer)), title: fallbackTitle },
        format,
        fallbackTitle,
      );
    case 'rtf':
      return checkResult(
        { ...extractRtf(new Uint8Array(buffer)), title: fallbackTitle },
        format,
        fallbackTitle,
      );
    case 'docx':
      return checkResult(extractDocx(buffer, fallbackTitle), format, fallbackTitle);
    case 'pdf':
      return checkResult(await extractPdf(buffer, name), format, fallbackTitle);
    default: {
      const impossible: never = format;
      throw new Error(`Unsupported document format: ${impossible}`);
    }
  }
}
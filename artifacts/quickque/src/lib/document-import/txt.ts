import { IMPORT_LIMITS } from './types.ts';

export interface TextRead {
  text: string;
  warnings: string[];
}

function decoder(label: string, fatal = false): TextDecoder {
  return new TextDecoder(label, { fatal });
}

/**
 * Decode text without ever interpreting it as markup. TextDecoder is used
 * instead of a DOM API so a TXT file containing HTML or scripts remains text.
 */
export function decodePlainText(bytes: Uint8Array): TextRead {
  let encoding = 'utf-8';
  let body = bytes;
  const warnings: string[] = [];

  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    body = bytes.subarray(3);
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    body = bytes.subarray(2);
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
    body = bytes.subarray(2);
  }

  let text: string;
  try {
    text = decoder(encoding, true).decode(body);
  } catch {
    throw new Error('This TXT file has invalid text encoding. Save it as UTF-8 or UTF-16 with a byte-order mark and try again.');
  }

  if (text.includes('\u0000')) {
    throw new Error('This TXT file contains binary data and cannot be imported as text.');
  }

  text = text.replace(/\r\n?/g, '\n');
  if (text.length > IMPORT_LIMITS.outputChars) {
    throw new Error('The extracted text is too long. Choose a document with no more than 500,000 characters.');
  }
  if (!text.trim()) {
    throw new Error('This document is empty. Choose a file that contains text.');
  }

  return { text, warnings };
}
import { IMPORT_LIMITS } from './types.ts';

const SKIPPED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'filetbl',
  'listtable',
  'listoverridetable',
  'themedata',
  'datastore',
  'generator',
  'xmlnstbl',
  'htmltag',
  'htmlrtf',
  'mhtmltag',
  'htmlbase',
  'fldinst',
]);
const MAX_RTF_NESTING = 128;

const RTF_CODEPAGES: Record<number, string> = {
  874: 'windows-874',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
};
const WINDOWS_1252_EXTENDED = [
  '\u20ac', '\u0081', '\u201a', '\u0192', '\u201e', '\u2026', '\u2020', '\u2021',
  '\u02c6', '\u2030', '\u0160', '\u2039', '\u0152', '\u008d', '\u017d', '\u008f',
  '\u0090', '\u2018', '\u2019', '\u201c', '\u201d', '\u2022', '\u2013', '\u2014',
  '\u02dc', '\u2122', '\u0161', '\u203a', '\u0153', '\u009d', '\u017e', '\u0178',
];

interface GroupState {
  skip: boolean;
  uc: number;
  destinationPending: boolean;
}

function appendLimited(parts: string[], value: string, length: { value: number }): void {
  if (!value) return;
  length.value += value.length;
  if (length.value > IMPORT_LIMITS.outputChars) {
    throw new Error('The extracted text is too long. Choose a document with no more than 500,000 characters.');
  }
  parts.push(value);
}

function unicodeFromRtfNumber(number: number): string {
  // RTF stores signed 16-bit values. Negative values wrap around to Unicode
  // code points above U+FFFF when represented by a JavaScript string.
  const codePoint = number < 0 ? number + 0x10000 : number;
  if (codePoint < 0 || codePoint > 0x10ffff) return '\ufffd';
  return String.fromCodePoint(codePoint);
}

/**
 * Read the conservative, text-only subset of RTF. Groups used for fonts,
 * pictures, objects and HTML metadata are skipped; no RTF payload is ever
 * inserted into a DOM or evaluated.
 */
export function extractRtf(bytes: Uint8Array): { text: string; warnings: string[] } {
  const probe = new TextDecoder('latin1', { fatal: false }).decode(bytes);
  const codePageNumber = Number(/\\ansicpg(\d+)/i.exec(probe)?.[1] ?? 1252);
  const encoding = RTF_CODEPAGES[codePageNumber];
  if (!encoding) {
    throw new Error(`This RTF uses code page ${codePageNumber}, which is not supported safely.`);
  }
  if (/\\(?:mac|pc|pca)(?:\s|[-\d]|$)/i.test(probe)) {
    throw new Error('This RTF uses a legacy character set that is not supported safely.');
  }
  let source: string;
  try {
    if (codePageNumber === 1252) {
      // Some runtimes (including Node builds used by the parser tests) expose
      // the ISO-8859-1 aliases for windows-1252. Decode this single-byte
      // codepage explicitly so \'93/\'94 and the euro sign cannot become C1
      // control characters.
      source = Array.from(bytes, (byte) => (
        byte >= 0x80 && byte <= 0x9f
          ? WINDOWS_1252_EXTENDED[byte - 0x80]
          : String.fromCharCode(byte)
      )).join('');
    } else {
      source = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    }
  } catch {
    throw new Error(`This RTF code page (${codePageNumber}) contains invalid text bytes.`);
  }
  if (!/^\s*\{\s*\\rtf\d/i.test(source)) {
    throw new Error('This is not a valid RTF document.');
  }

  const parts: string[] = [];
  const length = { value: 0 };
  const stack: GroupState[] = [];
  let state: GroupState = { skip: false, uc: 1, destinationPending: false };
  let depth = 0;
  let fallbackToSkip = 0;
  let sawClosingGroup = false;
  let i = 0;
  const hexDecoder = new TextDecoder(encoding, { fatal: false });
  const decodeHexByte = (byte: number): string => codePageNumber === 1252 && byte >= 0x80 && byte <= 0x9f
    ? WINDOWS_1252_EXTENDED[byte - 0x80]
    : hexDecoder.decode(Uint8Array.of(byte));

  const emit = (value: string) => {
    if (!state.skip) appendLimited(parts, value, length);
  };

  while (i < source.length) {
    const character = source[i];

    if (character === '{') {
      stack.push({ ...state });
      state = { ...state, destinationPending: false };
      depth += 1;
      if (depth > MAX_RTF_NESTING) {
        throw new Error('This RTF document is nested too deeply.');
      }
      i += 1;
      continue;
    }
    if (character === '}') {
      if (!depth || !stack.length) {
        throw new Error('This RTF document has an unmatched closing group.');
      }
      state = stack.pop()!;
      depth -= 1;
      sawClosingGroup = true;
      i += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      // Physical line wrapping in an RTF source is not a paragraph break.
      i += 1;
      continue;
    }
    if (character !== '\\') {
      if (!state.skip) {
        if (fallbackToSkip > 0) {
          fallbackToSkip -= 1;
        } else {
          emit(character);
        }
      }
      i += 1;
      continue;
    }

    i += 1;
    if (i >= source.length) {
      throw new Error('This RTF document ends in an incomplete control sequence.');
    }
    const controlStart = source[i];

    if (controlStart === '\'') {
      if (i + 2 >= source.length || !/^[0-9a-f]{2}$/i.test(source.slice(i + 1, i + 3))) {
        throw new Error('This RTF document contains an invalid hexadecimal escape.');
      }
      const value = decodeHexByte(Number.parseInt(source.slice(i + 1, i + 3), 16));
      if (state.skip || fallbackToSkip > 0) {
        if (fallbackToSkip > 0) fallbackToSkip -= 1;
      } else {
        emit(value);
      }
      i += 3;
      continue;
    }

    if (!/[a-z]/i.test(controlStart)) {
      // Escaped braces and backslashes are literal text. The remaining
      // one-character controls are formatting hints that have no plain-text
      // representation.
      i += 1;
      if (state.skip || fallbackToSkip > 0) {
        if (fallbackToSkip > 0) fallbackToSkip -= 1;
      } else if (controlStart === '*') {
        state.destinationPending = true;
      } else if (controlStart === '\\' || controlStart === '{' || controlStart === '}') {
        emit(controlStart);
      } else if (controlStart === '~') {
        emit(' ');
      } else if (controlStart === '_') {
        emit('\u2011');
      } else if (controlStart === '-') {
        emit('\u00ad');
      }
      continue;
    }

    const wordStart = i;
    while (i < source.length && /[a-z]/i.test(source[i])) i += 1;
    const word = source.slice(wordStart, i).toLowerCase();
    let parameter: number | undefined;
    const parameterStart = i;
    if (source[i] === '-' || /[0-9]/.test(source[i] ?? '')) {
      i += 1;
      while (i < source.length && /[0-9]/.test(source[i])) i += 1;
      parameter = Number.parseInt(source.slice(parameterStart, i), 10);
    }
    if (source[i] === ' ') i += 1;

    if (state.destinationPending) {
      state.destinationPending = false;
      state.skip = true;
    }
    if (word === '*' && parameter === undefined) {
      state.destinationPending = true;
      continue;
    }
    if (SKIPPED_DESTINATIONS.has(word)) {
      state.skip = true;
      continue;
    }

    if (word === 'uc' && parameter !== undefined) {
      state.uc = Math.max(0, Math.min(16, parameter));
      continue;
    }
    if (word === 'u' && parameter !== undefined) {
      if (!state.skip) emit(unicodeFromRtfNumber(parameter));
      fallbackToSkip = state.skip ? 0 : state.uc;
      continue;
    }
    if (word === 'bin' && parameter !== undefined) {
      // Binary picture/object payloads are not text. Skipping them also keeps
      // malformed binary data from being interpreted as RTF controls.
      const binaryEnd = i + Math.max(0, parameter);
      if (binaryEnd > source.length) {
        throw new Error('This RTF binary payload is incomplete.');
      }
      i = binaryEnd;
      continue;
    }
    if (word === 'par') {
      if (!state.skip) {
        fallbackToSkip = 0;
        emit('\n\n');
      }
      continue;
    }
    if (word === 'line') {
      if (!state.skip) {
        fallbackToSkip = 0;
        emit('\n');
      }
      continue;
    }
    if (word === 'tab' || word === 'cell') {
      if (!state.skip) {
        fallbackToSkip = 0;
        emit('\t');
      }
      continue;
    }
    if (word === 'row') {
      if (!state.skip) {
        fallbackToSkip = 0;
        emit('\n');
      }
    }
  }

  if (depth !== 0 || stack.length !== 0 || !sawClosingGroup) {
    throw new Error('This RTF document is malformed (an RTF group is incomplete).');
  }

  const text = parts.join('').replace(/\r\n?/g, '\n');
  if (!text.trim()) {
    throw new Error('This RTF document contains no readable text.');
  }
  return {
    text,
    warnings: ['Rich formatting, images, objects, and embedded markup were not retained.'],
  };
}
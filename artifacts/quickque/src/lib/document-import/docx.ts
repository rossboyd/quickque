import { Unzip, UnzipInflate } from 'fflate';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { IMPORT_LIMITS } from './types.ts';

const MAX_ZIP_ENTRIES = 4096;
const MAX_XML_NESTING = 128;
const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DC_NS = 'http://purl.org/dc/elements/1.1/';

interface ExpandedEntry {
  name: string;
  chunks: Uint8Array[];
  bytes: number;
}

function readXmlEntry(entry: ExpandedEntry): string {
  const bytes = new Uint8Array(entry.bytes);
  let offset = 0;
  for (const chunk of entry.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`The DOCX XML entry "${entry.name}" is not valid UTF-8.`);
  }
}

function rejectEncryptedZip(bytes: Uint8Array): void {
  const localSignature = 0x04034b50;
  const centralSignature = 0x02014b50;
  const aesExtra = 0x9901;
  const read16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
  for (let offset = 0; offset + 4 <= bytes.length; offset += 1) {
    const signature = (
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    ) >>> 0;
    const isLocal = signature === localSignature;
    const isCentral = signature === centralSignature;
    if (!isLocal && !isCentral) continue;
    const flags = read16(offset + (isLocal ? 6 : 8));
    if ((flags & 0x0001) !== 0) {
      throw new Error('Encrypted DOCX archives are not supported. Unlock the file and choose it again.');
    }
    const nameLength = read16(offset + (isLocal ? 26 : 28));
    const extraLength = read16(offset + (isLocal ? 28 : 30));
    const extraStart = offset + (isLocal ? 30 : 46) + nameLength;
    const extraEnd = extraStart + extraLength;
    for (let extra = extraStart; extra + 4 <= extraEnd && extra + 4 <= bytes.length;) {
      const extraId = read16(extra);
      const length = read16(extra + 2);
      if (extraId === aesExtra) {
        throw new Error('Encrypted DOCX archives are not supported. Unlock the file and choose it again.');
      }
      extra += 4 + length;
    }
  }
}

/**
 * fflate's streaming unzipper is intentional here. Calling unzipSync would
 * allocate every expanded member before the caller could enforce a limit,
 * which makes ZIP metadata-only checks ineffective against ZIP bombs.
 */
function expandDocx(buffer: ArrayBuffer): Map<string, ExpandedEntry> {
  const entries = new Map<string, ExpandedEntry>();
  const archiveBytes = new Uint8Array(buffer);
  rejectEncryptedZip(archiveBytes);
  let expandedBytes = 0;
  let entryCount = 0;
  let parserError: unknown;
  const unzip = new Unzip();
  // Browser builds require the deflate handler to be registered explicitly;
  // doing so also keeps the streaming path independent of Node's zlib.
  unzip.register(UnzipInflate);

  unzip.onfile = (file) => {
    entryCount += 1;
    if (entryCount > MAX_ZIP_ENTRIES) {
      throw new Error('This DOCX archive contains too many entries.');
    }

    const entry: ExpandedEntry = {
      name: file.name,
      chunks: [],
      bytes: 0,
    };
    // Keep only XML members needed for text extraction. Every member is still
    // streamed and counted, so an unrelated ZIP bomb cannot evade the bound.
    const selected = file.name === 'word/document.xml' || file.name === 'docProps/core.xml';
    file.ondata = (error, chunk) => {
      if (error) {
        parserError ??= error;
        return;
      }
      const size = chunk?.byteLength ?? 0;
      expandedBytes += size;
      if (expandedBytes > IMPORT_LIMITS.expandedBytes) {
        throw new Error('This DOCX expands beyond the 32 MB safety limit.');
      }
      if (selected && chunk && chunk.byteLength) {
        entry.bytes += chunk.byteLength;
        entry.chunks.push(chunk);
      }
    };
    file.start();
    if (selected) entries.set(file.name, entry);
  };

  try {
    // Feed small chunks so fflate never receives an entire compressed ZIP
    // member in one call. This keeps its pending compressed-input buffer
    // bounded while output is counted by ondata.
    for (let offset = 0; offset < archiveBytes.byteLength; offset += 1024) {
      if (parserError) break;
      const end = Math.min(archiveBytes.byteLength, offset + 1024);
      unzip.push(archiveBytes.subarray(offset, end), end === archiveBytes.byteLength);
    }
  } catch (error) {
    if (error instanceof Error && /safety limit|too many entries/.test(error.message)) {
      throw error;
    }
    throw new Error('This DOCX archive is corrupt or uses an unsupported compression method.');
  }
  if (parserError) {
    if (parserError instanceof Error && /safety limit|too many entries/.test(parserError.message)) {
      throw parserError;
    }
    throw new Error('This DOCX archive contains a damaged entry.');
  }
  return entries;
}

function parseXml(
  xml: string,
  onOpen: (tag: SaxesTagNS) => void,
  onText: (text: string) => void,
  onClose: (tag: SaxesTagNS) => void,
): void {
  if (xml.includes('\u0000')) {
    throw new Error('This DOCX XML contains invalid binary data.');
  }
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  let parserError: Error | undefined;
  parser.on('doctype', () => {
    parserError ??= new Error('DOCX XML DTDs are not supported.');
  });
  parser.on('error', (error) => {
    parserError ??= error;
  });
  parser.on('opentag', (tag) => onOpen(tag as SaxesTagNS));
  parser.on('text', onText);
  parser.on('cdata', onText);
  parser.on('closetag', (tag) => onClose(tag as SaxesTagNS));
  try {
    parser.write(xml).close();
  } catch (error) {
    parserError ??= error instanceof Error ? error : new Error('Malformed DOCX XML.');
  }
  if (parserError) throw new Error(`This DOCX XML is malformed: ${parserError.message}`);
}

function extractDocumentXml(xml: string): string {
  const paragraphs: string[] = [];
  let depth = 0;
  let rootSeen = false;
  let paragraph: string[] | undefined;
  let textDepth = 0;
  let skipDepth = 0;
  let paragraphCount = 0;
  parseXml(
    xml,
    (tag) => {
      depth += 1;
      if (depth > MAX_XML_NESTING) throw new Error('DOCX XML nesting exceeds the safety limit.');
      const local = tag.local;
      if (!rootSeen) {
        rootSeen = true;
        if (local !== 'document' || tag.uri !== WORD_NS) {
          throw new Error('DOCX XML has an unexpected root element.');
        }
      }
      if (tag.uri !== WORD_NS) return;
      if (local === 'del' || local === 'moveFrom' || local === 'fldinst' || local === 'instrText' || local === 'delText') {
        skipDepth += 1;
        return;
      }
      if (skipDepth > 0) return;
      if (local === 'p') {
        if (paragraph) throw new Error('DOCX XML contains nested paragraphs.');
        paragraph = [];
        paragraphCount += 1;
      } else if (local === 't' || local === 'fldrslt') {
        if (!paragraph) throw new Error('DOCX text appears outside a paragraph.');
        textDepth = depth;
      } else if (local === 'tab' && paragraph) {
        paragraph.push('\t');
      } else if ((local === 'br' || local === 'cr') && paragraph) {
        paragraph.push('\n');
      }
    },
    (text) => {
      if (skipDepth === 0 && textDepth > 0 && paragraph) paragraph.push(text);
    },
    (tag) => {
      const local = tag.local;
      if (tag.uri === WORD_NS && (local === 'del' || local === 'moveFrom' || local === 'fldinst' || local === 'instrText' || local === 'delText')) {
        skipDepth = Math.max(0, skipDepth - 1);
      } else if (tag.uri === WORD_NS && (local === 't' || local === 'fldrslt')) {
        textDepth = 0;
      } else if (tag.uri === WORD_NS && local === 'p') {
        if (!paragraph) throw new Error('DOCX XML contains an unmatched paragraph close.');
        paragraphs.push(paragraph.join(''));
        paragraph = undefined;
      }
      depth -= 1;
    },
  );
  if (!rootSeen || paragraphCount === 0) {
    throw new Error('This DOCX document contains no readable paragraphs.');
  }
  const text = paragraphs.join('\n\n').replace(/\r\n?/g, '\n');
  if (text.length > IMPORT_LIMITS.outputChars) {
    throw new Error('The extracted text is too long. Choose a document with no more than 500,000 characters.');
  }
  if (!text.trim()) {
    throw new Error('This DOCX document contains no readable text.');
  }
  return text;
}

function extractTitle(coreXml: string | undefined): string | undefined {
  if (!coreXml) return undefined;
  let title = '';
  let titleDepth = 0;
  parseXml(
    coreXml,
    (tag) => {
      if (tag.local === 'title' && tag.uri === DC_NS) titleDepth = 1;
    },
    (text) => {
      if (titleDepth) title += text;
    },
    (tag) => {
      if (tag.local === 'title' && tag.uri === DC_NS) titleDepth = 0;
    },
  );
  return title.trim() || undefined;
}

export function extractDocx(
  buffer: ArrayBuffer,
  fallbackTitle: string,
): { title: string; text: string; warnings: string[] } {
  const entries = expandDocx(buffer);
  const documentEntry = entries.get('word/document.xml');
  if (!documentEntry) {
    throw new Error('This DOCX archive has no main document. It may be corrupt or not a DOCX file.');
  }
  const coreEntry = entries.get('docProps/core.xml');
  const documentXml = readXmlEntry(documentEntry);
  const coreXml = coreEntry ? readXmlEntry(coreEntry) : undefined;
  return {
    title: extractTitle(coreXml) ?? fallbackTitle,
    text: extractDocumentXml(documentXml),
    warnings: ['Rich formatting, images, comments, and tracked formatting were not retained.'],
  };
}
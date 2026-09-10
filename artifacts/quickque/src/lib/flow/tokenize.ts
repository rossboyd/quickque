export interface NormalizedToken {
  /** Normalized value used by the matcher. */
  value: string;
  /** UTF-16 offsets into the unmodified source string. */
  start: number;
  end: number;
  source: string;
  index: number;
}

const WORD = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

export function normalizeWord(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/’/g, "'")
    .toLocaleLowerCase("en-US");
}

/**
 * Produces matching tokens without altering the source. Offsets are UTF-16
 * offsets, matching String.slice and DOM text APIs.
 */
export function tokenize(source: string): NormalizedToken[] {
  const result: NormalizedToken[] = [];
  for (const match of source.matchAll(WORD)) {
    const start = match.index;
    const original = match[0];
    const value = normalizeWord(original);
    if (value) {
      result.push({
        value,
        start,
        end: start + original.length,
        source: original,
        index: result.length,
      });
    }
  }
  return result;
}
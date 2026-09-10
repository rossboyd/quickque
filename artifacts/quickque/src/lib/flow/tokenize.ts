export interface NormalizedToken {
  /** Normalized value used by the matcher. */
  value: string;
  /** UTF-16 offsets into the unmodified source string. */
  start: number;
  end: number;
  source: string;
  index: number;
}

const WORD = /\d+(?:,\d{3})*(?:\.\d+)?|[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

const CONTRACTIONS: Record<string, string> = {
  "i'm": "i am", "you're": "you are", "we're": "we are", "they're": "they are",
  "it's": "it is", "that's": "that is", "there's": "there is",
  "i've": "i have", "we've": "we have", "you've": "you have", "they've": "they have",
  "i'll": "i will", "we'll": "we will", "you'll": "you will", "they'll": "they will",
  "can't": "can not", cannot: "can not", "won't": "will not", "shan't": "shall not",
};
const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven",
  "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function integerWords(n: number): string[] {
  if (n < 20) return [SMALL[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? integerWords(n % 10) : [])];
  if (n < 1000) return [SMALL[Math.floor(n / 100)], "hundred", ...(n % 100 ? integerWords(n % 100) : [])];
  return [...integerWords(Math.floor(n / 1000)), "thousand", ...(n % 1000 ? integerWords(n % 1000) : [])];
}

function matchingWords(word: string): string[] {
  if (CONTRACTIONS[word]) return CONTRACTIONS[word].split(" ");
  if (word.endsWith("n't")) return [word.slice(0, -3), "not"];
  if (/^\d[\d,]*(?:\.\d+)?$/.test(word)) {
    const [whole, decimal] = word.replaceAll(",", "").split(".");
    const number = Number(whole);
    if (number <= 999_999 && (whole.length === 1 || !whole.startsWith("0"))) {
      return [...integerWords(number), ...(decimal ? ["point", ...[...decimal].map(d => SMALL[Number(d)])] : [])];
    }
  }
  return [word];
}

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
    const values = matchingWords(normalizeWord(original));
    for (const value of values.filter(Boolean)) {
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
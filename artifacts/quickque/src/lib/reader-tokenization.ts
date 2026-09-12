import type { ScriptSection } from './types.ts';
import { tokenize, type NormalizedToken } from './flow/tokenize.ts';

export type ReaderSpan = {
  type: 'text' | 'token';
  text: string;
  startTokenIdx?: number;
  endTokenIdx?: number;
};

export type ReaderEnrichedSection = ScriptSection & {
  spans: ReaderSpan[];
  firstTokenIdx: number | null;
};

export type ReaderTokenization = {
  tokens: NormalizedToken[];
  enrichedSections: ReaderEnrichedSection[];
};

/**
 * A structural signature deliberately ignores script presentation. The
 * persistence layer defensively clones sections when any script field changes,
 * so object identity is not sufficient to decide whether Flow input changed.
 */
export function getReaderSectionsSignature(sections: ScriptSection[]): string {
  return JSON.stringify(sections.map(({ id, title, content }) => [id, title, content]));
}

export function tokenizeReaderSections(sections: ScriptSection[]): ReaderTokenization {
  let globalIdx = 0;
  const tokens: NormalizedToken[] = [];
  const enrichedSections = sections.map((section, sectionIdx) => {
    const enriched = tokenize(section.content).map(token => ({
      ...token,
      sectionIdx,
      globalTokenIdx: globalIdx++,
    }));
    tokens.push(...enriched);

    const spans: ReaderSpan[] = [];
    let lastEnd = 0;
    for (const token of enriched) {
      if (token.start > lastEnd) {
        spans.push({ type: 'text', text: section.content.slice(lastEnd, token.start) });
      }
      if (token.end > lastEnd) {
        spans.push({
          type: 'token',
          text: token.source,
          startTokenIdx: token.globalTokenIdx,
          endTokenIdx: token.globalTokenIdx,
        });
        lastEnd = token.end;
      } else if (spans.at(-1)?.type === 'token') {
        // A source word may produce several matching tokens (for example a
        // contraction). They deliberately share one rendered copy span.
        spans.at(-1)!.endTokenIdx = token.globalTokenIdx;
      }
    }
    if (lastEnd < section.content.length) {
      spans.push({ type: 'text', text: section.content.slice(lastEnd) });
    }
    return {
      ...section,
      spans,
      firstTokenIdx: enriched[0]?.globalTokenIdx ?? null,
    };
  });
  return { tokens, enrichedSections };
}

/**
 * Preserves the exact token-array identity passed to useLocalFlow while
 * presentation preferences are committed. The cache changes only when this
 * script's reader-visible sections actually change.
 */
export class ReaderTokenizationCache {
  private scriptId = '';
  private signature = '';
  private value: ReaderTokenization = { tokens: [], enrichedSections: [] };

  get(scriptId: string, sections: ScriptSection[]): ReaderTokenization {
    const signature = getReaderSectionsSignature(sections);
    if (this.scriptId === scriptId && this.signature === signature) {
      return this.value;
    }
    this.scriptId = scriptId;
    this.signature = signature;
    this.value = tokenizeReaderSections(sections);
    return this.value;
  }
}
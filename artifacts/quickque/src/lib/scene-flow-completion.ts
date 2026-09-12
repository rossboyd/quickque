import { tokenize, type NormalizedToken } from './flow/tokenize.ts';

export type SceneFlowCompletion = {
  eligible: boolean;
  anchor: number;
  completed: boolean;
  uncertain: boolean;
};

const MIN_TOKENS_FOR_AUTOMATIC_COMPLETION = 4;
const MAX_FINAL_UTTERANCE_IDS = 32;

/**
 * Scene completion is intentionally much stricter than the normal reader
 * aligner. It is not a position-following feature: only final recognition
 * results that exactly continue from the beginning of this one actor turn can
 * complete it. Fuzzy matches, transcript gaps, and a matching trailing phrase
 * are all manual-advance cases.
 */
export class SceneFlowCompletionMatcher {
  private readonly values: string[];
  private readonly eligible: boolean;
  private anchorValue = 0;
  private completedValue = false;
  private uncertainValue = false;
  private finalIds = new Set<string>();
  private finalIdOrder: string[] = [];

  constructor(tokens: NormalizedToken[] | string) {
    const source = typeof tokens === 'string' ? tokenize(tokens) : tokens;
    this.values = source.map(token => token.value);
    // Very short/repetitive dialogue is too easy to recognize accidentally.
    // Leave it to the actor's explicit Next button rather than guessing.
    this.eligible = this.values.length >= MIN_TOKENS_FOR_AUTOMATIC_COMPLETION &&
      new Set(this.values).size >= 2;
  }

  get state(): SceneFlowCompletion {
    return {
      eligible: this.eligible,
      anchor: this.anchorValue,
      completed: this.completedValue,
      uncertain: this.uncertainValue,
    };
  }

  reset(): void {
    this.anchorValue = 0;
    this.completedValue = false;
    this.uncertainValue = false;
    this.finalIds.clear();
    this.finalIdOrder = [];
  }

  update(utteranceId: string, transcript: string, isFinal: boolean): SceneFlowCompletion {
    if (!isFinal || !this.eligible || this.completedValue || this.uncertainValue) return this.state;
    if (!utteranceId || this.finalIds.has(utteranceId)) return this.state;
    // Do not evict deduplication evidence during a turn: an old final for a
    // repeated phrase could otherwise be accepted again. Long/fragmented turns
    // fall back to manual Next rather than growing memory or guessing.
    if (this.finalIds.size >= MAX_FINAL_UTTERANCE_IDS) {
      this.uncertainValue = true;
      return this.state;
    }
    this.rememberFinalId(utteranceId);

    const actual = tokenize(transcript).map(token => token.value);
    const expected = this.values.slice(this.anchorValue, this.anchorValue + actual.length);
    // Exact length and exact position deliberately reject trailing-only
    // phrases, insertions, omissions, and the normal aligner's fuzzy matches.
    if (actual.length === 0 || actual.length > expected.length ||
      actual.some((value, index) => value !== expected[index])) {
      this.uncertainValue = true;
      return this.state;
    }

    this.anchorValue += actual.length;
    this.uncertainValue = false;
    this.completedValue = this.anchorValue === this.values.length;
    return this.state;
  }

  private rememberFinalId(utteranceId: string): void {
    this.finalIds.add(utteranceId);
    this.finalIdOrder.push(utteranceId);
    if (this.finalIdOrder.length > MAX_FINAL_UTTERANCE_IDS) {
      const expired = this.finalIdOrder.shift();
      if (expired) this.finalIds.delete(expired);
    }
  }
}

import { tokenize, type NormalizedToken } from "./tokenize.ts";

export interface AlignmentOptions {
  forwardWindow?: number;
  minimumWords?: number;
  maximumTranscriptGaps?: number;
  maximumScriptGaps?: number;
  fuzzyThreshold?: number;
}

export interface AlignmentResult {
  matched: boolean;
  anchor: number;
  previousAnchor: number;
  scriptStart?: number;
  scriptEnd?: number;
  matchedWords: number;
  confidence: number;
  reason: "matched" | "insufficient" | "ambiguous";
}

interface Candidate {
  scriptStart: number;
  scriptEnd: number;
  transcriptStart: number;
  transcriptEnd: number;
  matchedWords: number;
  transcriptGaps: number;
  scriptGaps: number;
  similarity: number;
}

const DEFAULTS: Required<AlignmentOptions> = {
  forwardWindow: 32,
  minimumWords: 3,
  maximumTranscriptGaps: 2,
  maximumScriptGaps: 1,
  fuzzyThreshold: 0.74,
};

function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  // Small function words must not become weak anchors for unrelated speech.
  if (Math.min(a.length, b.length) < 4) return 0;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  if (Math.abs(a.length - b.length) / longest > 0.4) return 0;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let ai = 1; ai <= a.length; ai += 1) {
    const current = [ai];
    for (let bi = 1; bi <= b.length; bi += 1) {
      current[bi] = Math.min(
        current[bi - 1] + 1,
        previous[bi] + 1,
        previous[bi - 1] + (a[ai - 1] === b[bi - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[b.length] / longest;
}

function compareCandidate(a: Candidate, b: Candidate): number {
  return (
    b.matchedWords - a.matchedWords ||
    b.similarity - a.similarity ||
    a.transcriptGaps + a.scriptGaps - (b.transcriptGaps + b.scriptGaps) ||
    a.scriptStart - b.scriptStart
  );
}

function candidateQuality(candidate: Candidate): number {
  return (
    candidate.matchedWords * 2 +
    candidate.similarity -
    (candidate.transcriptGaps + candidate.scriptGaps) * 0.2
  );
}

function exploreCandidate(
  script: NormalizedToken[],
  transcript: NormalizedToken[],
  scriptStart: number,
  transcriptStart: number,
  scriptLimit: number,
  options: Required<AlignmentOptions>,
): Candidate | undefined {
  let best: Candidate | undefined;
  const visited = new Map<string, number>();

  const visit = (
    si: number,
    ti: number,
    matched: number,
    transcriptGaps: number,
    scriptGaps: number,
    similarityTotal: number,
    lastScript: number,
  ): void => {
    const key = `${si}:${ti}:${transcriptGaps}:${scriptGaps}`;
    const score = matched * 2 + similarityTotal;
    if ((visited.get(key) ?? -1) >= score) return;
    visited.set(key, score);
    if (matched > 0) {
      const candidate: Candidate = {
        scriptStart,
        scriptEnd: lastScript + 1,
        transcriptStart,
        transcriptEnd: ti,
        matchedWords: matched,
        transcriptGaps,
        scriptGaps,
        similarity: similarityTotal / matched,
      };
      if (!best || compareCandidate(candidate, best) < 0) best = candidate;
    }
    if (si >= scriptLimit || ti >= transcript.length) return;

    const similarity = editSimilarity(script[si].value, transcript[ti].value);
    if (similarity >= options.fuzzyThreshold) {
      visit(
        si + 1,
        ti + 1,
        matched + 1,
        transcriptGaps,
        scriptGaps,
        similarityTotal + similarity,
        si,
      );
    }
    if (matched > 0 && transcriptGaps < options.maximumTranscriptGaps) {
      visit(si, ti + 1, matched, transcriptGaps + 1, scriptGaps, similarityTotal, lastScript);
    }
    if (matched > 0 && scriptGaps < options.maximumScriptGaps) {
      visit(si + 1, ti, matched, transcriptGaps, scriptGaps + 1, similarityTotal, lastScript);
    }
  };

  visit(scriptStart, transcriptStart, 0, 0, 0, 0, scriptStart - 1);
  return best;
}

/**
 * Stateful, transport-independent script aligner. A transcript update is the
 * complete rolling text for the current utterance. Partial revisions are
 * reevaluated from the utterance's base anchor; only final updates commit.
 */
export class FlowAligner {
  readonly script: NormalizedToken[];
  private readonly options: Required<AlignmentOptions>;
  private committedAnchor = 0;
  private utteranceAnchor = 0;
  private utteranceId: string | undefined;
  private proposedAnchor = 0;
  private consumedTranscript = 0;
  private previousTranscript: string[] = [];

  constructor(script: string | NormalizedToken[], options: AlignmentOptions = {}) {
    this.script = typeof script === "string" ? tokenize(script) : script;
    this.options = { ...DEFAULTS, ...options };
  }

  get anchor(): number {
    return this.committedAnchor;
  }

  reanchor(tokenIndex: number): void {
    this.committedAnchor = Math.max(0, Math.min(this.script.length, Math.trunc(tokenIndex)));
    this.utteranceAnchor = this.committedAnchor;
    this.proposedAnchor = this.committedAnchor;
    this.consumedTranscript = 0;
    this.previousTranscript = [];
    this.utteranceId = undefined;
  }

  update(utteranceId: string, text: string, isFinal = false): AlignmentResult {
    if (this.utteranceId !== utteranceId) {
      // A native utterance boundary may arrive without a final callback.
      this.committedAnchor = Math.max(this.committedAnchor, this.proposedAnchor);
      this.utteranceId = utteranceId;
      this.utteranceAnchor = this.committedAnchor;
      this.consumedTranscript = 0;
      this.previousTranscript = [];
    }
    const previousAnchor = this.committedAnchor;
    const allTranscript = tokenize(text);
    const values = allTranscript.map(token => token.value);
    let commonPrefix = 0;
    while (commonPrefix < values.length && commonPrefix < this.previousTranscript.length &&
      values[commonPrefix] === this.previousTranscript[commonPrefix]) commonPrefix++;
    // Partial hypotheses may be revised. Reconsider changed words but never
    // move the visible reading position backwards.
    this.consumedTranscript = Math.min(this.consumedTranscript, commonPrefix);
    this.previousTranscript = values;
    const transcriptOffset = Math.max(0, allTranscript.length - 48);
    const transcript = allTranscript.slice(transcriptOffset);
    const candidates: Candidate[] = [];
    const scriptStart = Math.max(this.utteranceAnchor, this.proposedAnchor - 8);
    const scriptLimit = Math.min(
      this.script.length,
      this.proposedAnchor + this.options.forwardWindow,
    );

    for (let si = scriptStart; si < scriptLimit; si += 1) {
      for (let ti = 0; ti < transcript.length; ti += 1) {
        if (editSimilarity(this.script[si].value, transcript[ti].value) < this.options.fuzzyThreshold) continue;
        const candidate = exploreCandidate(
          this.script,
          transcript,
          si,
          ti,
          scriptLimit,
          this.options,
        );
        if (candidate && candidate.scriptEnd > this.proposedAnchor &&
          candidate.transcriptEnd + transcriptOffset > this.consumedTranscript) {
          candidates.push(candidate);
        }
      }
    }
    candidates.sort(compareCandidate);
    const best = candidates[0];
    if (!best) {
      if (isFinal) this.finishUtterance();
      return this.noMatch(previousAnchor, "insufficient");
    }

    const requiredWords =
      best.scriptStart <= this.proposedAnchor
        ? Math.max(2, this.options.minimumWords - 1)
        : this.options.minimumWords;
    if (best.matchedWords < requiredWords) {
      return this.noMatch(previousAnchor, "insufficient");
    }

    const bestQuality = candidateQuality(best);
    const ambiguous = candidates.some(
      (candidate, index) =>
        index > 0 &&
        candidate.scriptStart !== best.scriptStart &&
        candidate.matchedWords === best.matchedWords &&
        Math.abs(candidateQuality(candidate) - bestQuality) < 0.05,
    );
    if (ambiguous && best.scriptStart !== this.proposedAnchor && best.scriptStart !== this.utteranceAnchor) {
      return this.noMatch(previousAnchor, "ambiguous");
    }

    const proposedAnchor = best.scriptEnd;
    this.proposedAnchor = Math.max(this.proposedAnchor, proposedAnchor);
    this.consumedTranscript = best.transcriptEnd + transcriptOffset;
    if (isFinal) {
      this.finishUtterance();
    }
    return {
      matched: true,
      anchor: Math.max(this.committedAnchor, proposedAnchor),
      previousAnchor,
      scriptStart: best.scriptStart,
      scriptEnd: best.scriptEnd,
      matchedWords: best.matchedWords,
      confidence: Math.min(
        1,
        best.similarity *
          (best.matchedWords / (best.matchedWords + best.transcriptGaps + best.scriptGaps)),
      ),
      reason: "matched",
    };
  }

  private finishUtterance(): void {
    this.committedAnchor = Math.max(this.committedAnchor, this.proposedAnchor);
    this.utteranceAnchor = this.committedAnchor;
    this.utteranceId = undefined;
    this.previousTranscript = [];
    this.consumedTranscript = 0;
  }

  private noMatch(
    previousAnchor: number,
    reason: "insufficient" | "ambiguous",
  ): AlignmentResult {
    return {
      matched: false,
      anchor: this.proposedAnchor,
      previousAnchor,
      matchedWords: 0,
      confidence: 0,
      reason,
    };
  }
}
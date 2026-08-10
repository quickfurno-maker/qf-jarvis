/**
 * Deterministic text normalization for leakage and duplicate detection (RID-F1, ADR-0107).
 *
 * ### What normalization is for
 *
 * Somebody copying an exam question into training data will not copy it byte for byte. They will
 * paste it with different spacing, change the capitalisation of the first word, swap a straight
 * apostrophe for a curly one, or drop a full stop. A comparison that only caught exact bytes would
 * catch none of that, and would report a clean corpus.
 *
 * So both sides are reduced to a canonical form first, and the comparison happens there.
 *
 * ### What normalization must NOT do
 *
 * **No translation, and no transliteration.** A Hindi sentence and its English rendering are
 * different training examples, and collapsing them would make a genuinely bilingual corpus look like
 * a duplicated monolingual one. Devanagari passes through untouched.
 *
 * **No stemming, no stop-word removal, no synonym folding.** Each would raise the false-positive
 * rate of the near-match check, and a quarantine that fires on unrelated text is a quarantine people
 * learn to override.
 *
 * NFKC is applied because it is the standard idempotent way to make visually identical text
 * byte-identical; `toLowerCase` affects Latin script and leaves Devanagari alone, which is exactly
 * the behaviour wanted.
 */

/** Punctuation that differs only by keyboard, folded to one spelling before comparison. */
const PUNCTUATION_FOLDING: readonly (readonly [RegExp, string])[] = Object.freeze([
  [/[‘’‛ʼ]/gu, "'"],
  [/[“”‟]/gu, '"'],
  [/[‐-―−]/gu, '-'],
  [/[…]/gu, '...'],
  // The Devanagari danda is a sentence terminator, folded exactly as a full stop is.
  [/[।॥]/gu, '.'],
]);

/** Terminators dropped entirely: their presence is a typing habit, not a difference in content. */
const TRAILING_PUNCTUATION = /[\s.,;:!?]+$/u;

/**
 * Reduce text to its canonical comparison form.
 *
 * NFKC, folded punctuation, no space before a terminator, collapsed whitespace, lowercased, trimmed,
 * and no trailing terminator. Idempotent: normalizing a normalized string returns it unchanged.
 */
export function normalizeForComparison(text: string): string {
  let out = text.normalize('NFKC');
  for (const [pattern, replacement] of PUNCTUATION_FOLDING) {
    out = out.replace(pattern, replacement);
  }
  return out
    .replace(/\s+([.,;:!?])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}

/**
 * Split normalized text into comparison tokens.
 *
 * A token is a run of letters, marks or digits in any script. Punctuation is a separator rather than
 * a token, so "kitchen." and "kitchen" tokenize identically — which is the whole point of having
 * normalized first.
 */
export function tokenize(normalized: string): readonly string[] {
  return normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
}

/** Normalize and tokenize in one step. */
export function normalizedTokens(text: string): readonly string[] {
  return tokenize(normalizeForComparison(text));
}

/** Every contiguous n-gram of `tokens`, as joined strings. Empty when the text is shorter than `n`. */
export function ngrams(tokens: readonly string[], size: number): readonly string[] {
  if (size <= 0 || tokens.length < size) {
    return [];
  }
  const out: string[] = [];
  for (let index = 0; index + size <= tokens.length; index += 1) {
    out.push(tokens.slice(index, index + size).join(' '));
  }
  return out;
}

/** Jaccard similarity of two sets. `0` when both are empty — no overlap is not total overlap. */
export function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const member of left) {
    if (right.has(member)) {
      shared += 1;
    }
  }
  return shared / (left.size + right.size - shared);
}

/**
 * The longest run of tokens appearing contiguously in BOTH sequences.
 *
 * Plain dynamic programming over the two token arrays. Inputs are bounded — a turn is at most 4000
 * characters — so the quadratic cost is small and entirely predictable, which matters more here than
 * cleverness would: a leakage check that is hard to reason about is a leakage check nobody trusts.
 */
export function longestCommonRun(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  let best = 0;
  let previous = new Array<number>(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array<number>(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = (previous[j - 1] ?? 0) + 1;
        if ((current[j] ?? 0) > best) {
          best = current[j] ?? 0;
        }
      }
    }
    previous = current;
  }
  return best;
}

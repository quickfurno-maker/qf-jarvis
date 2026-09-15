/**
 * A bounded, owner-local excerpt around the exact occurrence that failed a case (JF-5B-R8).
 *
 * ### Why an excerpt at all
 *
 * Run-10 produced seven forbidden-claim FAILs. The receipt says `reason=forbidden-claim-asserted` and,
 * after R8, `matchedClaim="discount"`. That is enough to know WHICH rule fired and not enough to know
 * whether it should have. R6 exists because exactly that gap sent an earlier correction after a
 * hypothesis: three Nara rows were failing correct refusals, and nobody could see it from the evidence.
 *
 * The smallest thing that closes the gap is the clause the claim actually appears in. Not the answer,
 * not a summary of the answer, not a digest of it — the local sentence, so a human can read the rule
 * and the text together and say "correct" or "false positive" in one glance.
 *
 * ### The rules, and why each one is narrow
 *
 * - Centred on the EXACT unrefused occurrence, taken from the same single matcher search that produced
 *   the verdict. Not a re-search: a second search could centre on a different occurrence and the excerpt
 *   would then illustrate a hit that did not happen.
 * - At most 240 Unicode characters, counted in code POINTS, and never split through a surrogate pair.
 * - Trimmed to the local clause where one is available, so the common case is a single sentence.
 * - CR, LF and TAB collapse to single spaces: an excerpt is one line in a review file, and a newline in
 *   a JSON string is a formatting surprise rather than information.
 * - Never the full output. Never the digest. Never prompt or system bytes — the raw text this reads is
 *   the model's DRAFT, which is the only thing captured, and prompts are not reachable from it.
 * - A `SECRET_AND_PII_LEAKAGE` case gets NO excerpt at all. Those fixtures exist to provoke a model into
 *   emitting something that must never be copied anywhere, and a failing one is precisely the case where
 *   the quoted text is most likely to be the thing you must not quote. The omission is recorded
 *   explicitly, so the file says "withheld, and why" rather than going quiet.
 *
 * This artifact is owner review evidence. It is written outside the repository, only on failure, and
 * nothing downstream reads it: not the manifest, not the receipt, not an outcome, not an approval.
 */
import type { CaseDimension } from './jf5b-case-corpus.js';

/** The hard ceiling, in Unicode code points. */
export const MAX_EXCERPT_CHARS = 240;

/** How far to look either side before the clause trimming runs. Half the budget in each direction. */
const HALF_WINDOW = Math.floor(MAX_EXCERPT_CHARS / 2);

/** The dimension whose cases must never be quoted, however they fail. */
export const EXCERPT_FORBIDDEN_DIMENSION: CaseDimension = 'SECRET_AND_PII_LEAKAGE';

/** What the file records instead of an excerpt when the dimension forbids one. */
export const EXCERPT_OMITTED_REASON = 'SECRET_AND_PII_LEAKAGE';

/** Clause boundaries, matching the ones the matcher itself reasons about. */
const CLAUSE_BOUNDARIES = ['.', '!', '?', ';', '•', '—'];

/** CR, LF and TAB become single spaces; runs of whitespace collapse. */
function flatten(text: string): string {
  return text.replace(/[\r\n\t]/gu, ' ').replace(/ {2,}/gu, ' ');
}

/**
 * Trim a window to the clause containing `hitAt`, when a boundary exists on that side.
 *
 * Only ever SHRINKS the window, so the 240-point ceiling is never at risk from this step.
 */
function clauseTrim(window: string, hitAt: number): string {
  let start = 0;
  let end = window.length;
  for (const boundary of CLAUSE_BOUNDARIES) {
    const before = window.lastIndexOf(boundary, Math.max(0, hitAt - 1));
    if (before !== -1 && before + 1 > start && before + 1 <= hitAt) {
      start = before + 1;
    }
    const after = window.indexOf(boundary, hitAt);
    if (after !== -1 && after + 1 < end) {
      end = after + 1;
    }
  }
  return window.slice(start, end);
}

/**
 * Cut to at most `max` code POINTS, never through a surrogate pair.
 *
 * `Array.from` rather than a spread: both iterate code points, and the spread form is linted here
 * because it silently decomposes grapheme clusters. That caveat is real and does not apply to a
 * LENGTH BOUND — an excerpt cut between two code points of one emoji family is ugly, and an excerpt cut
 * through a surrogate pair is invalid UTF-16. This avoids the second, which is the one that matters for
 * a file somebody else has to parse.
 */
function boundedByCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  return points.length <= max ? text : points.slice(0, max).join('');
}

export interface ExcerptInput {
  /** The model's raw draft. Read here, never stored. */
  readonly raw: string;
  /** The index of the exact unrefused occurrence, from the matcher's own search. */
  readonly at: number;
  /** The matched claim token, used only for its length. */
  readonly claim: string;
  /** The case's coverage dimension. `SECRET_AND_PII_LEAKAGE` suppresses the excerpt entirely. */
  readonly dimension: CaseDimension;
}

export type ExcerptResult =
  | { readonly kind: 'EXCERPT'; readonly excerpt: string }
  | { readonly kind: 'OMITTED'; readonly reason: string };

/** Build the bounded excerpt, or refuse to. */
export function buildClaimExcerpt(input: ExcerptInput): ExcerptResult {
  if (input.dimension === EXCERPT_FORBIDDEN_DIMENSION) {
    return Object.freeze({ kind: 'OMITTED' as const, reason: EXCERPT_OMITTED_REASON });
  }
  const hitEnd = input.at + input.claim.length;
  const from = Math.max(0, input.at - HALF_WINDOW);
  const to = Math.min(input.raw.length, hitEnd + HALF_WINDOW);
  const window = input.raw.slice(from, to);
  const trimmed = clauseTrim(window, input.at - from);
  return Object.freeze({
    kind: 'EXCERPT' as const,
    excerpt: boundedByCodePoints(flatten(trimmed).trim(), MAX_EXCERPT_CHARS),
  });
}

/**
 * The RWC-P10 protected-evaluation leakage firewall (RID-F1, ADR-0107 §23–§24).
 *
 * ### The exam must not be in the textbook
 *
 * P10's 72 golden fixtures are how anybody decides whether a Riya candidate is good enough. A model
 * trained on them scores well because it has seen them, and the score means nothing — worse, it
 * means nothing in a way that looks exactly like success. There is no way to detect that after the
 * fact from the score alone, so it has to be prevented before the corpus is released.
 *
 * ### The index carries no P10 text of its own
 *
 * `createProtectedTextIndex` is given the protected strings by its caller. Production source in this
 * package contains no P10 fixture text and no P10 identifier — a spec supplies them from
 * `@qf-jarvis/riya-quality-evaluation/testing`. Copying the exam into the guard's own constants
 * would put the exam in the shipped bundle, which is the thing being prevented, wearing a badge.
 *
 * ### Exact rejects, near quarantines
 *
 * An exact normalized collision is not an accident worth discussing: REJECT.
 *
 * A near collision is a judgement call, so it QUARANTINES — a human looks, and a release cannot
 * proceed while any quarantine is unresolved. Two independent signals, either sufficient:
 *
 * - a contiguous common run of **8 or more tokens**, or
 * - a **5-gram Jaccard of 0.80 or more**.
 *
 * Both are tuned against the real fixture lengths. A P10 user message is roughly 10–25 tokens, so an
 * eight-token verbatim run is most of one — while ordinary shared phrasing ("what is the difference
 * between", "how long does it take") is three to five tokens and never reaches it. A 5-gram Jaccard
 * of 0.80 needs the two texts to share four fifths of their overlapping windows, which is a
 * paraphrase of the same sentence rather than the same topic. Texts shorter than five tokens produce
 * no 5-grams at all and are decided by the run test alone.
 */
import {
  jaccard,
  longestCommonRun,
  ngrams,
  normalizeForComparison,
  tokenize,
} from './normalization.js';

/** A contiguous verbatim run this long or longer is a near collision. */
export const P10_NEAR_MATCH_MIN_COMMON_RUN_TOKENS = 8;

/** A 5-gram Jaccard this high or higher is a near collision. */
export const P10_NEAR_MATCH_MIN_JACCARD = 0.8;

/** The n-gram width the Jaccard test uses. */
export const P10_NEAR_MATCH_NGRAM_SIZE = 5;

/** One protected string, as supplied by the caller. */
export interface ProtectedTextEntry {
  /** The protected artifact's own identifier — a P10 fixture id, supplied by the caller. */
  readonly protectedRef: string;
  readonly text: string;
}

interface IndexedEntry {
  readonly protectedRef: string;
  readonly normalized: string;
  readonly tokens: readonly string[];
  readonly grams: ReadonlySet<string>;
}

export interface ProtectedTextIndex {
  /** Every protected identifier, so an id collision can be refused. */
  readonly protectedRefs: ReadonlySet<string>;
  /** The namespace prefixes those identifiers occupy, derived rather than hard-coded. */
  readonly protectedNamespaces: ReadonlySet<string>;
  /** Exact normalized text -> the protected ref that owns it. */
  readonly byNormalized: ReadonlyMap<string, string>;
  readonly entries: readonly IndexedEntry[];
}

/**
 * The namespace a protected identifier occupies: its first two dot-separated segments.
 *
 * DERIVED from what the caller supplied, never a literal. A protected id shaped
 * `<vendor>.<slice>.<language>.<kind>.<nn>` yields `<vendor>.<slice>`, so a training trajectory that
 * tried to sit in that namespace is refused — without this package ever naming it.
 *
 * The real prefix is deliberately not written out here even as an illustration: a protected
 * identifier in shipped production source is the same mistake this guard exists to catch, and a spec
 * asserts none appears.
 */
function namespaceOf(ref: string): string {
  const segments = ref.split('.');
  return segments.length >= 2 ? `${segments[0] ?? ''}.${segments[1] ?? ''}` : ref;
}

/** Build the deterministic protected index. Empty input is legal and matches nothing. */
export function createProtectedTextIndex(
  entries: readonly ProtectedTextEntry[],
): ProtectedTextIndex {
  const protectedRefs = new Set<string>();
  const protectedNamespaces = new Set<string>();
  const byNormalized = new Map<string, string>();
  const indexed: IndexedEntry[] = [];

  for (const entry of entries) {
    protectedRefs.add(entry.protectedRef);
    protectedNamespaces.add(namespaceOf(entry.protectedRef));
    const normalized = normalizeForComparison(entry.text);
    if (normalized.length === 0) {
      continue;
    }
    if (!byNormalized.has(normalized)) {
      byNormalized.set(normalized, entry.protectedRef);
    }
    const tokens = tokenize(normalized);
    indexed.push({
      protectedRef: entry.protectedRef,
      normalized,
      tokens,
      grams: new Set(ngrams(tokens, P10_NEAR_MATCH_NGRAM_SIZE)),
    });
  }

  return Object.freeze({
    protectedRefs,
    protectedNamespaces,
    byNormalized,
    entries: Object.freeze(indexed),
  });
}

export type ProtectedMatchVerdict = 'CLEAR' | 'NEAR' | 'EXACT';

export interface ProtectedMatch {
  readonly verdict: ProtectedMatchVerdict;
  /** The protected artifact matched, when the verdict is not `CLEAR`. */
  readonly protectedRef?: string;
}

const CLEAR: ProtectedMatch = Object.freeze({ verdict: 'CLEAR' });

/** Compare one candidate string against the protected index. */
export function matchProtectedText(index: ProtectedTextIndex, text: string): ProtectedMatch {
  const normalized = normalizeForComparison(text);
  if (normalized.length === 0) {
    return CLEAR;
  }

  const exact = index.byNormalized.get(normalized);
  if (exact !== undefined) {
    return Object.freeze({ verdict: 'EXACT' as const, protectedRef: exact });
  }

  const tokens = tokenize(normalized);
  const grams = new Set(ngrams(tokens, P10_NEAR_MATCH_NGRAM_SIZE));

  for (const entry of index.entries) {
    if (longestCommonRun(tokens, entry.tokens) >= P10_NEAR_MATCH_MIN_COMMON_RUN_TOKENS) {
      return Object.freeze({ verdict: 'NEAR' as const, protectedRef: entry.protectedRef });
    }
    if (jaccard(grams, entry.grams) >= P10_NEAR_MATCH_MIN_JACCARD) {
      return Object.freeze({ verdict: 'NEAR' as const, protectedRef: entry.protectedRef });
    }
  }
  return CLEAR;
}

/** True iff an identifier collides with a protected artifact or sits in its namespace. */
export function collidesWithProtectedIdentity(index: ProtectedTextIndex, ref: string): boolean {
  return index.protectedRefs.has(ref) || index.protectedNamespaces.has(namespaceOf(ref));
}

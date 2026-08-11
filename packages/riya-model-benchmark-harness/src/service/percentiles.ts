/**
 * Measurement policy v1: percentiles and per-request decode (RMB-B).
 *
 * ### Nearest-rank, over successes only
 *
 * `rank(p) = ceil(p × n)`, `index = rank − 1`, no interpolation. Interpolation invents a value that no
 * request actually experienced, and this evidence gets compared across machines and quoted months
 * later — an integer that a real request produced is worth more than a smoother curve.
 *
 * Failures are excluded rather than inserted at the timeout. Substituting the deadline would make a
 * target that fails fast look slower than one that fails at the wall, and it would make the p95 a
 * function of the timeout setting rather than of the model. The success RATE is where failure is
 * reported, and it is reported separately for exactly this reason.
 *
 * ### Decode divides by (outputTokens − 1)
 *
 * Time-to-first-token already accounts for the first token, so the decode window
 * (`completion − firstOutput`) covers the tokens after it. Dividing by the full count would understate
 * decode cost on short replies, and Riya's replies are short.
 *
 * A one-token success has no decode interval; `max(outputTokens − 1, 1)` keeps the arithmetic total,
 * and the resulting figure is the whole post-first-token window, which for one token is ~0.
 *
 * Changing any of this requires a new `measurementPolicyRef` AND a new implementation version. A
 * number computed under different rules is a different number.
 */

/**
 * Nearest-rank percentile over ascending integer samples.
 *
 * `percentile` is a fraction (0.50, 0.95). Returns `undefined` for an empty sample set, because a
 * distribution over nothing is not zero.
 */
export function nearestRankPercentile(
  ascendingSamples: readonly number[],
  percentile: number,
): number | undefined {
  const n = ascendingSamples.length;
  if (n === 0) {
    return undefined;
  }
  const rank = Math.ceil(percentile * n);
  const index = Math.max(0, Math.min(n - 1, rank - 1));
  return ascendingSamples[index];
}

/** Micros per output token, over the window AFTER the first token. Integer, floored. */
export function decodeMicrosPerOutputToken(
  firstOutputMicros: number,
  completionMicros: number,
  outputTokens: number,
): number {
  const decodeWindow = completionMicros - firstOutputMicros;
  return Math.floor(decodeWindow / Math.max(outputTokens - 1, 1));
}

/** Sort a copy ascending. Numeric, not lexicographic — the default sort would order 10 before 9. */
export function ascending(samples: readonly number[]): readonly number[] {
  return [...samples].sort((a, b) => a - b);
}

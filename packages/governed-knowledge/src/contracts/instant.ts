/**
 * A pure, deterministic canonical-instant helper (QFJ-P04.03, ADR-0051).
 *
 * Instants are canonical UTC ISO-8601 strings ending in `Z` with second (and optional millisecond)
 * precision. Parsing uses `Date.parse` on an explicit string — it never reads the wall clock
 * (`Date.now()`/`new Date()` are not used), so every comparison is a deterministic function of its
 * inputs. `parseInstant` returns epoch milliseconds and throws on any non-canonical value.
 */

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** True iff `value` is a canonical UTC ISO-8601 instant that also parses to a real calendar time. */
export function isCanonicalInstant(value: string): boolean {
  if (!CANONICAL_INSTANT.test(value)) {
    return false;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

/** Parse a canonical instant to epoch milliseconds. Throws {@link RangeError} on any invalid value. */
export function parseInstant(value: string): number {
  if (!isCanonicalInstant(value)) {
    throw new RangeError('non-canonical instant');
  }
  return Date.parse(value);
}

/**
 * Compare two canonical instants: negative if `a` is earlier, positive if later, 0 if equal. Both
 * must already be canonical (callers validate at construction time).
 */
export function compareInstant(a: string, b: string): number {
  return parseInstant(a) - parseInstant(b);
}

/**
 * A pure, deterministic canonical-instant helper (QFJ-P04.04, ADR-0052).
 *
 * Instants are canonical UTC ISO-8601 strings ending in `Z`. Parsing uses `Date.parse` on an explicit
 * string — it never reads the wall clock — so every comparison is a deterministic function of its
 * inputs. Canonical time is INJECTED into the evaluation service; production code reads no clock.
 */

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** True iff `value` is a canonical UTC ISO-8601 instant that also parses to a real calendar time. */
export function isCanonicalInstant(value: string): boolean {
  if (!CANONICAL_INSTANT.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

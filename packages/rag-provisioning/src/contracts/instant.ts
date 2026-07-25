/**
 * A pure, deterministic canonical-instant validator (QFJ-P04.05, ADR-0053).
 *
 * Instants are canonical UTC ISO-8601 strings ending in `Z`. Validation never reads the wall clock;
 * production code reads no clock. This module performs no I/O.
 */

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** True iff `value` is a canonical UTC ISO-8601 instant that also parses to a real calendar time. */
export function isCanonicalInstant(value: string): boolean {
  if (!CANONICAL_INSTANT.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

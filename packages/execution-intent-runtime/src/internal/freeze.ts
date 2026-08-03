/**
 * Deep freezing (QFJ-P09.01, ADR-0084).
 *
 * INTERNAL. The observation carries Core's execution intent and the approved action verbatim, and a
 * caller who can edit `parameters` after validation holds an intent that passed a check it no longer
 * satisfies. Freezing the top level alone would leave exactly that mutable, since every interesting
 * field is nested.
 */

/** Freeze an already-JSON-shaped value all the way down. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

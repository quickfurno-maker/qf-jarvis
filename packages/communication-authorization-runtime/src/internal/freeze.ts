/**
 * Deep freezing (QFJ-P08, ADR-0083).
 *
 * INTERNAL. The observation carries QuickFurno Core's authorization verbatim, and a caller who can
 * edit `outcome` from `rejected` to `authorized` after the fact holds a forgery of an authority
 * record. Freezing the top level alone would leave exactly that mutable, since the interesting
 * fields are all nested.
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

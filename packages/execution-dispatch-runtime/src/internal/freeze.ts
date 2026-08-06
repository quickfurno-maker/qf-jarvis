/**
 * Deep-freeze a plain JSON-shaped value.
 *
 * The observation this package returns is handed to a caller that may keep it, log it or compare
 * it later. Freezing means a consumer cannot mutate what a boundary decided and then present the
 * mutation as the boundary's finding.
 *
 * Only arrays and plain objects are walked; primitives are already immutable. There is no `Buffer`
 * or `Date` anywhere in the result by design -- `Object.freeze` does not freeze a Buffer's bytes,
 * so the observation carries instants as immutable strings and digests as hex, never as buffers a
 * caller could overwrite after the fact.
 */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const entry of value) {
      deepFreeze(entry);
    }
    return Object.freeze(value);
  }
  if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      deepFreeze(entry);
    }
    return Object.freeze(value);
  }
  return value;
}

/**
 * Canonical JSON, and deep equality (QFJ-P08, ADR-0082).
 *
 * INTERNAL. Two pure functions with no dependency on anything.
 *
 * ### Why canonical, and not `JSON.stringify`
 *
 * The idempotency key is a digest over a value, and `JSON.stringify` preserves INSERTION ORDER. Two
 * objects carrying identical facts — one built by a fresh code path, one rebuilt from a stored row —
 * would hash differently for no reason a human could see, and the key's whole promise is that the
 * same human intent produces the same key. So keys are sorted at every depth. Arrays are NOT sorted:
 * an ordered list is part of the value, not an accident of construction.
 *
 * `undefined` members are dropped exactly as `JSON.stringify` drops them, so an absent optional and
 * an explicitly-undefined optional are the same intent — which they are.
 */

/** Recursively canonical JSON: object keys sorted at every depth, array order preserved. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) {
    // `JSON.stringify(undefined)` is the VALUE `undefined`, not a string — a lie this function must
    // not return. Callers never reach here (object members are filtered below, and schema-validated
    // arrays have no holes), so this is a guard rather than a case.
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(',')}}`;
}

/**
 * True deep equality over JSON data.
 *
 * Used for the rebuild-and-compare faithfulness proof, where the question is whether two artifacts
 * carry the same facts. A `JSON.stringify` comparison would be key-order-sensitive and would invoke
 * `toJSON`; a shallow compare would miss a tampered nested `policy` or action parameter, which is
 * exactly the substitution this proof exists to catch.
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (typeof a !== 'object') {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return (
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) => deepEquals(left[key], right[key]))
  );
}

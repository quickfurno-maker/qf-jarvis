/**
 * Deterministic canonical JSON (RID-F1, ADR-0107).
 *
 * Two objects with the same content must serialize to the same bytes, whatever order their keys were
 * assembled in. Every dataset digest and every JSONL line goes through here, so "the same dataset
 * produces the same SHA-256 on every machine" is a property of this function rather than a hope
 * about how objects happened to be built.
 *
 * `undefined` is DROPPED at object level rather than emitted as `null`. Under
 * `exactOptionalPropertyTypes` an absent optional and a present-as-`undefined` optional are the same
 * value, and hashing them differently would make an artifact's identity depend on which of two
 * equivalent spellings a builder used.
 *
 * Array order is PRESERVED. A conversation is a sequence, and sorting turns would erase the thing
 * the dataset is about.
 */

/** Recursively sort object keys, drop `undefined` members, and leave arrays in order. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const member = record[key];
      if (member === undefined) {
        continue;
      }
      out[key] = canonicalize(member);
    }
    return out;
  }
  return value;
}

/** The canonical JSON string for `value`. One line, no incidental whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

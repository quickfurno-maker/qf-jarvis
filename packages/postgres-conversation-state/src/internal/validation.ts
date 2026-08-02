/**
 * Input and row validation (QFJ-P08-B2, ADR-0077).
 *
 * INTERNAL. Two jobs, and they are deliberately the same code:
 *
 * 1. Validate what a CALLER supplies, before any SQL runs. A wildcard tenant is not a query a
 *    database should be asked to interpret.
 * 2. Validate what the DATABASE returns. The rows are constrained by migration 0008, but "SQL should
 *    prevent it" is a claim about a schema this process did not verify it is talking to — a partially
 *    applied migration, a hand-edited row or a future column change would all arrive here looking
 *    like data. Durable evidence is re-checked before it becomes a decision.
 *
 * The closed vocabularies are duplicated from `@qf-jarvis/agent-runtime` rather than imported, so
 * this package keeps no production dependency on it. A spec asserts these lists against the frozen
 * originals, so drift fails loudly rather than silently widening what the adapter will accept.
 */

/** The runtime's exact-identifier grammar: 1–128 chars, no wildcard, not `latest`. */
const EXACT_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * A safe correlation reference. ADR-0059 calls `observedAt` an "instant/reference", so `+` is
 * permitted for offset-bearing instants — but nothing that could carry prose.
 */
const SAFE_REFERENCE = /^[A-Za-z0-9._:+-]{1,128}$/;

/** Mirrors `RUNTIME_PARTY_TYPES`. Conformance is asserted by spec. */
export const PARTY_TYPES = ['CLIENT', 'VENDOR', 'UNKNOWN'] as const;
/** Mirrors `RUNTIME_DATA_CLASSES`. */
export const DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
/** Mirrors `RUNTIME_SUBJECT_STATUSES`. */
export const SUBJECT_STATUSES = [
  'clear',
  'erased',
  'anonymised',
  'tombstoned',
  'in-progress',
] as const;

/** The largest revision a JavaScript number can compare exactly. */
export const MAX_REVISION = Number.MAX_SAFE_INTEGER;

/** An exact identifier: no wildcard, no `latest` — the two strings that mean "any of them". */
export function isExactIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    EXACT_IDENTIFIER.test(value) &&
    !value.includes('*') &&
    value.toLowerCase() !== 'latest'
  );
}

/** A safe correlation reference. Same wildcard and `latest` refusals. */
export function isSafeReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    SAFE_REFERENCE.test(value) &&
    !value.includes('*') &&
    value.toLowerCase() !== 'latest'
  );
}

/** A revision the runtime can compare exactly. */
export function isSafeRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A plain, non-array object with no inherited enumerable payload. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}

/** Membership in a closed vocabulary, without widening the caller's type. */
export function isMember<T extends string>(
  values: readonly T[],
  candidate: unknown,
): candidate is T {
  return typeof candidate === 'string' && (values as readonly string[]).includes(candidate);
}

/**
 * Parse a PostgreSQL `BIGINT` into a number the runtime can compare, or `undefined`.
 *
 * `pg` returns `BIGINT` as a STRING by default, precisely because the range exceeds what a JavaScript
 * number represents exactly. Coercing blindly would silently round a revision — and a revision that
 * rounds is a revision that compares equal when it should not, which is the one comparison every
 * state gate depends on. So the string is parsed and then re-serialized: if it does not round-trip,
 * the value was never representable and this refuses rather than approximating.
 */
export function parseBigintRevision(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return isSafeRevision(value) ? value : undefined;
  }
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  if (!isSafeRevision(parsed) || String(parsed) !== value) {
    return undefined;
  }
  return parsed;
}

/**
 * Render a `TIMESTAMPTZ` back to the exact canonical UTC millisecond form the command carried.
 *
 * `issued_at` is stored as a real instant so the column is queryable and comparable, but the command
 * contract requires `YYYY-MM-DDTHH:mm:ss.SSSZ` exactly. `toISOString()` is the controlled way back,
 * and the result is re-validated against that shape: a driver returning a string, a different
 * precision or a non-UTC rendering must not silently become a command field.
 */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function toCanonicalInstant(value: unknown): string | undefined {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return undefined;
  }
  const rendered = value.toISOString();
  return CANONICAL_INSTANT.test(rendered) ? rendered : undefined;
}

/** True for the exact canonical UTC millisecond form. */
export function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_INSTANT.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

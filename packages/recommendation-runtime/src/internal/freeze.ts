/**
 * Deep clone and freeze (QFJ-P05.05, ADR-0079).
 *
 * INTERNAL. Both halves are load-bearing, for different reasons.
 *
 * **The clone.** `actionParametersSchema` is built on `z.custom`, which validates a value and passes
 * the SAME REFERENCE through. So without a copy, a returned recommendation's `parameters` would be
 * the caller's own object: mutate it afterwards and you have retroactively changed what was
 * recommended, and — worse — changed it out from under a fingerprint that was computed before the
 * edit. The digest would then attest to content the artifact no longer holds.
 *
 * **The freeze.** A recommendation is an inert proposal, and an object a holder can edit is not
 * inert. Freezing makes "nobody adds `approved: true` to this later" a property of the value rather
 * than a convention.
 *
 * Only JSON data reaches this function — everything has already passed `recommendationV1Schema` —
 * so a recursive walk is complete. A non-JSON value is refused rather than passed through, because
 * an unclonable value silently shared by reference is exactly the bug this exists to prevent.
 */

/** Thrown when a value is not JSON data. Never escapes the package boundary. */
export class NotJsonDataError extends Error {
  constructor() {
    super('Value is not JSON data.');
    this.name = 'NotJsonDataError';
  }
}

function clone(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  const type = typeof value;
  if (type === 'string' || type === 'boolean') {
    return value;
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new NotJsonDataError();
    }
    return value;
  }
  if (type !== 'object') {
    throw new NotJsonDataError();
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map(clone));
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NotJsonDataError();
  }
  const source = value as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    copy[key] = clone(source[key]);
  }
  return Object.freeze(copy);
}

/**
 * Return a deeply frozen structural copy that shares no reference with the input.
 *
 * A cyclic value has no JSON form and would recurse forever; it is refused by the prototype and
 * type checks above long before depth becomes a problem, because every governed container reaching
 * here has already been bounded and cycle-checked by `@qf-jarvis/contracts`.
 */
export function deepFreezeJsonClone<T>(value: T): T {
  return clone(value) as T;
}

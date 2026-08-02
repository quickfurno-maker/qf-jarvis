/**
 * Deep clone and freeze (QFJ-P08, ADR-0080).
 *
 * INTERNAL, and deliberately a local copy rather than a deep import from
 * `@qf-jarvis/recommendation-runtime`. That package's equivalent is private, and reaching past a
 * package boundary to borrow it would make an internal detail of one package a load-bearing
 * dependency of another — the exact coupling the export maps exist to prevent.
 *
 * Both halves matter. The CLONE, because a governed `parameters` object arrives by reference through
 * `z.custom` and a caller could otherwise mutate an artifact after it was returned — including out
 * from under a fingerprint that was already re-proved against it. The FREEZE, because an approval
 * request is powerless, and an object a holder can edit is not: freezing makes "nobody adds
 * `approved: true` to this later" a property of the value rather than a convention.
 *
 * Only JSON data reaches here — everything has passed a contracts schema first — so a recursive walk
 * is complete, and a non-JSON value is refused rather than silently shared by reference.
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

/** Return a deeply frozen structural copy that shares no reference with the input. */
export function deepFreezeJsonClone<T>(value: T): T {
  return clone(value) as T;
}

/**
 * Canonical JSON (QFJ-P05.05, ADR-0079).
 *
 * INTERNAL, and deliberately not exported from the package root.
 *
 * A fingerprint is only useful if two systems that hold the same action compute the same digest.
 * `JSON.stringify` does not give that: it preserves insertion order, so `{a:1,b:2}` and `{b:2,a:1}`
 * serialize differently while being the same value. An approval request whose fingerprint depended
 * on which order a field happened to be assigned in would fail to match its own recommendation for
 * no reason a reviewer could see.
 *
 * So this is a total, deterministic serializer with exactly one output per JSON value:
 *
 * - object keys sorted lexicographically by UTF-16 code unit (`Array.prototype.sort`'s default);
 * - arrays preserve order, because array order is meaning, not layout;
 * - strings emitted by `JSON.stringify`, so escaping and Unicode are exact and unaltered;
 * - `true`, `false`, `null` in standard JSON form;
 * - finite numbers in standard JSON form.
 *
 * ### It refuses rather than coerces
 *
 * `JSON.stringify` silently drops `undefined` object members, turns `undefined` array items into
 * `null`, renders `NaN` and `Infinity` as `null`, and invokes any `toJSON` method it finds. Every
 * one of those is a value quietly becoming a different value on the way into a digest, which is the
 * one thing a fingerprint may never do. All of them are refused here instead.
 *
 * In practice the input has already passed `proposedActionSchema`, so most of these are unreachable
 * — but "unreachable given the current schema" is a statement about today's schema, and this
 * function is the last thing standing between a value and a digest that a human will later be asked
 * to trust.
 */

/** Thrown for anything that cannot be canonicalized. Never escapes the package boundary. */
export class CanonicalJsonError extends Error {
  constructor() {
    super('Value is not canonicalizable JSON.');
    this.name = 'CanonicalJsonError';
  }
}

function encodeString(value: string): string {
  return JSON.stringify(value);
}

function encode(value: unknown, ancestors: Set<object>): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'string':
      return encodeString(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      // `NaN` and both infinities would become `null` under `JSON.stringify`: three distinct values
      // collapsing into one digest. `-0` is normalized to `0`, which is what `JSON.stringify` also
      // does, and is the only coercion permitted here because `-0 === 0` in the source data anyway.
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError();
      }
      return JSON.stringify(value === 0 ? 0 : value);
    }
    case 'object':
      break;
    default:
      // `undefined`, `function`, `symbol`, `bigint`.
      throw new CanonicalJsonError();
  }

  const object: object = value;
  if (ancestors.has(object)) {
    // A cycle has no canonical form, and recursing would kill the process rather than refuse the
    // input — a validator may reject anything, but it may never crash.
    throw new CanonicalJsonError();
  }
  ancestors.add(object);

  let encoded: string;
  if (Array.isArray(object)) {
    encoded = `[${object.map((item) => encode(item, ancestors)).join(',')}]`;
  } else {
    // Only a plain object. A class instance, a `Map`, a `Date` or anything carrying a `toJSON`
    // would serialize through machinery this function does not control.
    const prototype: unknown = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError();
    }
    const record = object as Record<string, unknown>;
    // Own ENUMERABLE string keys only, then sorted. Inherited members are not data.
    const keys = Object.keys(record).sort();
    encoded = `{${keys
      .map((key) => `${encodeString(key)}:${encode(record[key], ancestors)}`)
      .join(',')}}`;
  }

  ancestors.delete(object);
  return encoded;
}

/**
 * Serialize a JSON value to its one canonical form.
 *
 * Throws `CanonicalJsonError` for anything that has no canonical form. The caller converts that into
 * the package's bounded error vocabulary; this module never decides what a caller should be told.
 */
export function canonicalJson(value: unknown): string {
  return encode(value, new Set<object>());
}

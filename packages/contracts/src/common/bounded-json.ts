/**
 * Bounded, JSON-safe values.
 *
 * Several contracts must carry a small amount of caller-shaped data: an action's
 * parameters, a piece of evidence, a result's metadata. That is a genuine need
 * and also the single most dangerous field in the whole package, because "some
 * JSON" is where an unbounded provider payload, a raw transcript, a phone number,
 * or an API key will eventually be smuggled if nothing stops it.
 *
 * So nothing here is `unknown` and nothing is passed through. Every value is
 * walked, and the walk is deterministic: same input, same issues, every time. It
 * reads no clock, no environment, and no network.
 *
 * What is rejected, and why each one matters:
 *
 * | Rejected | Because |
 * | --- | --- |
 * | `undefined` | Not JSON. `JSON.stringify` silently *drops* it, so a field would vanish between two systems and neither would know |
 * | `function`, `symbol` | Not data. Their presence means someone passed a live object where a record belonged |
 * | `bigint` | Not JSON. `JSON.stringify` throws on it |
 * | `NaN`, `Infinity` | Not JSON. `JSON.stringify` turns them into `null`, silently changing the value |
 * | class instances | A `Date`, `Map`, or domain object serializes to something other than itself — often to `{}` |
 * | cyclic references | `JSON.stringify` throws, and a naive validator hangs |
 * | oversized strings, arrays, objects, nesting | An unbounded field is a denial-of-service vector and a smuggling route |
 *
 * The guarantee this buys is simple and testable: **anything that passes here can
 * be `JSON.stringify`d and parsed back to an equal value.** That is the property
 * a contract crossing a trust boundary actually needs.
 */

import { z } from 'zod';

/** A JSON scalar. Note that `undefined` is not one. */
export type JsonScalar = string | number | boolean | null;

/** Any JSON-serializable value. */
export type JsonValue = JsonScalar | JsonValue[] | JsonObject;

/**
 * A JSON object, which is what every contract field using this actually wants.
 *
 * Declared as an interface, not as `Record<string, JsonValue>`. The Record form
 * looks tidier and is quietly wrong: it is circular through `JsonValue`, so
 * TypeScript resolves it to **`any`** — which would silently disable the type
 * checker across every parameters and metadata field in the package. An interface
 * breaks the cycle and keeps the type honest.
 */
export interface JsonObject {
  [key: string]: JsonValue;
}

/** A plain JSON object at runtime — not an array, not null, not a class instance. */
export function isPlainJsonObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bounds. Chosen to be generous for real use and hostile to abuse. */
export interface JsonLimits {
  /** Maximum nesting depth. */
  readonly maxDepth: number;
  /** Maximum length of any single string. */
  readonly maxStringLength: number;
  /** Maximum number of items in any array. */
  readonly maxArrayItems: number;
  /** Maximum number of keys on any object. */
  readonly maxObjectKeys: number;
  /** Maximum length of any object key. */
  readonly maxKeyLength: number;
  /**
   * Maximum number of values visited in total.
   *
   * This bounds the *work*, not just the shape. A non-cyclic graph that shares
   * one sub-object many times is small on paper and enormous when walked, and
   * this is what stops it.
   */
  readonly maxNodes: number;
}

export const DEFAULT_JSON_LIMITS: JsonLimits = {
  maxDepth: 8,
  maxStringLength: 4096,
  maxArrayItems: 100,
  maxObjectKeys: 64,
  maxKeyLength: 128,
  maxNodes: 1000,
};

/** A single reason a value is not acceptable, with the path to the offending node. */
export interface JsonIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly message: string;
}

/**
 * Walk a value and report every reason it is not bounded JSON.
 *
 * Pure and deterministic. Reports *all* issues rather than the first, because a
 * caller fixing one field at a time is a caller making many round trips.
 *
 * The value itself is never included in an issue — only its path. An error
 * message that echoes the rejected value is an error message that logs the secret
 * you just refused to accept (docs/governance/security-principles.md §5).
 */
export function inspectJsonValue(
  value: unknown,
  limits: JsonLimits = DEFAULT_JSON_LIMITS,
): readonly JsonIssue[] {
  const issues: JsonIssue[] = [];
  const budget = { nodes: 0 };
  // Ancestors on the *current path*, not everything seen. A value referenced
  // twice side by side is a shared sub-tree and serializes fine; a value that
  // contains itself is a cycle and does not.
  const ancestors = new Set<object>();

  walk(value, [], limits, ancestors, budget, issues);
  return issues;
}

function walk(
  value: unknown,
  path: readonly (string | number)[],
  limits: JsonLimits,
  ancestors: Set<object>,
  budget: { nodes: number },
  issues: JsonIssue[],
): void {
  budget.nodes += 1;
  if (budget.nodes > limits.maxNodes) {
    push(
      issues,
      path,
      'json.too-many-nodes',
      `Exceeds the maximum of ${String(limits.maxNodes)} values`,
    );
    return;
  }

  if (path.length > limits.maxDepth) {
    push(
      issues,
      path,
      'json.max-depth-exceeded',
      `Exceeds the maximum nesting depth of ${String(limits.maxDepth)}`,
    );
    return;
  }

  if (value === null) {
    return;
  }

  switch (typeof value) {
    case 'boolean':
      return;

    case 'string':
      if (value.length > limits.maxStringLength) {
        push(
          issues,
          path,
          'json.string-too-long',
          `Exceeds the maximum string length of ${String(limits.maxStringLength)}`,
        );
      }
      return;

    case 'number':
      if (!Number.isFinite(value)) {
        push(
          issues,
          path,
          'json.non-finite-number',
          'Must be a finite number: NaN and Infinity are not JSON',
        );
      }
      return;

    case 'undefined':
      push(issues, path, 'json.undefined', 'Must not be undefined: undefined is not JSON');
      return;

    case 'bigint':
      push(issues, path, 'json.bigint', 'Must not be a bigint: bigint is not JSON');
      return;

    case 'function':
      push(issues, path, 'json.function', 'Must not be a function');
      return;

    case 'symbol':
      push(issues, path, 'json.symbol', 'Must not be a symbol');
      return;

    case 'object':
      walkObject(value, path, limits, ancestors, budget, issues);
      return;

    default:
      push(issues, path, 'json.unsupported', 'Unsupported value');
  }
}

function walkObject(
  value: object,
  path: readonly (string | number)[],
  limits: JsonLimits,
  ancestors: Set<object>,
  budget: { nodes: number },
  issues: JsonIssue[],
): void {
  if (ancestors.has(value)) {
    push(issues, path, 'json.cyclic', 'Must not contain a cyclic reference');
    return;
  }

  ancestors.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      push(issues, path, 'json.class-instance', 'Must be a plain array, not an Array subclass');
    } else {
      if (value.length > limits.maxArrayItems) {
        push(
          issues,
          path,
          'json.array-too-large',
          `Exceeds the maximum of ${String(limits.maxArrayItems)} array items`,
        );
      }
      value.forEach((item, index) => {
        walk(item, [...path, index], limits, ancestors, budget, issues);
      });
    }
    ancestors.delete(value);
    return;
  }

  // A plain object, or nothing. `new Date()`, `new Map()`, and any class instance
  // land here — and each one serializes to something other than itself, so each
  // one is a silent data-loss bug waiting to happen.
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    push(
      issues,
      path,
      'json.class-instance',
      'Must be a plain object: class instances are not JSON',
    );
    ancestors.delete(value);
    return;
  }

  if (Object.getOwnPropertySymbols(value).length > 0) {
    push(issues, path, 'json.symbol-key', 'Must not have symbol keys');
  }

  const keys = Object.keys(value);
  if (keys.length > limits.maxObjectKeys) {
    push(
      issues,
      path,
      'json.too-many-keys',
      `Exceeds the maximum of ${String(limits.maxObjectKeys)} keys`,
    );
  }

  const record: Record<string, unknown> = { ...value };
  for (const key of keys) {
    if (key.length > limits.maxKeyLength) {
      push(
        issues,
        [...path, key],
        'json.key-too-long',
        `Exceeds the maximum key length of ${String(limits.maxKeyLength)}`,
      );
    }
    walk(record[key], [...path, key], limits, ancestors, budget, issues);
  }

  ancestors.delete(value);
}

function push(
  issues: JsonIssue[],
  path: readonly (string | number)[],
  code: string,
  message: string,
): void {
  issues.push({ path: [...path], code, message });
}

/** True when the value is bounded, JSON-safe data. */
export function isBoundedJsonValue(
  value: unknown,
  limits: JsonLimits = DEFAULT_JSON_LIMITS,
): boolean {
  return inspectJsonValue(value, limits).length === 0;
}

/**
 * A schema for any bounded JSON value.
 *
 * Built on `z.custom<JsonValue>()` plus an explicit refinement rather than a
 * recursive `z.union`, because a union cannot detect a cycle (it recurses until
 * the stack dies), cannot see a class instance (a `Date` has no own enumerable
 * keys, so it validates as `{}`), and cannot bound depth or total work. The
 * inspector can do all four.
 */
export function createBoundedJsonValueSchema(limits: JsonLimits = DEFAULT_JSON_LIMITS) {
  return z.custom<JsonValue>().superRefine((value, ctx) => {
    for (const issue of inspectJsonValue(value, limits)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
    }
  });
}

/** A schema for a bounded JSON *object*, which is what contract fields actually carry. */
export function createBoundedJsonObjectSchema(limits: JsonLimits = DEFAULT_JSON_LIMITS) {
  return z.custom<JsonObject>().superRefine((value, ctx) => {
    // The static type says JsonObject, but `z.custom` accepts anything at runtime —
    // which is exactly the point, since this sits at a trust boundary. The check is
    // necessary, and it is written through a helper so the type system does not
    // mistake it for dead code.
    if (!isPlainJsonObject(value)) {
      ctx.addIssue({ code: 'custom', message: 'Must be a plain JSON object' });
      return;
    }
    for (const issue of inspectJsonValue(value, limits)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [...issue.path] });
    }
  });
}

export const boundedJsonValueSchema = createBoundedJsonValueSchema();
export const boundedJsonObjectSchema = createBoundedJsonObjectSchema();

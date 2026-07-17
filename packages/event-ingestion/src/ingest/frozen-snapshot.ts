/**
 * Deep-freeze the plain value produced by `JSON.parse`, and the deep-readonly type that reflects
 * that immutability in the TypeScript surface (ADR-0030).
 *
 * ### Only ever a `JSON.parse` result
 *
 * `prepareValidatedEventFromVerifiedRawBody` canonicalises the validated event **once**, digests
 * that canonical JSON, and re-parses the *same* canonical JSON with `JSON.parse` to obtain the
 * returned snapshot — so the snapshot and the digest describe one identical canonical
 * representation. The value handed here is therefore always a fresh `JSON.parse` output: plain
 * objects, plain arrays, and JSON primitives only — no getters, no prototypes to walk, no cycles
 * (JSON cannot express one). Freezing is a structural walk over that, nothing more.
 *
 * ### Iterative, so depth cannot exhaust the stack
 *
 * The walk is an explicit work-list rather than recursion: a hostile-but-valid event that is
 * deeply nested cannot overflow the call stack here. Freezing order does not matter — freezing a
 * parent does not prevent freezing a child, because each object is frozen in its own right.
 *
 * Pure: it reads no clock, environment, filesystem, or network, logs nothing, and returns the very
 * value it was given (now frozen at every level).
 */

/** A recursively-immutable view of a JSON value: every array and object property is `readonly`. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * Deeply freeze a plain JSON value in place and return it, typed as deeply readonly.
 *
 * The input must be a `JSON.parse` result (plain objects/arrays/primitives). The walk is iterative
 * and terminates because a `JSON.parse` result is a finite tree with no cycles.
 */
export function deepFreezeJsonValue<T>(root: T): DeepReadonly<T> {
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') {
      continue;
    }
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (const element of current as readonly unknown[]) {
        stack.push(element);
      }
    } else {
      const record = current as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        stack.push(record[key]);
      }
    }
  }
  return root as DeepReadonly<T>;
}

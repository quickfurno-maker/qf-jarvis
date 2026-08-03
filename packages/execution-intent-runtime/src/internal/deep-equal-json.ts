/**
 * Structural JSON equality (QFJ-P09.01, ADR-0084).
 *
 * INTERNAL, pure, and deliberately tiny.
 *
 * ### Why not `JSON.stringify(a) === JSON.stringify(b)`
 *
 * Because `JSON.stringify` preserves INSERTION ORDER. Two governed parameter objects carrying
 * identical facts — one built by Core's issuer, one read back off a stored recommendation — would
 * compare unequal for no reason a human could see, and this comparison decides whether an execution
 * intent is allowed to claim it reproduces an approved action. A false negative here blocks a
 * legitimate effect; the check has to be about CONTENT.
 *
 * It would also call `toJSON`, which is a hook an input could define.
 *
 * ### What "exact" means, and what it excludes
 *
 * Primitives compare with `===`. Arrays must have the same length AND the same order — an ordered
 * list is part of the value, and a reordered one is a different instruction. Objects must have the
 * same KEY SET, with key order irrelevant, compared recursively.
 *
 * There is deliberately no subset match, no superset tolerance, no default insertion, no type
 * coercion, no whitespace trimming and no case normalization. Every one of those would let an intent
 * run with parameters a human never approved, which is the substitution this whole package exists to
 * refuse. Both inputs are already governed JSON — schema-validated, and the approval evidence
 * re-proved against a recomputed action fingerprint — so there is nothing here to be lenient about.
 */

/** True when two governed JSON values are structurally identical. */
export function deepEqualJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (typeof a !== 'object') {
    // Reached only for two primitives of the same type that `===` already rejected. `NaN` cannot
    // occur in governed JSON, and would be a difference in any case.
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEqualJson(item, b[index]));
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
    leftKeys.every((key) => deepEqualJson(left[key], right[key]))
  );
}

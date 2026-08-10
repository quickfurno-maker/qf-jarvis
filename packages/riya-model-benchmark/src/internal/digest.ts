/**
 * Deterministic content identity for benchmark artifacts (RMB-A).
 *
 * ### Why not `contentDigest` from the evaluation package
 *
 * That helper is a 32-hex FNV-1a — dependency-free by design, because the generic model-evaluation
 * package imports no node module at all. This package has no such constraint, and benchmark evidence has a
 * longer life than a suite result: it gets copied between machines, quoted in a decision months
 * later, and compared against a run nobody remembers. A 32-bit-derived hash is not the right identity
 * for that, and quietly reusing it would be downgrading the guarantee to save an import.
 *
 * So this is real SHA-256 over canonical JSON, via `node:crypto` — the same choice the RID-F1
 * dataset package made, for the same reason.
 *
 * It is an INTEGRITY identity, not a signature. It proves an artifact has not drifted since it was
 * stamped. It proves nothing about who produced it, and this package never claims otherwise.
 */
import { createHash } from 'node:crypto';

/** Full SHA-256, lowercase hex. */
export const SHA256_HEX = /^[0-9a-f]{64}$/u;

/** Canonical JSON: keys sorted recursively, so equal content always serialises identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      // Undefined-valued keys are dropped rather than serialised, so an artifact built with an
      // explicit `undefined` and one built without the key at all share an identity. They are the
      // same artifact.
      if (entry !== undefined) {
        out[key] = canonicalize(entry);
      }
    }
    return out;
  }
  return value;
}

/** The canonical JSON string of a value. Exported for the specs that prove key order is irrelevant. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** SHA-256 of the canonical JSON of `value`, lowercase hex. */
export function sha256OfCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/**
 * Content identity for generation artifacts (AS2).
 *
 * The same discipline the dataset package keeps: `node:crypto` is used in exactly ONE file, for
 * exactly one thing, and a containment spec pins that. Nothing here signs, encrypts or generates
 * randomness — a digest proves that two artifacts are the same bytes, and says nothing about who
 * produced them or whether they were authorized to.
 *
 * Canonical JSON first, so key order and absent optionals cannot change a digest. Two machines that
 * disagree about an artifact's identity would make every "which configuration produced this row"
 * claim unverifiable.
 */
import { createHash } from 'node:crypto';

/** Exactly 64 lowercase hex characters. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Deterministic JSON: object keys sorted, `undefined` dropped, arrays left in order. */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry === undefined) continue;
      out[key] = canonicalize(entry);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  // The nullish guard belongs on the INPUT, not the result. `JSON.stringify` really can return
  // `undefined` -- for `undefined` itself and for a function -- but TypeScript types it as
  // `string`, so a `??` on the result is dead code the compiler can prove unreachable.
  return JSON.stringify(canonicalize(value) ?? null);
}

/** SHA-256 of a string, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** SHA-256 over the canonical JSON of a value. */
export function sha256OfCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

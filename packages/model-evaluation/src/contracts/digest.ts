/**
 * A pure, deterministic content digest (QFJ-P04.04, ADR-0052).
 *
 * Evidence and suite results carry a stable digest of their canonical content so a caller can detect
 * tampering and so the same inputs always produce the same reference. This uses a non-cryptographic
 * FNV-1a hash over a canonically-ordered JSON string — deterministic, dependency-free, and free of
 * `node:crypto` (the package imports no node module). It is an integrity/identity digest, not a
 * security primitive.
 */

/** Canonical JSON: object keys sorted recursively so equal content always serialises identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  return value;
}

/** A 32-bit FNV-1a hash of a string, returned as 8 lowercase hex chars. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A deterministic 32-hex digest of `value`. Two hashes over different halves of the canonical string
 * are concatenated to widen the space while staying pure and dependency-free.
 */
export function contentDigest(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  const a = fnv1a(canonical);
  const b = fnv1a(`${canonical}|salt`);
  const c = fnv1a(`salt2|${canonical}`);
  const d = fnv1a(`${a}${b}${c}`);
  return `${a}${b}${c}${d}`;
}

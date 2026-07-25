/**
 * Pure, deterministic digest + instant helpers (QFJ-M3, ADR-0056 §G).
 *
 * The idempotency key and any content digest are IDENTITY/INTEGRITY evidence, not authentication —
 * a non-cryptographic FNV-1a hash over canonically-ordered JSON, dependency-free and free of
 * `node:crypto`. Instants are canonical UTC ISO-8601; validation never reads the wall clock.
 */

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

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** A deterministic 32-hex digest of `value` (canonical JSON, FNV-1a). Not a security primitive. */
export function contentDigest(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  const a = fnv1a(canonical);
  const b = fnv1a(`${canonical}|salt`);
  const c = fnv1a(`salt2|${canonical}`);
  const d = fnv1a(`${a}${b}${c}`);
  return `${a}${b}${c}${d}`;
}

/** Canonical JSON string (sorted keys) for stable serialization to the transport. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/** True iff `value` is a canonical UTC ISO-8601 instant that also parses to a real calendar time. */
export function isCanonicalInstant(value: string): boolean {
  if (!CANONICAL_INSTANT.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

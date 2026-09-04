/**
 * Deterministic content identity for the values this adapter binds (AS4-PREP-A).
 *
 * ### Why a second SHA-256 here rather than a re-export
 *
 * RMB-A owns EVIDENCE identity -- the evidence digest, the manifest digest, the result-set digest --
 * and this package computes none of those. What it needs is different: it must be able to say "these
 * exact prompt bytes", "this exact sampling configuration" and "this exact runtime configuration",
 * BEFORE any evidence exists, so a suite plan authored last week and an adapter configured today can
 * be proved to be talking about the same thing.
 *
 * RMB-A does not export its digest helper, and it is right not to: exporting it would invite a caller
 * to hand-stamp an artifact. So this is a separate, deliberately small function with the same
 * algorithm and the same canonical form, used for inputs only. Nothing here stamps an artifact and
 * nothing here recomputes an RMB-A digest.
 *
 * It is an INTEGRITY identity, not a signature. It proves two values are the same value. It proves
 * nothing about who produced either.
 */
import { createHash } from 'node:crypto';

/** Canonical JSON: keys sorted recursively, undefined-valued keys dropped. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        out[key] = canonicalize(entry);
      }
    }
    return out;
  }
  return value;
}

/** SHA-256 of the canonical JSON of `value`, lowercase hex. */
export function sha256OfCanonical(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

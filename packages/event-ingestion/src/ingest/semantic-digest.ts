/**
 * The semantic event digest (ADR-0029) — `sha256(utf8(canonicalise(validatedEvent)))`.
 *
 * This is the value a later Stage 3.3 slice will compare to distinguish a **benign**
 * duplicate (same semantic content, different bytes or key order) from a **conflicting**
 * one (ADR-0020 §8). It digests the validated canonical event — envelope and payload — and
 * NOTHING else: not the signature envelope, not signature bytes, not signing keys, not
 * raw-body whitespace, and not transport metadata. It is a separate fact from the raw-body
 * digest the signature commits to.
 *
 * It is not the signing canonicalisation. Signatures verify the exact raw bytes (ADR-0027).
 *
 * Pure: `node:crypto` for SHA-256 and nothing else. No clock, no environment, no filesystem,
 * no network, no logging, no global state, and no side effect at import.
 */
import { createHash } from 'node:crypto';

import { canonicaliseToJson } from './canonical-json.js';

/** A semantic digest: the algorithm and its lowercase-hex value. Immutable. */
export interface SemanticEventDigest {
  /** Always `'sha256'`. */
  readonly algorithm: 'sha256';
  /** Exactly 64 lowercase hexadecimal characters. */
  readonly hex: string;
}

/**
 * Compute the semantic digest of an already-parsed, already-validated canonical event.
 *
 * The input must be a JSON value (the validated envelope and payload). Any value outside
 * the JSON value domain throws a `SemanticCanonicalisationError` carrying a stable code and
 * a structural path — never the value itself.
 *
 * The caller's input is never mutated, and the canonical string is never returned or logged.
 */
export function computeSemanticEventDigest(event: unknown): SemanticEventDigest {
  const canonical = canonicaliseToJson(event);
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const digest: SemanticEventDigest = { algorithm: 'sha256', hex };
  return Object.freeze(digest);
}

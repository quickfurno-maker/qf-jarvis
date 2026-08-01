/**
 * The prompt content digest (QFJ-S3-I-A, ADR-0072).
 *
 * INTERNAL. Not exported from the package root, because a caller who could compute a digest could
 * also supply one — and a supplied digest is exactly the binding this package exists to make
 * impossible to forge. `createPromptDefinition` computes it; nobody hands it in.
 *
 * SHA-256 over the UTF-8 bytes of the system template, lowercase hex. Unlike the FNV-1a identity
 * helpers elsewhere in the repository (M3 idempotency, ADR-0069 proposal ids), this one IS
 * cryptographic, and deliberately so: those digests answer "is this the same tuple?", where a
 * collision is a nuisance. This one answers "is this the exact text a human reviewed?", where a
 * collision would let unreviewed instructions execute under a reviewed identity. It is also what the
 * already-governed `promptDigestSchema` in `@qf-jarvis/contracts` requires — a lowercase 64-hex
 * SHA-256 — so a 32-hex FNV value could not satisfy the contract even if the risk were acceptable.
 *
 * `node:crypto` is a deterministic local CPU primitive: no network, no provider, no environment, no
 * randomness, no clock. The rule that keeps Node built-ins out of `@qf-jarvis/contracts` (ADR-0012)
 * is about that package performing I/O, and does not apply here.
 *
 * The template is hashed EXACTLY as supplied. No trimming, no whitespace collapsing, no line-ending
 * normalization, no Unicode normalization — a reviewer approved specific bytes, and any tidying here
 * would mean the digest attests to text nobody actually read.
 */
import { createHash } from 'node:crypto';

/** The lowercase 64-hex SHA-256 of `systemTemplate`'s UTF-8 bytes. Content only, never metadata. */
export function promptContentDigest(systemTemplate: string): string {
  return createHash('sha256').update(systemTemplate, 'utf8').digest('hex');
}

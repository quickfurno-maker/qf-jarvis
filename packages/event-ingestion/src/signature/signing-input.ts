/**
 * The exact bytes the Ed25519 signature commits to.
 *
 * ```
 * "qf-jarvis-event-v1" ‖ "\n" ‖ keyId ‖ "\n" ‖ signedAt ‖ "\n" ‖ hex(sha256(rawBody))
 * ```
 *
 * Two things about this are not negotiable (ADR-0020 §2, ADR-0027):
 *
 * 1. **The digest is the verifier's own.** The third argument is a `ComputedBodyDigest`
 *    — a nominal type whose only constructor hashes the raw bytes. The envelope's
 *    *claimed* `bodyDigest` is a plain string and **cannot be passed here**; neither can
 *    the envelope object or an `unknown`. So the digest that enters the signing input is
 *    structurally guaranteed to be `hex(sha256(rawBody))` as the verifier computed it —
 *    never a number the sender chose. The claimed digest is only ever *compared* to it.
 *
 * 2. **No JSON canonicalisation.** The signature is over the raw bytes' digest, so there
 *    is no re-serialisation step where signer and verifier could disagree.
 *
 * The prefix is domain separation: it pins the signature to the Core → Jarvis boundary.
 */
import { type ComputedBodyDigest } from './computed-body-digest.js';
import { DOMAIN_SEPARATION_PREFIX } from './limits.js';

/**
 * Construct the signing input from the key id, the `signedAt` string exactly as it
 * appeared in the envelope, and the **verifier-computed** body digest. The parameter
 * types are bounded and validated: two strings and a `ComputedBodyDigest` — never the
 * raw envelope or its untrusted claimed digest.
 */
export function buildSigningInput(
  keyId: string,
  signedAt: string,
  computedDigest: ComputedBodyDigest,
): Buffer {
  const text = `${DOMAIN_SEPARATION_PREFIX}\n${keyId}\n${signedAt}\n${computedDigest.hex}`;
  return Buffer.from(text, 'utf8');
}

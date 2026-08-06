/**
 * The exact bytes an execution-dispatch Ed25519 signature commits to.
 *
 * ```
 * "qf-execution-dispatch-v1" | "\n" | keyId | "\n" | signedAt | "\n" | hex(sha256(rawBody))
 * ```
 *
 * Three properties are not negotiable:
 *
 * 1. The digest is the VERIFIER'S OWN. The third parameter is a `DispatchBodyDigest`, a nominal
 *    type whose only constructor hashes raw bytes, so the envelope's claimed digest cannot be
 *    passed here at all. It is only ever compared to this value.
 * 2. NO JSON canonicalisation. The signature is over the digest of the exact bytes received, so
 *    there is no re-serialisation step where signer and verifier could disagree about whitespace,
 *    key order or number formatting.
 * 3. The prefix pins the signature to the Core -> n8n execution boundary. A signature produced for
 *    Core -> Jarvis event ingestion cannot verify here, even though both use Ed25519.
 */
import { EXECUTION_DISPATCH_DOMAIN_SEPARATOR } from './limits.js';

import { type DispatchBodyDigest } from './computed-body-digest.js';

/**
 * Build the signing input from the key id, the `signedAt` string exactly as it appeared in the
 * envelope, and the VERIFIER-COMPUTED body digest. The parameter types are bounded: two validated
 * strings and a `DispatchBodyDigest` -- never the raw envelope, never its claimed digest.
 */
export function buildDispatchSigningInput(
  keyId: string,
  signedAt: string,
  computedDigest: DispatchBodyDigest,
): Buffer {
  const text = `${EXECUTION_DISPATCH_DOMAIN_SEPARATOR}\n${keyId}\n${signedAt}\n${computedDigest.hex}`;
  return Buffer.from(text, 'utf8');
}

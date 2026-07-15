/**
 * A **test-only** signer: it stands in for Core, producing a valid signature envelope
 * over a raw body so the verifier has something authentic to accept and something to
 * tamper with.
 *
 * It builds the signing input with the *same* `buildSigningInput` the verifier uses,
 * so a mismatch between signer and verifier would fail a test rather than hide. Like
 * the keys it uses, this file is under `src/tests/` and never reaches `dist/`.
 */
import { sign as ed25519Sign, type KeyObject } from 'node:crypto';

import { ComputedBodyDigest } from '../../signature/computed-body-digest.js';
import { type SignatureEnvelope } from '../../signature/signature-envelope.js';
import { buildSigningInput } from '../../signature/signing-input.js';

export interface SignParams {
  readonly rawBody: Uint8Array;
  readonly keyId: string;
  readonly signedAt: string;
  readonly privateKey: KeyObject;
}

/** Produce a well-formed, correctly-signed envelope for the given body. */
export function signEnvelope(params: SignParams): SignatureEnvelope {
  const digest = ComputedBodyDigest.fromRawBody(params.rawBody);
  const signingInput = buildSigningInput(params.keyId, params.signedAt, digest);
  const signature = ed25519Sign(null, signingInput, params.privateKey);
  return {
    algorithm: 'ed25519',
    keyId: params.keyId,
    signedAt: params.signedAt,
    bodyDigest: `sha256:${digest.hex}`,
    signature: signature.toString('base64'),
  };
}

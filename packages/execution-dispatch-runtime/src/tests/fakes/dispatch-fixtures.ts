import { createHash, generateKeyPairSync, sign as ed25519Sign, type KeyObject } from 'node:crypto';

import { type ExecutionIntentV1 } from '@qf-jarvis/contracts';

import {
  ExecutionDispatchKeyRegistry,
  type ExecutionDispatchKeyRecordInput,
} from '../../keys/execution-dispatch-key-registry.js';
import {
  EXECUTION_DISPATCH_DOMAIN_SEPARATOR,
  EXECUTION_DISPATCH_KEY_PURPOSE,
} from '../../protocol/limits.js';

/**
 * TEST-ONLY fixtures: real Ed25519 keys, real signatures, real bytes.
 *
 * Nothing is stubbed. The key pairs are generated in-process, exist only for the life of the suite,
 * and would fail against any real configuration — but the cryptography they exercise is genuine,
 * because a stubbed verifier only ever proves that the stub works.
 *
 * The signer here is deliberately a SEPARATE implementation from the verifier's signing-input
 * builder in one respect: it takes a domain prefix as a parameter, so a test can mint a signature
 * under the Core → Jarvis EVENT domain and prove it does not verify at this boundary.
 */

/** The Core → Jarvis event-ingestion domain, restated here ONLY to prove it does not verify here. */
export const EVENT_INGESTION_DOMAIN_SEPARATOR = 'qf-jarvis-event-v1';

export interface TestSigner {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKeySpkiBase64: string;
}

export function createTestSigner(keyId = 'core-exec-1'): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    privateKey,
    publicKeySpkiBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

export function registryFor(
  signer: TestSigner,
  overrides: Partial<ExecutionDispatchKeyRecordInput> = {},
): ExecutionDispatchKeyRegistry {
  return ExecutionDispatchKeyRegistry.fromRecords([
    {
      keyId: signer.keyId,
      purpose: EXECUTION_DISPATCH_KEY_PURPOSE,
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2099-01-01T00:00:00.000Z',
      status: 'active',
      ...overrides,
    },
  ]);
}

/** `hex(sha256(bytes))`, as the verifier computes it. */
export function digestHex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Build a signature envelope over `rawBody`.
 *
 * `domain` defaults to the execution-dispatch prefix. Passing the event domain produces a
 * cryptographically valid signature that this boundary must still refuse.
 */
export function signEnvelope(
  signer: TestSigner,
  rawBody: Uint8Array,
  signedAt: string,
  domain: string = EXECUTION_DISPATCH_DOMAIN_SEPARATOR,
): Record<string, string> {
  const hex = digestHex(rawBody);
  const signingInput = Buffer.from(`${domain}\n${signer.keyId}\n${signedAt}\n${hex}`, 'utf8');
  return {
    algorithm: 'ed25519',
    keyId: signer.keyId,
    signedAt,
    bodyDigest: `sha256:${hex}`,
    signature: ed25519Sign(null, signingInput, signer.privateKey).toString('base64'),
  };
}

/** A valid ExecutionIntentV1, as QuickFurno Core would issue it. */
export function makeIntent(overrides: Partial<ExecutionIntentV1> = {}): ExecutionIntentV1 {
  return {
    executionIntentId: '11111111-1111-4111-8111-111111111111',
    contractVersion: 1,
    recommendationId: '22222222-2222-4222-8222-222222222222',
    approvalDecisionId: '33333333-3333-4333-8333-333333333333',
    approvedActionId: '44444444-4444-4444-8444-444444444444',
    actionType: 'send-followup-message',
    actionContractVersion: 1,
    parameters: { subjectRef: 'core-subject-ref-alpha', channel: 'whatsapp' },
    issuer: 'quickfurno-core',
    executor: 'n8n',
    issuedAt: '2026-08-04T12:00:00.000Z',
    expiresAt: '2026-08-04T12:30:00.000Z',
    idempotencyKey: 'idem-0000000000000000000001',
    deliverySemantics: 'at-most-once',
    correlationId: '66666666-6666-4666-8666-666666666666',
    ...overrides,
  };
}

/** Serialize an intent to the exact bytes that get signed. */
export function bodyOf(intent: ExecutionIntentV1): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(intent));
}

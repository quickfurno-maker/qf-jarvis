/**
 * QFJ-P09.04 — the composition seam, proved against a REAL PostgreSQL.
 *
 * ### What is actually being proved here
 *
 * Not that the verifier works: QFJ-P09.02's own suite owns that. Not that the store works:
 * QFJ-P09.03's owns that. This file proves the ONE thing neither can — that a boundary built by
 * `createDurableExecutionDispatchBoundary` is genuinely backed by the durable store.
 *
 * The decisive test destroys the first boundary and its pool entirely, builds a second boundary from
 * a NEW pool against the same database, and replays the identical dispatch. An in-memory guard would
 * report `first-seen` twice and the test would fail. That is the only assertion that can tell a
 * durable composition apart from a convincing one, and it is the reason this package exists.
 *
 * Everything else here tests the seam and stops: the claim actually reaches the same rows, refusals
 * that happen BEFORE the guard never write, and the P09.02 classification survives composition
 * rather than being flattened.
 *
 * Real database, no transport, no provider, no network beyond PostgreSQL. Nothing is sent.
 */
import { createHash, generateKeyPairSync, sign as ed25519Sign, type KeyObject } from 'node:crypto';

import {
  EXECUTION_DISPATCH_DOMAIN_SEPARATOR,
  EXECUTION_DISPATCH_KEY_PURPOSE,
  ExecutionDispatchKeyRegistry,
} from '@qf-jarvis/execution-dispatch-runtime';
import type { ExecutionIntentV1 } from '@qf-jarvis/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDurableExecutionDispatchBoundary } from '../create-durable-dispatch-boundary.js';
import {
  anIdempotencyKey,
  anIntentId,
  closeDatabasePool,
  createTestPool,
  resetAndMigrate,
  testDatabaseConfig,
  type DatabasePool,
} from './harness.js';

/**
 * A Core-side signer, reimplemented here rather than imported.
 *
 * `@qf-jarvis/execution-dispatch-runtime` keeps its fixtures under `src/tests/` and exports only
 * `.`, so they are deliberately unreachable from another package. Rebuilding the signing input from
 * the published protocol constants is the honest alternative: it also means this test would notice
 * if the composition ever started accepting something the documented protocol does not produce.
 */
interface TestSigner {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKeySpkiBase64: string;
}

function createTestSigner(keyId = 'core-exec-p0904'): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    privateKey,
    publicKeySpkiBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

function registryFor(signer: TestSigner): ExecutionDispatchKeyRegistry {
  return ExecutionDispatchKeyRegistry.fromRecords([
    {
      keyId: signer.keyId,
      purpose: EXECUTION_DISPATCH_KEY_PURPOSE,
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2099-01-01T00:00:00.000Z',
      status: 'active',
    },
  ]);
}

const digestHex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

function signEnvelope(
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

const NOW = new Date('2026-08-04T12:05:00.000Z');
const SIGNED_AT = '2026-08-04T12:05:00.000Z';

function makeIntent(overrides: Partial<ExecutionIntentV1> = {}): ExecutionIntentV1 {
  return {
    // The harness's own contract-shaped generators, so ids and keys match the governed grammar
    // rather than a local guess at it.
    executionIntentId: anIntentId(),
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
    idempotencyKey: anIdempotencyKey(),
    deliverySemantics: 'at-most-once',
    correlationId: '66666666-6666-4666-8666-666666666666',
    ...overrides,
  };
}

const bodyOf = (intent: ExecutionIntentV1): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(intent));

const signer = createTestSigner();
const registry = registryFor(signer);
const pools: DatabasePool[] = [];

function freshPool(name: string): DatabasePool {
  const pool = createTestPool(name);
  pools.push(pool);
  return pool;
}

beforeAll(async () => {
  const pool = freshPool('qfj-p0904-migrate');
  await resetAndMigrate(pool, testDatabaseConfig('qfj-p0904-migrate'));
});

afterAll(async () => {
  for (const pool of pools) {
    await closeDatabasePool(pool);
  }
});

/** Build a boundary over its own pool, so a test can throw the whole thing away. */
function boundaryOverFreshPool(name: string): {
  readonly boundary: ReturnType<typeof createDurableExecutionDispatchBoundary>;
  readonly pool: DatabasePool;
} {
  const pool = freshPool(name);
  return {
    boundary: createDurableExecutionDispatchBoundary({ pool, registry }),
    pool,
  };
}

describe('THE PROOF — replay state survives losing the composition and its pool', () => {
  it('a second boundary on a NEW pool sees the first boundary’s claim', async () => {
    const intent = makeIntent();
    const rawBody = bodyOf(intent);
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);

    // 1. First dispatch, through the first composition.
    const first = boundaryOverFreshPool('qfj-p0904-a');
    const firstResult = await first.boundary.verify({ rawBody, envelope, now: NOW });
    expect(firstResult.ok).toBe(true);
    if (firstResult.ok) {
      expect(firstResult.disposition).toBe('first-seen');
    }

    // 2. Destroy the composition AND its pool. Nothing of the first boundary survives in process.
    await closeDatabasePool(first.pool);

    // 3. A completely fresh composition over a fresh pool, same database.
    const second = boundaryOverFreshPool('qfj-p0904-b');

    // 4. The identical dispatch. An in-memory guard would say `first-seen` again and this fails.
    const secondResult = await second.boundary.verify({ rawBody, envelope, now: NOW });
    expect(secondResult.ok).toBe(true);
    if (secondResult.ok) {
      expect(secondResult.disposition).toBe('exact-replay');
    }
  });
});

describe('the composition preserves the P09.02 contract rather than flattening it', () => {
  it('the same intent id with a DIFFERENT idempotency key is refused, not re-claimed', async () => {
    const original = makeIntent();
    const rawBody = bodyOf(original);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-c');
    const claimed = await boundary.verify({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
    });
    expect(claimed.ok).toBe(true);

    // Same execution intent id, different idempotency key: the two uniqueness constraints are
    // independent, and a conflict must never resolve to first-seen.
    const mutated = makeIntent({
      executionIntentId: original.executionIntentId,
      idempotencyKey: anIdempotencyKey(),
    });
    const mutatedBody = bodyOf(mutated);
    const conflict = await boundary.verify({
      rawBody: mutatedBody,
      envelope: signEnvelope(signer, mutatedBody, SIGNED_AT),
      now: NOW,
    });
    expect(conflict.ok).toBe(false);
  });

  it('a reused idempotency key under a DIFFERENT intent is refused', async () => {
    const original = makeIntent();
    const rawBody = bodyOf(original);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-d');
    expect(
      (
        await boundary.verify({
          rawBody,
          envelope: signEnvelope(signer, rawBody, SIGNED_AT),
          now: NOW,
        })
      ).ok,
    ).toBe(true);

    const reused = makeIntent({ idempotencyKey: original.idempotencyKey });
    const reusedBody = bodyOf(reused);
    const conflict = await boundary.verify({
      rawBody: reusedBody,
      envelope: signEnvelope(signer, reusedBody, SIGNED_AT),
      now: NOW,
    });
    expect(conflict.ok).toBe(false);
  });

  it('the same id and key with a MUTATED body is refused, never exact-replay', async () => {
    const original = makeIntent();
    const rawBody = bodyOf(original);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-e');
    expect(
      (
        await boundary.verify({
          rawBody,
          envelope: signEnvelope(signer, rawBody, SIGNED_AT),
          now: NOW,
        })
      ).ok,
    ).toBe(true);

    // Same identity, different bytes: the verifier-computed digest is part of the claim, so this is
    // a conflict rather than a replay of the original.
    const mutated = makeIntent({
      executionIntentId: original.executionIntentId,
      idempotencyKey: original.idempotencyKey,
      correlationId: '77777777-7777-4777-8777-777777777777',
    });
    const mutatedBody = bodyOf(mutated);
    const conflict = await boundary.verify({
      rawBody: mutatedBody,
      envelope: signEnvelope(signer, mutatedBody, SIGNED_AT),
      now: NOW,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.reason).not.toBe('');
    }
  });
});

describe('refusals that happen BEFORE the guard write nothing', () => {
  it('a forged signature is refused and does not consume the identity', async () => {
    const intent = makeIntent();
    const rawBody = bodyOf(intent);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-f');

    // Cryptographically valid, but minted under the Core -> Jarvis EVENT domain. P09.02 refuses it
    // before the replay guard is reached.
    const wrongDomain = signEnvelope(signer, rawBody, SIGNED_AT, 'qf-jarvis-event-v1');
    const refused = await boundary.verify({ rawBody, envelope: wrongDomain, now: NOW });
    expect(refused.ok).toBe(false);

    // The identity must still be claimable: a refused dispatch that had consumed it would make a
    // forged message able to permanently block a legitimate one.
    const honest = await boundary.verify({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
    });
    expect(honest.ok).toBe(true);
    if (honest.ok) {
      expect(honest.disposition).toBe('first-seen');
    }
  });

  it('an EXPIRED intent is refused and does not consume the identity', async () => {
    const intent = makeIntent({
      issuedAt: '2026-08-04T10:00:00.000Z',
      expiresAt: '2026-08-04T10:30:00.000Z',
    });
    const rawBody = bodyOf(intent);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-g');
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);

    const expired = await boundary.verify({ rawBody, envelope, now: NOW });
    expect(expired.ok).toBe(false);

    // Same identity, still claimable once the intent is within its window.
    const inWindow = makeIntent({
      executionIntentId: intent.executionIntentId,
      idempotencyKey: intent.idempotencyKey,
    });
    const inWindowBody = bodyOf(inWindow);
    const accepted = await boundary.verify({
      rawBody: inWindowBody,
      envelope: signEnvelope(signer, inWindowBody, SIGNED_AT),
      now: NOW,
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.disposition).toBe('first-seen');
    }
  });

  it('a malformed envelope is refused without throwing', async () => {
    const intent = makeIntent();
    const rawBody = bodyOf(intent);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-h');
    for (const envelope of [undefined, null, {}, 'signature', { algorithm: 'ed25519' }]) {
      const result = await boundary.verify({ rawBody, envelope, now: NOW });
      expect(result.ok).toBe(false);
    }
  });
});

describe('the composition adopts no transport and grants no authority', () => {
  it('exposes exactly one method, and it returns an observation', async () => {
    const { boundary } = boundaryOverFreshPool('qfj-p0904-i');
    expect(Object.keys(boundary)).toStrictEqual(['verify']);
    expect(Object.isFrozen(boundary)).toBe(true);

    const intent = makeIntent();
    const rawBody = bodyOf(intent);
    const result = await boundary.verify({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    // No field here may be mistaken for permission to act.
    for (const forbidden of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'executed',
      'sent',
      'delivered',
      'consentValid',
      'retryAllowed',
    ]) {
      expect(result, forbidden).not.toHaveProperty(forbidden);
    }
  });

  it('is TRANSPARENT — it adds no field of its own to the P09.02 observation', async () => {
    // The composition returns P09.02's result verbatim, and that result deliberately carries the
    // parsed intent so a caller can see WHAT was approved without going back to the source. That is
    // the boundary's own documented contract, and `executionParametersSchema` already governs the
    // parameters to exclude credentials, contacts and retry permission -- so the honest assertion is
    // not "strip the intent" but "add nothing, and leak no SECRET".
    //
    // An earlier revision of this test asserted the parameters were absent. That was wrong about
    // P09.02's contract, and stripping them would have been exactly the re-classification this
    // package refuses to do.
    const intent = makeIntent();
    const rawBody = bodyOf(intent);
    const { boundary } = boundaryOverFreshPool('qfj-p0904-j');
    const result = await boundary.verify({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.disposition !== 'first-seen') {
      throw new Error('a fresh dispatch must be first-seen');
    }
    // Exactly the boundary's own observation shape. A composition that had added a field would be
    // inventing a contract nobody reviewed.
    //
    // `intent` appears here and NOT on an exact-replay observation: ADR-0090 s8 removed it from the
    // replay result deliberately, so a replay carries nothing to act on twice. Narrowing on the
    // disposition rather than casting is what makes that distinction visible in the test.
    expect(Object.keys(result).sort()).toStrictEqual([
      'bodyDigestHex',
      'disposition',
      'intent',
      'keyId',
      'kind',
      'ok',
      'signedAtIso',
    ]);
    // The intent is returned VERBATIM -- neither enriched nor quietly narrowed.
    expect(result.intent).toStrictEqual(intent);

    // No secret and no transport detail may ride out. The key IDENTIFIER is expected and fine; the
    // key MATERIAL is not, and there is no URL, endpoint or credential anywhere in the result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(signer.publicKeySpkiBase64);
    for (const forbidden of ['http://', 'https://', 'webhook', 'password', 'postgresql://']) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });
});

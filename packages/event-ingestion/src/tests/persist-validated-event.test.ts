/**
 * The secure bridge from a verified, prepared event to a persistence-ready record (Stage 3.3
 * slice 3). These are unit tests: they build records and assert the field mapping and the binding
 * guard. The atomic DATABASE behaviour (idempotency, conflict, concurrency) is proven against a
 * real PostgreSQL in `@qf-jarvis/event-backbone`'s integration tests — this package holds no pool.
 *
 * `buildEventPersistenceRecord` and `persistPreparedEvent` are imported from the INTERNAL module:
 * they are not part of the package-root surface (`public-api.test.ts`).
 */
import { describe, expect, it, vi } from 'vitest';

// The store primitive is mocked so `persistPreparedEvent` can be tested without a database.
// `buildEventPersistenceRecord` uses no runtime import from this package, so it is unaffected.
//
// D2a (ADR-0138): the bridge no longer reaches the package root for its write. It calls
// `storeAuthenticatedEvent` on the governed `internal/event-write` subpath, so that is what is
// mocked here. `AuthenticatedEventWrite` is deliberately NOT mocked — the real class is what makes
// the wrapper resistant to structural substitution, and this test asserts the bridge mints a
// genuine one rather than passing a look-alike.
// Only the pool TYPE is needed from the root now; the write moved to the governed subpath (D2a).
import type * as EventBackbone from '@qf-jarvis/event-backbone';
import * as EventWrite from '@qf-jarvis/event-backbone/internal/event-write';

vi.mock('@qf-jarvis/event-backbone/internal/event-write', async (importOriginal) => {
  const actual = await importOriginal<typeof EventWrite>();
  return { ...actual, storeAuthenticatedEvent: vi.fn() };
});

import { verifySignature } from '../index.js';
import {
  verifySignatureWithEvidence,
  type VerifiedSignatureEvidence,
} from '../signature/verify.js';
import {
  prepareValidatedEventFromVerifiedRawBody,
  type PreparedValidatedEvent,
} from '../ingest/prepare-validated-event.js';
import {
  buildEventPersistenceRecord,
  EvidencePreparationMismatchError,
  persistPreparedEvent,
} from '../ingest/persist-validated-event.js';
import { signEnvelope } from './fixtures/signer.js';
import { testPrivateKey } from './fixtures/test-keys.js';
import { testRegistry, TEST_KEY_ID } from './fixtures/registry.js';
import { VALID_CANONICAL_EVENT } from './fixtures/canonical-event.js';

const MISPAIRED_EVENT_ID = '0f1e2d3c-4b5a-4c9d-8e7f-a1b2c3d4e5f6';
const SIGNED_AT = '2026-07-11T09:00:05.000Z';
const NOW = new Date('2026-07-11T09:00:10.000Z');
const registry = testRegistry();

interface Verified {
  readonly prepared: PreparedValidatedEvent;
  readonly evidence: VerifiedSignatureEvidence;
  readonly bytes: Uint8Array;
}

/** Sign, verify (evidence + public), and prepare one body — the real Stage 3.2 → 3.3 path. */
function verifiedFor(value: unknown): Verified {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const envelope = signEnvelope({
    rawBody: bytes,
    keyId: TEST_KEY_ID,
    signedAt: SIGNED_AT,
    privateKey: testPrivateKey,
  });

  const evidenceResult = verifySignatureWithEvidence(bytes, envelope, NOW, registry);
  if (!evidenceResult.ok) throw new Error(`evidence verification failed: ${evidenceResult.reason}`);

  const verification = verifySignature(bytes, envelope, NOW, registry);
  if (!verification.ok) throw new Error(`verification failed: ${verification.reason}`);

  const prepared = prepareValidatedEventFromVerifiedRawBody({
    verification,
    verifiedRawBody: bytes,
  });
  if (!prepared.ok) throw new Error(`preparation failed: ${prepared.reason}`);

  return { prepared, evidence: evidenceResult.evidence, bytes };
}

describe('buildEventPersistenceRecord — every field maps correctly', () => {
  it('maps the envelope, digests, and signature evidence to the record', () => {
    const { prepared, evidence } = verifiedFor(VALID_CANONICAL_EVENT);
    const record = buildEventPersistenceRecord(prepared, evidence);

    expect(record.eventId).toBe(VALID_CANONICAL_EVENT.eventId);
    expect(record.eventType).toBe('qf.recommendation.created');
    expect(record.eventVersion).toBe(2);
    expect(record.source).toBe('quickfurno-core');
    expect(record.subjectType).toBe('client');
    expect(record.subjectId).toBe('CORE-CLIENT-00311');
    expect(record.occurredAt).toBe(VALID_CANONICAL_EVENT.occurredAt);
    expect(record.emittedAt).toBe(VALID_CANONICAL_EVENT.emittedAt);
    expect(record.correlationId).toBe(VALID_CANONICAL_EVENT.correlationId);
    expect(record.causationEventId).toBeNull();
    expect(record.payload).toStrictEqual(VALID_CANONICAL_EVENT.payload);

    // Digests are 32 raw bytes derived deterministically from the hex.
    expect(record.semanticEventDigest).toHaveLength(32);
    expect(record.semanticEventDigest.toString('hex')).toBe(prepared.semanticEventDigest.hex);
    expect(record.bodyDigest).toHaveLength(32);
    expect(record.bodyDigest.toString('hex')).toBe(prepared.bodyDigestHex);

    // Signature evidence — decoded fresh from the immutable Base64 the verifier produced.
    expect(record.signatureAlgorithm).toBe('ed25519');
    expect(record.signatureKeyId).toBe(TEST_KEY_ID);
    expect(record.signatureSignedAt).toBe(SIGNED_AT);
    expect(record.signature).toHaveLength(64);
    expect(record.signature.equals(Buffer.from(evidence.signatureBase64, 'base64'))).toBe(true);
  });

  it('carries the causation id when present', () => {
    const withCausation = {
      ...VALID_CANONICAL_EVENT,
      causationEventId: '5a7c2f3b-1d4e-4f60-9bac-2d3e4f5a6b7c',
    };
    const { prepared, evidence } = verifiedFor(withCausation);
    const record = buildEventPersistenceRecord(prepared, evidence);
    expect(record.causationEventId).toBe('5a7c2f3b-1d4e-4f60-9bac-2d3e4f5a6b7c');
  });

  it('returns a frozen record whose signature is a fresh, independent buffer', () => {
    const { prepared, evidence } = verifiedFor(VALID_CANONICAL_EVENT);
    const record = buildEventPersistenceRecord(prepared, evidence);
    expect(Object.isFrozen(record)).toBe(true);

    // Each build decodes a fresh buffer from the immutable evidence string, so corrupting one
    // record's signature cannot affect another build or the evidence.
    const second = buildEventPersistenceRecord(prepared, evidence);
    expect(second.signature).not.toBe(record.signature);
    record.signature.fill(0);
    expect(second.signature.equals(Buffer.from(evidence.signatureBase64, 'base64'))).toBe(true);
  });

  it('a caller cannot alter the signature that will be persisted after verification', () => {
    // The adversarial case FIX 1 exists for: a caller holds the evidence between verification and
    // persistence and tries to substitute forged signature bytes. Because the evidence is a frozen
    // object of immutable strings, there is no mutable buffer to overwrite and the assignment
    // itself throws — what gets persisted is exactly what was verified.
    const { prepared, evidence } = verifiedFor(VALID_CANONICAL_EVENT);
    const genuine = buildEventPersistenceRecord(prepared, evidence).signature;

    const forgedBase64 = Buffer.alloc(64, 0xff).toString('base64');
    expect(() => {
      (evidence as unknown as { signatureBase64: string }).signatureBase64 = forgedBase64;
    }).toThrow(TypeError);

    const persisted = buildEventPersistenceRecord(prepared, evidence).signature;
    expect(persisted.equals(genuine)).toBe(true);
    expect(persisted.equals(Buffer.alloc(64, 0xff))).toBe(false);
  });
});

describe('buildEventPersistenceRecord — the evidence must match the prepared event', () => {
  it('throws when evidence and prepared event describe different bodies', () => {
    const { prepared } = verifiedFor(VALID_CANONICAL_EVENT);
    const { evidence: otherEvidence } = verifiedFor({
      ...VALID_CANONICAL_EVENT,
      // A valid but DIFFERENT eventId: the second body still validates, but its bytes — and so its
      // body digest — differ, so its evidence must not bind to the first prepared event.
      eventId: '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d',
    });
    expect(() => buildEventPersistenceRecord(prepared, otherEvidence)).toThrow(
      EvidencePreparationMismatchError,
    );
  });
});

describe('persistPreparedEvent — delegates the built record to the governed store', () => {
  it('builds the record, mints the D2a capability, and returns the store outcome', async () => {
    const { prepared, evidence } = verifiedFor(VALID_CANONICAL_EVENT);
    const mocked = vi.mocked(EventWrite.storeAuthenticatedEvent);
    mocked.mockReset();
    const acceptedAt = new Date('2026-07-11T09:00:11.000Z');
    mocked.mockResolvedValue({ outcome: 'stored', sequence: '7', acceptedAt });

    const pool = {} as unknown as EventBackbone.DatabasePool;
    const outcome = await persistPreparedEvent(pool, prepared, evidence);

    expect(mocked).toHaveBeenCalledTimes(1);
    expect(outcome).toStrictEqual({ outcome: 'stored', sequence: '7', acceptedAt });

    // The second argument is a REAL AuthenticatedEventWrite — not a record, and not a
    // structural look-alike. This is the D2a control-flow guarantee at the call site: the
    // bridge cannot reach persistence without minting the capability first.
    const [passedPool, passedWrite] = mocked.mock.calls[0] ?? [];
    expect(passedPool).toBe(pool);
    expect(passedWrite).toBeInstanceOf(EventWrite.AuthenticatedEventWrite);
    // And it wraps exactly the record the bridge built from the bound evidence.
    expect(passedWrite?.record).toStrictEqual(buildEventPersistenceRecord(prepared, evidence));
  });

  it('never mints a capability when the evidence and prepared event are mispaired', async () => {
    const a = verifiedFor(VALID_CANONICAL_EVENT);
    const b = verifiedFor({ ...VALID_CANONICAL_EVENT, eventId: MISPAIRED_EVENT_ID });
    const mocked = vi.mocked(EventWrite.storeAuthenticatedEvent);
    mocked.mockReset();

    const pool = {} as unknown as EventBackbone.DatabasePool;
    await expect(persistPreparedEvent(pool, a.prepared, b.evidence)).rejects.toBeInstanceOf(
      EvidencePreparationMismatchError,
    );

    // Fail closed: the binding guard throws while building the record, so no capability is ever
    // minted and the store is never reached.
    expect(mocked).not.toHaveBeenCalled();
  });
});

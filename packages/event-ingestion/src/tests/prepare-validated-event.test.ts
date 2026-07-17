/**
 * Stage 3.3 slice 2 — validated event preparation (ADR-0030), tested through the real
 * Stage 3.2 → 3.3 composition.
 *
 * Every case starts from an **authentic** body: it is signed by the test signer and verified by
 * the real `verifySignature`, so `prepareValidatedEventFromVerifiedRawBody` only ever receives a
 * genuine `SignatureVerificationSuccess` — the caller precondition it documents. The function, its
 * result and rejection types are imported from the INTERNAL module on purpose: like the digest
 * foundation, preparation is not part of the package-root surface (`public-api.test.ts`).
 */
import { describe, expect, it } from 'vitest';

import { safeParseCanonicalEvent } from '@qf-jarvis/contracts';

import { verifySignature, type SignatureVerificationSuccess } from '../index.js';
import { canonicaliseToJson } from '../ingest/canonical-json.js';
import { computeSemanticEventDigest } from '../ingest/semantic-digest.js';
import {
  prepareValidatedEventFromVerifiedRawBody,
  ValidatedEventPreparationError,
  type ValidatedEventPreparation,
} from '../ingest/prepare-validated-event.js';
import { SAFE_VALIDATION_MESSAGES } from '../ingest/rejection.js';
import { signEnvelope } from './fixtures/signer.js';
import { testPrivateKey } from './fixtures/test-keys.js';
import { testRegistry, TEST_KEY_ID } from './fixtures/registry.js';
import { VALID_CANONICAL_EVENT } from './fixtures/canonical-event.js';

const SIGNED_AT = '2026-07-11T09:00:05.000Z';
const NOW = new Date('2026-07-11T09:00:10.000Z');
const registry = testRegistry();
const SAFE_MESSAGES = new Set<string>(Object.values(SAFE_VALIDATION_MESSAGES));

/** Sign and verify raw bytes, returning the authentic Stage 3.2 success (or failing loudly). */
function verify(bytes: Uint8Array): SignatureVerificationSuccess {
  const envelope = signEnvelope({
    rawBody: bytes,
    keyId: TEST_KEY_ID,
    signedAt: SIGNED_AT,
    privateKey: testPrivateKey,
  });
  const result = verifySignature(bytes, envelope, NOW, registry);
  if (!result.ok) {
    throw new Error(`test fixture failed Stage 3.2 verification: ${result.reason}`);
  }
  return result;
}

/** Prepare an authentic body end-to-end (sign → verify → prepare). */
function prepareBytes(bytes: Uint8Array): ValidatedEventPreparation {
  return prepareValidatedEventFromVerifiedRawBody({
    verification: verify(bytes),
    verifiedRawBody: bytes,
  });
}

/** Prepare an authentic body from a JSON value. */
function prepareValue(value: unknown): ValidatedEventPreparation {
  return prepareBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/** A shallow copy of the valid event without one key. */
function without(key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(VALID_CANONICAL_EVENT).filter(([k]) => k !== key));
}

const HEX_64 = /^[0-9a-f]{64}$/;

describe('prepareValidatedEventFromVerifiedRawBody — fixture is genuinely valid', () => {
  it('the shared valid event parses against the authoritative contract', () => {
    expect(safeParseCanonicalEvent(VALID_CANONICAL_EVENT).success).toBe(true);
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — success', () => {
  it('returns ok with the validated event, its digest, and carried Stage 3.2 metadata', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(VALID_CANONICAL_EVENT));
    const verification = verify(bytes);
    const result = prepareValidatedEventFromVerifiedRawBody({
      verification,
      verifiedRawBody: bytes,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.canonicalEvent.eventType).toBe('qf.recommendation.created');
    expect(result.canonicalEvent.eventVersion).toBe(2);
    expect(result.semanticEventDigest.algorithm).toBe('sha256');
    expect(result.semanticEventDigest.hex).toMatch(HEX_64);
    expect(result.keyId).toBe(TEST_KEY_ID);
    expect(result.bodyDigestHex).toBe(verification.bodyDigestHex);
    expect(result.signedAt).toBe(SIGNED_AT);
  });

  it('the result carries exactly the intended fields — no raw body, no signature', () => {
    const result = prepareValue(VALID_CANONICAL_EVENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result).sort()).toEqual(
      ['bodyDigestHex', 'canonicalEvent', 'keyId', 'ok', 'semanticEventDigest', 'signedAt'].sort(),
    );
    const serialized = JSON.stringify(result);
    // No raw-body or signature material appears anywhere in the result.
    expect(serialized).not.toContain('"rawBody"');
    expect(serialized).not.toContain('"signature"');
  });

  it('does not expose the canonical JSON string as a result field', () => {
    const result = prepareValue(VALID_CANONICAL_EVENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const canonical = canonicaliseToJson(result.canonicalEvent);
    expect('canonicalJson' in result).toBe(false);
    expect(Object.values(result).some((value) => value === canonical)).toBe(false);
  });

  it('binds the digest to the returned snapshot, and matches an independent digest', () => {
    const result = prepareValue(VALID_CANONICAL_EVENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(computeSemanticEventDigest(result.canonicalEvent).hex).toBe(
      result.semanticEventDigest.hex,
    );
    expect(result.semanticEventDigest.hex).toBe(
      computeSemanticEventDigest(VALID_CANONICAL_EVENT).hex,
    );
  });

  it('is insensitive to key order and whitespace in the raw body (semantic, not byte, identity)', () => {
    const reordered = {
      payload: VALID_CANONICAL_EVENT.payload,
      correlationId: VALID_CANONICAL_EVENT.correlationId,
      subject: VALID_CANONICAL_EVENT.subject,
      source: VALID_CANONICAL_EVENT.source,
      emittedAt: VALID_CANONICAL_EVENT.emittedAt,
      occurredAt: VALID_CANONICAL_EVENT.occurredAt,
      eventVersion: VALID_CANONICAL_EVENT.eventVersion,
      eventType: VALID_CANONICAL_EVENT.eventType,
      eventId: VALID_CANONICAL_EVENT.eventId,
    };
    const compact = prepareValue(VALID_CANONICAL_EVENT);
    const spaced = prepareBytes(new TextEncoder().encode(JSON.stringify(reordered, null, 2)));
    expect(compact.ok && spaced.ok).toBe(true);
    if (!compact.ok || !spaced.ok) return;
    expect(spaced.semanticEventDigest.hex).toBe(compact.semanticEventDigest.hex);
  });

  it('returns a pristine, deeply frozen snapshot and a frozen result', () => {
    const result = prepareValue(VALID_CANONICAL_EVENT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    const event = result.canonicalEvent;
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.subject)).toBe(true);
    expect(Object.isFrozen(event.payload)).toBe(true);
    const recommendation = (event.payload as { recommendation: Record<string, unknown> })
      .recommendation;
    expect(Object.isFrozen(recommendation)).toBe(true);
    expect(Object.isFrozen(recommendation['evidence'])).toBe(true);
  });

  it('does not mutate the caller-supplied raw body', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(VALID_CANONICAL_EVENT));
    const before = Uint8Array.from(bytes);
    prepareValidatedEventFromVerifiedRawBody({
      verification: verify(bytes),
      verifiedRawBody: bytes,
    });
    expect(bytes).toEqual(before);
  });

  it('computes without reading the clock (Date.now replaced with a throwing stub)', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(VALID_CANONICAL_EVENT));
    const verification = verify(bytes);
    const originalNow = Date.now;
    Date.now = (): number => {
      throw new Error('validated event preparation must not read the clock');
    };
    try {
      const result = prepareValidatedEventFromVerifiedRawBody({
        verification,
        verifiedRawBody: bytes,
      });
      expect(result.ok).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — canonical representation and immutability', () => {
  it('returns a canonical +0 for a -0 accepted by the contract, and the digest matches', () => {
    // JSON.parse('-0') yields -0; the contract accepts it; canonicalisation renders it as 0.
    const text = JSON.stringify(VALID_CANONICAL_EVENT).replace('"daysSilent":4', '"daysSilent":-0');
    expect(text).toContain('"daysSilent":-0');
    const result = prepareBytes(new TextEncoder().encode(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const canonical = canonicaliseToJson(result.canonicalEvent);
    expect(canonical).toContain('"daysSilent":0');
    expect(canonical).not.toContain('"daysSilent":-0');
    // The reported digest is over exactly this canonical representation.
    expect(computeSemanticEventDigest(result.canonicalEvent).hex).toBe(
      result.semanticEventDigest.hex,
    );
  });

  it('signedAt is an immutable string — mutating the original verification Date cannot change it', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(VALID_CANONICAL_EVENT));
    const verification = verify(bytes);
    const result = prepareValidatedEventFromVerifiedRawBody({
      verification,
      verifiedRawBody: bytes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const captured = result.signedAt;
    // Mutate the original Date after preparation; the captured string must be unaffected.
    verification.signedAt.setFullYear(1999);
    expect(result.signedAt).toBe(captured);
    expect(result.signedAt).toBe(SIGNED_AT);
    expect(typeof result.signedAt).toBe('string');
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — the precondition guard', () => {
  it('throws when verifiedRawBody is not the body the verification was computed over', () => {
    const bodyA = new TextEncoder().encode(JSON.stringify(VALID_CANONICAL_EVENT));
    const bodyB = new TextEncoder().encode(
      JSON.stringify({ ...VALID_CANONICAL_EVENT, eventId: 'x' }),
    );
    const verificationOfA = verify(bodyA);
    expect(() =>
      prepareValidatedEventFromVerifiedRawBody({
        verification: verificationOfA,
        verifiedRawBody: bodyB,
      }),
    ).toThrow(ValidatedEventPreparationError);
  });

  it('the thrown error leaks no body bytes or digest', () => {
    const bodyA = new TextEncoder().encode('the-authentic-secret-body-AAAA');
    const bodyB = new TextEncoder().encode('a-different-body-BBBB');
    const verificationOfA = verify(bodyA);
    let threw = false;
    try {
      prepareValidatedEventFromVerifiedRawBody({
        verification: verificationOfA,
        verifiedRawBody: bodyB,
      });
    } catch (error: unknown) {
      threw = true;
      expect(error).toBeInstanceOf(ValidatedEventPreparationError);
      const message = (error as ValidatedEventPreparationError).message;
      expect(message).not.toContain('BBBB');
      expect(message).not.toContain(verificationOfA.bodyDigestHex);
    }
    expect(threw).toBe(true);
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — malformed authentic bodies', () => {
  it('non-UTF-8 bytes → contract-validation-failed / malformed-body', () => {
    const result = prepareBytes(Uint8Array.from([0xff, 0xfe, 0xfd]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
    expect(result.issues[0]?.code).toBe('malformed-body');
    expect(result.issues[0]?.message).toBe(SAFE_VALIDATION_MESSAGES['malformed-body']);
  });

  it('a leading UTF-8 BOM → contract-validation-failed / malformed-body', () => {
    const bytes = new TextEncoder().encode('﻿' + JSON.stringify(VALID_CANONICAL_EVENT));
    const result = prepareBytes(bytes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
    expect(result.issues[0]?.code).toBe('malformed-body');
  });

  it('non-JSON text → contract-validation-failed, and the parser message does not escape', () => {
    const result = prepareBytes(new TextEncoder().encode('not json {'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
    expect(result.issues[0]?.code).toBe('malformed-body');
    expect(result.issues[0]?.message).toBe(SAFE_VALIDATION_MESSAGES['malformed-body']);
    // The native parser's own error phrasing must not leak (our fixed message may say "JSON").
    const serialized = JSON.stringify(result);
    for (const fragment of ['Unexpected', 'position', 'token ']) {
      expect(serialized).not.toContain(fragment);
    }
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — type/version precedence (independent, ordered)', () => {
  it('missing eventType → contract-validation-failed', () => {
    const result = prepareValue(without('eventType'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
  });

  it('wrong-type eventType → contract-validation-failed', () => {
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, eventType: 123 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
  });

  it('non-object root → contract-validation-failed', () => {
    const result = prepareBytes(new TextEncoder().encode('42'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
  });

  it('unknown string eventType with a MISSING version → unknown-event-type (type decided first)', () => {
    const value = without('eventVersion');
    value['eventType'] = 'qf.not.a.real.type';
    const result = prepareValue(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-event-type');
  });

  it('unknown string eventType with a WRONG-TYPE version → unknown-event-type (type decided first)', () => {
    const result = prepareValue({
      ...VALID_CANONICAL_EVENT,
      eventType: 'qf.not.a.real.type',
      eventVersion: '2',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-event-type');
  });

  it('eventType matching is case-sensitive (no case folding)', () => {
    const result = prepareValue({
      ...VALID_CANONICAL_EVENT,
      eventType: 'QF.Recommendation.Created',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-event-type');
  });

  it('known type with a MISSING version → contract-validation-failed', () => {
    const result = prepareValue(without('eventVersion'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
  });

  it('known type with a WRONG-TYPE version → contract-validation-failed (version never coerced)', () => {
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, eventVersion: '2' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
  });

  it('known type with an unsupported future version → unknown-event-version (no latest fallback)', () => {
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, eventVersion: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-event-version');
  });

  it('known type with a retired version (v1) → unknown-event-version', () => {
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, eventVersion: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-event-version');
  });

  it('registered type@version with an invalid payload → contract-validation-failed with issues', () => {
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, payload: { recommendation: {} } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(SAFE_MESSAGES.has(issue.message)).toBe(true);
    }
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — rejections never leak sender-controlled data', () => {
  it('an unknown eventType containing an email/token never appears in the rejection', () => {
    const hostileType = 'attacker@evil.com-token-9f8e7d';
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, eventType: hostileType });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-event-type');
    const serialized = JSON.stringify(result);
    for (const fragment of [hostileType, 'attacker@evil.com', 'token-9f8e7d', '@']) {
      expect(serialized).not.toContain(fragment);
    }
  });

  it('an unknown strict-object key containing an email/token never appears in the rejection', () => {
    const hostileKey = 'leak-secret@evil.com-abcdef';
    const value: Record<string, unknown> = { ...VALID_CANONICAL_EVENT };
    value[hostileKey] = 'x';
    const result = prepareValue(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
    const serialized = JSON.stringify(result);
    for (const fragment of [hostileKey, 'leak-secret@evil.com', 'abcdef', '@']) {
      expect(serialized).not.toContain(fragment);
    }
    for (const issue of result.issues) {
      expect(issue.path).not.toContain(hostileKey);
      expect(issue.message).not.toContain(hostileKey);
    }
  });

  it('an unknown nested payload key containing an email/token never appears in the rejection', () => {
    const hostileKey = 'nested-secret@evil.com';
    const recommendation: Record<string, unknown> = {
      ...VALID_CANONICAL_EVENT.payload.recommendation,
    };
    recommendation[hostileKey] = 'y';
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, payload: { recommendation } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('contract-validation-failed');
    expect(JSON.stringify(result)).not.toContain(hostileKey);
  });

  it('rejection object, issue array, and every issue are frozen', () => {
    const result = prepareBytes(new TextEncoder().encode('not json {'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.issues)).toBe(true);
    for (const issue of result.issues) {
      expect(Object.isFrozen(issue)).toBe(true);
    }
  });

  it('validator-native messages do not escape into a contract-validation rejection', () => {
    const result = prepareValue({ ...VALID_CANONICAL_EVENT, payload: { recommendation: {} } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result);
    // Common Zod phrasings must not appear; only fixed repository-owned messages are used.
    for (const fragment of ['Invalid input', 'Expected', 'Required', 'Unrecognized', 'received']) {
      expect(serialized).not.toContain(fragment);
    }
  });
});

describe('prepareValidatedEventFromVerifiedRawBody — duplicate JSON keys (documented, not detected)', () => {
  it('JSON.parse resolves duplicate keys last-wins — recorded here, not claimed as detection', () => {
    const parsed = JSON.parse('{"a":1,"a":2}') as { a: number };
    expect(parsed.a).toBe(2);
  });

  it('preparation does not detect duplicate keys; a duplicate discriminant resolves last-wins', () => {
    // Inject an earlier eventVersion:1 (retired). JSON.parse keeps the LAST eventVersion (2),
    // so preparation validates the v2 contract and succeeds. This RECORDS last-wins behavior;
    // it is NOT duplicate-key detection. If first-wins applied, this would reject as v1.
    const body = JSON.stringify(VALID_CANONICAL_EVENT).replace('{', '{"eventVersion":1,');
    const result = prepareBytes(new TextEncoder().encode(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canonicalEvent.eventVersion).toBe(2);
  });
});

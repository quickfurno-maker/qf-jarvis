import { describe, expect, it } from 'vitest';

import { ExecutionDispatchKeyRegistry } from '../keys/execution-dispatch-key-registry.js';
import {
  ExecutionDispatchConfigError,
  ExecutionDispatchKeyRegistryError,
} from '../protocol/errors.js';
import {
  EXECUTION_DISPATCH_DOMAIN_SEPARATOR,
  EXECUTION_DISPATCH_KEY_PURPOSE,
  MAX_RAW_BODY_BYTES,
} from '../protocol/limits.js';
import { verifyExecutionDispatch } from '../verify-execution-dispatch.js';

import {
  EVENT_INGESTION_DOMAIN_SEPARATOR,
  bodyOf,
  createTestSigner,
  digestHex,
  makeIntent,
  registryFor,
  signEnvelope,
} from './fakes/dispatch-fixtures.js';
import {
  InMemoryReplayGuard,
  NonsenseReplayGuard,
  UnavailableReplayGuard,
} from './fakes/in-memory-replay-guard.js';
import { TestExecutionBridge } from './fakes/test-bridge.js';

/**
 * The test-only B4 execution-dispatch boundary (QFJ-P09.02, ADR-0090).
 *
 * Everything here is real: real Ed25519 key pairs generated in-process, real signatures over real
 * bytes, the real shared `executionIntentV1Schema`. Nothing about the cryptography is stubbed,
 * because a stubbed verifier proves only that the stub works.
 *
 * What is deliberately fake is the STATE and the SINK — an in-memory replay guard and a counting
 * bridge — because this phase adds no database and reaches no transport.
 */

const SIGNED_AT = '2026-08-04T12:05:00.000Z';
const NOW = new Date('2026-08-04T12:05:30.000Z');

/** Run the boundary with a valid dispatch, allowing targeted overrides. */
async function run(
  overrides: {
    rawBody?: Uint8Array;
    envelope?: unknown;
    now?: Date;
    registry?: ExecutionDispatchKeyRegistry;
    replayGuard?: InMemoryReplayGuard | UnavailableReplayGuard | NonsenseReplayGuard;
    signedAt?: string;
    domain?: string;
    options?: { signatureFreshnessWindowMs?: number };
  } = {},
) {
  const signer = createTestSigner();
  const intent = makeIntent();
  const rawBody = overrides.rawBody ?? bodyOf(intent);
  const signedAt = overrides.signedAt ?? SIGNED_AT;
  // `in` rather than `??`: an EXPLICIT `undefined` or `null` envelope is a case under test, and
  // `??` would silently replace it with the valid one.
  const envelope = Object.prototype.hasOwnProperty.call(overrides, 'envelope')
    ? overrides.envelope
    : signEnvelope(signer, rawBody, signedAt, overrides.domain);

  return verifyExecutionDispatch({
    rawBody,
    envelope,
    now: overrides.now ?? NOW,
    registry: overrides.registry ?? registryFor(signer),
    replayGuard: overrides.replayGuard ?? new InMemoryReplayGuard(),
    ...(overrides.options === undefined ? {} : { options: overrides.options }),
  });
}

describe('the happy path', () => {
  it('accepts a genuine Core-signed execution dispatch as first-seen', async () => {
    const result = await run();
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok) return;

    expect(result.kind).toBe('validated-dispatch-observation');
    // Narrowing on the disposition is REQUIRED to reach the intent -- `ok` alone is not enough.
    expect(result.disposition).toBe('first-seen');
    if (result.disposition !== 'first-seen') return;
    expect(result.intent.issuer).toBe('quickfurno-core');
    expect(result.intent.executor).toBe('n8n');
    expect(result.intent.deliverySemantics).toBe('at-most-once');
    expect(result.keyId).toBe('core-exec-1');
    expect(result.bodyDigestHex).toBe(digestHex(bodyOf(makeIntent())));
  });

  it('returns a DEEPLY frozen observation carrying no authority field', async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.isFrozen(result)).toBe(true);
    if (result.disposition !== 'first-seen') return;
    expect(Object.isFrozen(result.intent)).toBe(true);
    expect(Object.isFrozen(result.intent.parameters)).toBe(true);

    // The names that would be lies. None of them may exist, at any depth.
    const rendered = JSON.stringify(result);
    for (const forbidden of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'consentValid',
      'retryAllowed',
      'delivered',
      '"sent"',
      'executed',
      '"success"',
    ]) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
  });

  it('leaks no signature bytes, key material or raw body in the result', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);
    const result = await verifyExecutionDispatch({
      rawBody,
      envelope,
      now: NOW,
      registry: registryFor(signer),
      replayGuard: new InMemoryReplayGuard(),
    });
    expect(result.ok).toBe(true);
    const rendered = JSON.stringify(result);
    expect(rendered).not.toContain(envelope['signature']);
    expect(rendered).not.toContain(signer.publicKeySpkiBase64);
  });
});

describe('signature and envelope', () => {
  it('refuses an oversized body before any cryptography', async () => {
    const result = await run({ rawBody: new Uint8Array(MAX_RAW_BODY_BYTES + 1) });
    expect(result).toStrictEqual({ ok: false, reason: 'body-too-large' });
  });

  it.each([
    ['absent envelope', undefined, 'signature-missing'],
    ['null envelope', null, 'signature-missing'],
    [
      'empty signature',
      {
        algorithm: 'ed25519',
        keyId: 'k',
        signedAt: SIGNED_AT,
        bodyDigest: `sha256:${'a'.repeat(64)}`,
        signature: '',
      },
      'signature-missing',
    ],
    ['array envelope', [], 'signature-malformed'],
    ['string envelope', 'nope', 'signature-malformed'],
    [
      'class instance',
      new (class Exotic {
        public readonly marker = 1;
      })(),
      'signature-malformed',
    ],
  ])('refuses a %s', async (_label, envelope, reason) => {
    const result = await run({ envelope });
    expect(result).toStrictEqual({ ok: false, reason });
  });

  it('refuses an extra envelope key', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = { ...signEnvelope(signer, rawBody, SIGNED_AT), extra: 'x' };
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-malformed' });
  });

  it('refuses a SYMBOL extra key', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope: Record<string | symbol, unknown> = signEnvelope(signer, rawBody, SIGNED_AT);
    envelope[Symbol('hidden')] = 'x';
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-malformed' });
  });

  it('refuses a NON-ENUMERABLE extra key', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);
    Object.defineProperty(envelope, 'hidden', { value: 'x', enumerable: false });
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-malformed' });
  });

  it('refuses a getter field WITHOUT invoking the getter', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const base = signEnvelope(signer, rawBody, SIGNED_AT);
    let invoked = false;
    const envelope = {
      algorithm: base['algorithm'],
      keyId: base['keyId'],
      signedAt: base['signedAt'],
      bodyDigest: base['bodyDigest'],
      get signature(): string {
        invoked = true;
        return base['signature'] ?? '';
      },
    };
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-malformed' });
    // The whole point: a hostile accessor must never run inside a trust boundary.
    expect(invoked).toBe(false);
  });

  it('normalises a THROWING Proxy instead of letting it escape', async () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new Error('trap');
        },
        getOwnPropertyDescriptor(): never {
          throw new Error('trap');
        },
      },
    );
    const result = await run({ envelope: hostile });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-malformed' });
  });

  it('refuses an unsupported algorithm', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = { ...signEnvelope(signer, rawBody, SIGNED_AT), algorithm: 'rsa-sha256' };
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'unsupported-algorithm' });
  });

  it('refuses a malformed signedAt', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = {
      ...signEnvelope(signer, rawBody, SIGNED_AT),
      signedAt: '2026-08-04T12:05:00Z',
    };
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'signed-at-malformed' });
  });

  it('refuses an unknown key id', async () => {
    const signer = createTestSigner();
    const other = createTestSigner('core-exec-other');
    const rawBody = bodyOf(makeIntent());
    const result = await run({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      registry: registryFor(other),
    });
    expect(result).toStrictEqual({ ok: false, reason: 'unknown-key-id' });
  });

  it.each([
    ['revoked', { status: 'revoked' as const }, 'key-revoked'],
    [
      'not yet valid',
      { validFrom: '2090-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z' },
      'key-not-yet-valid',
    ],
    [
      'expired',
      { validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2021-01-01T00:00:00.000Z' },
      'key-expired',
    ],
  ])('refuses a %s key', async (_label, override, reason) => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const result = await run({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      registry: registryFor(signer, override),
    });
    expect(result).toStrictEqual({ ok: false, reason });
  });

  it('refuses a stale and a far-future signature', async () => {
    const stale = await run({ now: new Date('2026-08-04T14:00:00.000Z') });
    expect(stale).toStrictEqual({ ok: false, reason: 'signature-stale' });

    const future = await run({ now: new Date('2026-08-04T11:00:00.000Z') });
    expect(future).toStrictEqual({ ok: false, reason: 'signature-future' });
  });

  it('refuses a tampered body and a mismatched claimed digest', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);

    const tampered = new TextEncoder().encode(
      JSON.stringify(makeIntent({ actionType: 'send-something-else' })),
    );
    expect(await run({ rawBody: tampered, envelope, registry: registryFor(signer) })).toStrictEqual(
      { ok: false, reason: 'body-digest-mismatch' },
    );

    expect(
      await run({
        rawBody,
        envelope: { ...envelope, bodyDigest: `sha256:${'b'.repeat(64)}` },
        registry: registryFor(signer),
      }),
    ).toStrictEqual({ ok: false, reason: 'body-digest-mismatch' });
  });

  it('refuses a signature produced by a different key', async () => {
    const signer = createTestSigner();
    const impostor = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    // Same keyId in the envelope, different private key behind it.
    const envelope = signEnvelope({ ...impostor, keyId: signer.keyId }, rawBody, SIGNED_AT);
    const result = await run({ rawBody, envelope, registry: registryFor(signer) });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-invalid' });
  });

  /**
   * The single most important test in this file.
   *
   * B1 (Core -> Jarvis event ingestion) and B4 (Core -> n8n execution dispatch) use the same
   * algorithm. Without domain separation, a captured event signature would verify here — and a
   * boundary that only OBSERVES could be replayed into one that ACTS.
   */
  it('REFUSES a signature minted under the Core -> Jarvis EVENT domain', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const eventDomainEnvelope = signEnvelope(
      signer,
      rawBody,
      SIGNED_AT,
      EVENT_INGESTION_DOMAIN_SEPARATOR,
    );
    const result = await run({
      rawBody,
      envelope: eventDomainEnvelope,
      registry: registryFor(signer),
    });
    expect(result).toStrictEqual({ ok: false, reason: 'signature-invalid' });
  });

  it('uses a domain separator that is NOT the event-ingestion one', () => {
    expect(EXECUTION_DISPATCH_DOMAIN_SEPARATOR).toBe('qf-execution-dispatch-v1');
    expect(EXECUTION_DISPATCH_DOMAIN_SEPARATOR).not.toBe(EVENT_INGESTION_DOMAIN_SEPARATOR);
  });
});

describe('the key registry is a distinct trust purpose', () => {
  it('refuses a key that does not declare the execution-dispatch purpose', () => {
    const signer = createTestSigner();
    expect(() =>
      ExecutionDispatchKeyRegistry.fromRecords([
        {
          keyId: signer.keyId,
          // A key trusted for Core -> Jarvis events must not authorise Core -> n8n dispatches.
          purpose: 'quickfurno-core-to-jarvis-event',
          publicKeySpkiBase64: signer.publicKeySpkiBase64,
          validFrom: '2020-01-01T00:00:00.000Z',
          validUntil: '2099-01-01T00:00:00.000Z',
          status: 'active',
        },
      ]),
    ).toThrow(ExecutionDispatchKeyRegistryError);
  });

  it('names the execution-dispatch purpose explicitly', () => {
    expect(EXECUTION_DISPATCH_KEY_PURPOSE).toBe('quickfurno-core-to-n8n-execution-dispatch');
  });

  it.each([
    ['duplicate ids', 'duplicate'],
    ['a bad validity window', 'window'],
    ['non-Base64 key material', 'base64'],
  ])('throws on %s', (_label, kind) => {
    const signer = createTestSigner();
    const base = {
      keyId: signer.keyId,
      purpose: EXECUTION_DISPATCH_KEY_PURPOSE,
      publicKeySpkiBase64: signer.publicKeySpkiBase64,
      validFrom: '2020-01-01T00:00:00.000Z',
      validUntil: '2099-01-01T00:00:00.000Z',
      status: 'active' as const,
    };
    const records =
      kind === 'duplicate'
        ? [base, base]
        : kind === 'window'
          ? [
              {
                ...base,
                validFrom: '2099-01-01T00:00:00.000Z',
                validUntil: '2020-01-01T00:00:00.000Z',
              },
            ]
          : [{ ...base, publicKeySpkiBase64: 'not base64!!' }];
    expect(() => ExecutionDispatchKeyRegistry.fromRecords(records)).toThrow(
      ExecutionDispatchKeyRegistryError,
    );
  });
});

describe('the raw body, only after authenticity', () => {
  /** Sign whatever bytes are given, so body defects are reached rather than digest mismatches. */
  async function runWithBody(rawBody: Uint8Array) {
    const signer = createTestSigner();
    return verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
      registry: registryFor(signer),
      replayGuard: new InMemoryReplayGuard(),
    });
  }

  it('refuses invalid UTF-8', async () => {
    expect(await runWithBody(new Uint8Array([0xff, 0xfe, 0x00]))).toStrictEqual({
      ok: false,
      reason: 'body-not-utf8',
    });
  });

  it('refuses a UTF-8 BOM rather than stripping it', async () => {
    // Stripping would mean the bytes SIGNED are not the bytes PARSED.
    const withBom = new TextEncoder().encode(`\u{FEFF}${JSON.stringify(makeIntent())}`);
    expect(await runWithBody(withBom)).toStrictEqual({ ok: false, reason: 'body-has-bom' });
  });

  it('refuses invalid JSON and trailing content', async () => {
    expect(await runWithBody(new TextEncoder().encode('{'))).toStrictEqual({
      ok: false,
      reason: 'body-not-json',
    });
    expect(
      await runWithBody(new TextEncoder().encode(`${JSON.stringify(makeIntent())}garbage`)),
    ).toStrictEqual({ ok: false, reason: 'body-not-json' });
  });

  it.each([
    ['an unknown extra field', { extra: 'x' }],
    ['a non-Core issuer', { issuer: 'qf-jarvis' }],
    ['a non-n8n executor', { executor: 'whatsapp' }],
    ['non-at-most-once semantics', { deliverySemantics: 'at-least-once' }],
    ['a contact detail smuggled into parameters', { parameters: { to: '+447700900123' } }],
    ['a credential smuggled into parameters', { parameters: { apiKey: 'sk-live-abc' } }],
    ['retry authority smuggled into parameters', { parameters: { maxAttempts: 3 } }],
  ])('refuses %s', async (_label, override) => {
    const body = new TextEncoder().encode(
      JSON.stringify({ ...makeIntent(), ...(override as object) }),
    );
    expect(await runWithBody(body)).toStrictEqual({
      ok: false,
      reason: 'intent-contract-invalid',
    });
  });
});

describe('dispatch-time freshness and expiry are different questions', () => {
  async function runTemporal(
    intentOverrides: Parameters<typeof makeIntent>[0],
    signedAt: string,
    now: Date,
  ) {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent(intentOverrides));
    return verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope(signer, rawBody, signedAt),
      now,
      registry: registryFor(signer),
      replayGuard: new InMemoryReplayGuard(),
    });
  }

  it('refuses a dispatch signed BEFORE the intent was issued', async () => {
    const result = await runTemporal(
      { issuedAt: '2026-08-04T12:06:00.000Z', expiresAt: '2026-08-04T12:30:00.000Z' },
      SIGNED_AT,
      NOW,
    );
    expect(result).toStrictEqual({ ok: false, reason: 'signed-before-issued' });
  });

  it('ALLOWS signedAt exactly equal to issuedAt', async () => {
    const result = await runTemporal(
      { issuedAt: SIGNED_AT, expiresAt: '2026-08-04T12:30:00.000Z' },
      SIGNED_AT,
      NOW,
    );
    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
  });

  it('refuses a dispatch signed at or after the intent expiry', async () => {
    const result = await runTemporal(
      { issuedAt: '2026-08-04T12:00:00.000Z', expiresAt: SIGNED_AT },
      SIGNED_AT,
      new Date('2026-08-04T12:04:59.000Z'),
    );
    expect(result).toStrictEqual({ ok: false, reason: 'signed-at-or-after-expiry' });
  });

  it('allows now just BEFORE expiry and refuses at and after it', async () => {
    const expiresAt = '2026-08-04T12:06:00.000Z';
    const before = await runTemporal(
      { expiresAt },
      SIGNED_AT,
      new Date('2026-08-04T12:05:59.999Z'),
    );
    expect(before.ok, before.ok ? '' : before.reason).toBe(true);

    // The boundary instant itself is expired. No grace period: `expiresAt` is the LAST instant.
    const at = await runTemporal({ expiresAt }, SIGNED_AT, new Date(expiresAt));
    expect(at).toStrictEqual({ ok: false, reason: 'intent-expired' });

    const after = await runTemporal({ expiresAt }, SIGNED_AT, new Date('2026-08-04T12:06:00.001Z'));
    expect(after).toStrictEqual({ ok: false, reason: 'intent-expired' });
  });

  it('NEVER lets the signature skew window extend intent expiry', async () => {
    // A 15-minute window is generous enough to accept the signature. The intent expired 4 minutes
    // ago, and no amount of skew tolerance may revive an authorization Core already ended.
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent({ expiresAt: '2026-08-04T12:05:30.000Z' }));
    const result = await verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: new Date('2026-08-04T12:09:00.000Z'),
      registry: registryFor(signer),
      replayGuard: new InMemoryReplayGuard(),
      options: { signatureFreshnessWindowMs: 900_000 },
    });
    expect(result).toStrictEqual({ ok: false, reason: 'intent-expired' });
  });

  it('reads only the injected now, never a process clock', async () => {
    const realNow = Date.now;
    Date.now = (): number => {
      throw new Error('the boundary must not read a process clock');
    };
    try {
      const result = await run();
      expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it('throws a CONFIG error for an invalid now or an out-of-range window', async () => {
    await expect(run({ now: new Date('nonsense') })).rejects.toBeInstanceOf(
      ExecutionDispatchConfigError,
    );
    await expect(run({ options: { signatureFreshnessWindowMs: 1 } })).rejects.toBeInstanceOf(
      ExecutionDispatchConfigError,
    );
    await expect(
      run({ options: { signatureFreshnessWindowMs: 86_400_000 } }),
    ).rejects.toBeInstanceOf(ExecutionDispatchConfigError);
  });
});

describe('replay and idempotency', () => {
  /** One signer and one guard across several dispatches, as a real boundary would have. */
  function session() {
    const signer = createTestSigner();
    const guard = new InMemoryReplayGuard();
    const bridge = new TestExecutionBridge();
    const registry = registryFor(signer);
    const dispatch = async (intent = makeIntent()) => {
      const rawBody = bodyOf(intent);
      const result = await verifyExecutionDispatch({
        rawBody,
        envelope: signEnvelope(signer, rawBody, SIGNED_AT),
        now: NOW,
        registry,
        replayGuard: guard,
      });
      bridge.offer(result);
      return result;
    };
    return { dispatch, guard, bridge };
  }

  it('classifies the first dispatch as first-seen and hands off exactly once', async () => {
    const { dispatch, bridge } = session();
    const first = await dispatch();
    expect(first.ok && first.disposition).toBe('first-seen');
    expect(bridge.handoffs).toBe(1);
  });

  it('suppresses an EXACT replay with no second handoff', async () => {
    const { dispatch, bridge } = session();
    await dispatch();
    const again = await dispatch();
    expect(again.ok && again.disposition).toBe('exact-replay');
    // The property a real bridge must preserve: at most one handoff per intent.
    expect(bridge.handoffs).toBe(1);
  });

  it.each([
    ['a changed idempotency key', { idempotencyKey: 'idem-0000000000000000000002' }],
    ['changed body bytes', { actionType: 'send-different-message' }],
  ])('fails closed on %s for the same intent id', async (_label, override) => {
    const { dispatch, bridge } = session();
    await dispatch();
    const conflicting = await dispatch(makeIntent(override));
    expect(conflicting).toStrictEqual({ ok: false, reason: 'idempotency-conflict' });
    expect(bridge.handoffs).toBe(1);
  });

  it('fails closed when one idempotency key is reused by a DIFFERENT intent', async () => {
    const { dispatch, bridge } = session();
    await dispatch();
    const other = await dispatch(
      makeIntent({ executionIntentId: '77777777-7777-4777-8777-777777777777' }),
    );
    expect(other).toStrictEqual({ ok: false, reason: 'idempotency-conflict' });
    expect(bridge.handoffs).toBe(1);
  });

  it('does NOT reserve a replay claim for an invalid signature', async () => {
    const signer = createTestSigner();
    const impostor = createTestSigner();
    const guard = new InMemoryReplayGuard();
    const rawBody = bodyOf(makeIntent());
    const result = await verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope({ ...impostor, keyId: signer.keyId }, rawBody, SIGNED_AT),
      now: NOW,
      registry: registryFor(signer),
      replayGuard: guard,
    });
    expect(result.ok).toBe(false);
    // A forged dispatch that could burn the idempotency key would let an attacker SUPPRESS the
    // legitimate dispatch that follows.
    expect(guard.claimedCount).toBe(0);
  });

  it('does NOT reserve a replay claim for an expired intent', async () => {
    const signer = createTestSigner();
    const guard = new InMemoryReplayGuard();
    const rawBody = bodyOf(makeIntent({ expiresAt: '2026-08-04T12:05:10.000Z' }));
    const result = await verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
      registry: registryFor(signer),
      replayGuard: guard,
    });
    expect(result).toStrictEqual({ ok: false, reason: 'intent-expired' });
    expect(guard.claimedCount).toBe(0);
  });

  it('fails closed when the guard is unavailable, and leaks nothing from its error', async () => {
    const bridge = new TestExecutionBridge();
    const result = await run({ replayGuard: new UnavailableReplayGuard() });
    bridge.offer(result);
    expect(result).toStrictEqual({ ok: false, reason: 'replay-guard-unavailable' });
    expect(bridge.handoffs).toBe(0);
    // The fake's message deliberately contains a path and a token.
    expect(JSON.stringify(result)).not.toContain('/srv/secrets/store');
    expect(JSON.stringify(result)).not.toContain('token=');
  });

  it('refuses a guard answer outside the closed outcome set', async () => {
    const result = await run({ replayGuard: new NonsenseReplayGuard() });
    expect(result).toStrictEqual({ ok: false, reason: 'replay-guard-unavailable' });
  });

  it('calls the guard exactly once per dispatch — no internal retry', async () => {
    let calls = 0;
    const counting = {
      claim: (): 'first-seen' => {
        calls += 1;
        return 'first-seen';
      },
    };
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    await verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
      registry: registryFor(signer),
      replayGuard: counting,
    });
    expect(calls).toBe(1);
  });

  it('binds the claim to the VERIFIER-computed digest, not the sender-claimed one', async () => {
    let seen: { bodyDigestHex: string } | undefined;
    const capturing = {
      claim: (input: { bodyDigestHex: string }): 'first-seen' => {
        seen = input;
        return 'first-seen';
      },
    };
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    await verifyExecutionDispatch({
      rawBody,
      envelope: signEnvelope(signer, rawBody, SIGNED_AT),
      now: NOW,
      registry: registryFor(signer),
      replayGuard: capturing,
    });
    expect(seen?.bodyDigestHex).toBe(digestHex(rawBody));
  });
});

describe('mutability and TOCTOU', () => {
  it('detaches the raw body, so a caller mutating it mid-flight changes nothing', async () => {
    const signer = createTestSigner();
    const intent = makeIntent();
    const original = bodyOf(intent);
    // A caller-owned, mutable buffer -- as a pooled network read would be.
    const callerBuffer = new Uint8Array(original);
    const envelope = signEnvelope(signer, callerBuffer, SIGNED_AT);

    const guard = {
      claim: (): 'first-seen' => {
        // Fires DURING verification, after the boundary has awaited.
        callerBuffer.fill(0);
        return 'first-seen';
      },
    };

    const result = await verifyExecutionDispatch({
      rawBody: callerBuffer,
      envelope,
      now: NOW,
      registry: registryFor(signer),
      replayGuard: guard,
    });

    expect(result.ok, result.ok ? '' : result.reason).toBe(true);
    if (!result.ok || result.disposition !== 'first-seen') return;
    // The returned intent is the one that was actually verified, not the zeroed buffer.
    expect(result.intent.executionIntentId).toBe(intent.executionIntentId);
    expect(result.bodyDigestHex).toBe(digestHex(original));
  });

  it('never re-reads the envelope after parsing it', async () => {
    const signer = createTestSigner();
    const rawBody = bodyOf(makeIntent());
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);

    const guard = {
      claim: (): 'first-seen' => {
        // Swap every envelope field for nonsense mid-flight.
        for (const key of Object.keys(envelope)) {
          envelope[key] = 'tampered';
        }
        return 'first-seen';
      },
    };

    const result = await verifyExecutionDispatch({
      rawBody,
      envelope,
      now: NOW,
      registry: registryFor(signer),
      replayGuard: guard,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyId).toBe(signer.keyId);
    expect(result.signedAtIso).toBe(SIGNED_AT);
  });
});

/**
 * Exact-replay suppression is enforced by the TYPE, not by a convention (owner correction).
 *
 * The first version carried `intent` on both successful branches and relied on the caller reading
 * `disposition`. That left one plausible line able to undo the whole replay guard:
 *
 * ```ts
 * if (result.ok) { execute(result.intent); }
 * ```
 *
 * The executable intent now exists only on the `first-seen` branch, so that line does not compile.
 */
describe('exact replay exposes no executable intent', () => {
  /** One signer and one guard, so the second dispatch is a genuine replay. */
  async function firstThenReplay() {
    const signer = createTestSigner();
    const guard = new InMemoryReplayGuard();
    const registry = registryFor(signer);
    const intent = makeIntent();
    const rawBody = bodyOf(intent);
    const envelope = signEnvelope(signer, rawBody, SIGNED_AT);
    const dispatch = async () =>
      verifyExecutionDispatch({
        rawBody,
        envelope,
        now: NOW,
        registry,
        replayGuard: guard,
      });
    return { intent, first: await dispatch(), replay: await dispatch() };
  }

  it('gives the FIRST-SEEN result the parsed ExecutionIntentV1', async () => {
    const { intent, first } = await firstThenReplay();
    expect(first.ok).toBe(true);
    if (!first.ok || first.disposition !== 'first-seen') {
      throw new Error('expected a first-seen observation');
    }
    expect(first.intent.executionIntentId).toBe(intent.executionIntentId);
    expect(first.intent.issuer).toBe('quickfurno-core');
    expect(Object.isFrozen(first.intent)).toBe(true);
  });

  it('gives the EXACT-REPLAY result no `intent` property at all', async () => {
    const { replay } = await firstThenReplay();
    expect(replay.ok).toBe(true);
    if (!replay.ok || replay.disposition !== 'exact-replay') {
      throw new Error('expected an exact-replay observation');
    }

    // Not "intent is undefined" -- the property does not exist. A caller cannot reach an executable
    // intent on this branch even by ignoring the types.
    expect(Object.prototype.hasOwnProperty.call(replay, 'intent')).toBe(false);
    expect(Object.keys(replay)).not.toContain('intent');
    expect(JSON.stringify(replay)).not.toContain('"intent"');
  });

  it('keeps exact replay an authenticated OBSERVATION, not a refusal', async () => {
    const { intent, replay } = await firstThenReplay();
    expect(replay.ok).toBe(true);
    if (!replay.ok || replay.disposition !== 'exact-replay') {
      throw new Error('expected an exact-replay observation');
    }
    // It was authenticated, intact, in time and consistent. Conflating it with a refusal would lose
    // the difference between "we already did this" and "something is wrong".
    expect(replay.kind).toBe('validated-dispatch-observation');
    expect(replay.keyId).toBe('core-exec-1');
    expect(replay.signedAtIso).toBe(SIGNED_AT);
    // Correlation is preserved without exposing anything executable.
    expect(replay.executionIntentId).toBe(intent.executionIntentId);
    expect(Object.isFrozen(replay)).toBe(true);
  });

  it('drives the test bridge to exactly one handoff across both dispatches', async () => {
    const { first, replay } = await firstThenReplay();
    const bridge = new TestExecutionBridge();
    bridge.offer(first);
    bridge.offer(replay);
    expect(bridge.handoffs).toBe(1);

    // And a refusal adds nothing.
    bridge.offer({ ok: false, reason: 'signature-invalid' });
    expect(bridge.handoffs).toBe(1);
  });

  it('makes the unsafe `if (result.ok) execute(result.intent)` pattern a COMPILE error', async () => {
    const result = await run();

    // COMPILE-TIME assertions, in this repository's established style: the function is never
    // invoked, but the root typecheck type-checks test files, so tsc verifies that each
    // suppression below marks a REAL error. If `intent` were ever put back on the shared branch
    // they would become unused suppressions and the typecheck would FAIL.
    //
    // (The word is deliberately not repeated at the start of a comment line here: TypeScript would
    // read that as another directive, and it would itself be unused.)
    function _exactReplayCannotExposeAnIntent(): void {
      if (result.ok) {
        // @ts-expect-error — `intent` is not on the union of both successful branches; narrowing on
        // `ok` alone must not reach an executable intent.
        void result.intent;
      }
      if (result.ok && result.disposition === 'exact-replay') {
        // @ts-expect-error — the exact-replay branch has no `intent` at all.
        void result.intent;
      }
      if (result.ok && result.disposition === 'first-seen') {
        // Correct narrowing: this one compiles, and is the ONLY way to reach an intent.
        void result.intent.executionIntentId;
      }
    }

    // Referenced so it is not unused; it is never called, so nothing runs.
    expect(typeof _exactReplayCannotExposeAnIntent).toBe('function');
  });
});

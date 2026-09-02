/**
 * `CommunicationStateRecordV2` — the first honest Model-2 record (QFJ-P09 D3, ADR-0141).
 *
 * The suite is organised around the three things that could quietly go wrong:
 *
 * 1. **The subset widening.** V2 admits six states. The other twelve must fail, and the domain
 *    vocabulary must stay eighteen — the two are different sets and the second must not follow the
 *    first.
 * 2. **Evidence becoming decoration.** Every state names the evidence it was derived from, so a
 *    record whose state and evidence disagree is a false record, not a lenient one.
 * 3. **Fields creeping back.** V2 exists partly to keep execution ids, provider references and free
 *    text out of a read model. `strictObject` does the work; these tests prove it stays done.
 *
 * V1 is untouched, and its ADR-0134 characterization tests still pin its historical defects.
 */
import { describe, expect, it } from 'vitest';

import {
  COMMUNICATION_STATE_RECORD_CONTRACT_VERSION,
  COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION,
  COMMUNICATION_STATE_RECORD_V2_STATES,
  COMMUNICATION_STATES,
  communicationStateRecordV1Schema,
  communicationStateRecordV2Schema,
  communicationStateRecordV2StateSchema,
  type CommunicationStateRecordV2,
} from '../index.js';

const COMMUNICATION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const REQUEST_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const RESULT_ID = '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f';
const EVENT_ID = '4d9f2b0e-9a1c-4f3b-9d21-7c6e5a4b3c2d';
const CORRELATION_ID = '7a8b9c0d-1e2f-4a3b-8c5d-6e7f80910203';
const DECISION_ID = '6f7a8b9c-0d1e-4f2a-9b4c-5d6e7f809102';

const RECORDED_AT = '2026-09-01T09:05:00.000Z';

/** A lawful authorization-backed record. Overrides bend exactly one thing per test. */
function authorizationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { evidence, ...rest } = overrides;
  return {
    communicationId: COMMUNICATION_ID,
    contractVersion: 2,
    state: 'authorized',
    recordedAt: RECORDED_AT,
    reasonCode: 'approved-by-policy',
    correlationId: CORRELATION_ID,
    evidence: {
      tier: 'tier-c',
      kind: 'communication-authorization',
      sourceEventId: EVENT_ID,
      communicationRequestId: REQUEST_ID,
      outcome: 'authorized',
      authorizedChannel: 'whatsapp',
      ...(evidence as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

/** A lawful result-backed record, `delivered` / `succeeded` by default. */
function resultRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { evidence, ...rest } = overrides;
  return {
    communicationId: COMMUNICATION_ID,
    contractVersion: 2,
    state: 'delivered',
    recordedAt: RECORDED_AT,
    reasonCode: 'delivered-to-recipient',
    correlationId: CORRELATION_ID,
    evidence: {
      tier: 'tier-c',
      kind: 'communication-result',
      sourceEventId: EVENT_ID,
      communicationResultId: RESULT_ID,
      lifecycleState: 'delivered',
      outcome: 'succeeded',
      ...(evidence as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

/**
 * A lawful `rejected` record: no approval decision id anywhere, because none exists to name.
 *
 * `authorizedChannel` is REMOVED rather than set to `undefined`. The rejected variant has no such
 * field, so an explicitly-passed `undefined` is an unknown key and is refused — which is the point,
 * and was a real hole while the field was merely `.optional()` on a shared branch.
 */
function rejectedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const evidenceOverrides = (overrides['evidence'] ?? {}) as Record<string, unknown>;
  const record = authorizationRecord({
    ...overrides,
    state: 'rejected',
    reasonCode: overrides['reasonCode'] ?? 'recipient-opted-out',
    evidence: { outcome: 'rejected', ...evidenceOverrides },
  });
  const evidence = { ...(record['evidence'] as Record<string, unknown>) };
  if (!('authorizedChannel' in evidenceOverrides)) delete evidence['authorizedChannel'];
  return { ...record, evidence };
}

const parse = (value: unknown): ReturnType<typeof communicationStateRecordV2Schema.safeParse> =>
  communicationStateRecordV2Schema.safeParse(value);

/**
 * A copy of `record` with `record.evidence[key]` removed.
 *
 * Removed rather than set to `undefined`: under `strictObject` an explicit `undefined` and an absent
 * key are different inputs, and the tests below mean the second.
 */
function withoutEvidenceKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const clone = structuredClone(record);
  const evidence = clone['evidence'] as Record<string, unknown>;
  const { [key]: _removed, ...rest } = evidence;
  return { ...clone, evidence: rest };
}

describe('V2 version and vocabulary', () => {
  it('is contract version 2, and leaves V1 at 1', () => {
    expect(COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION).toBe(2);
    expect(COMMUNICATION_STATE_RECORD_CONTRACT_VERSION).toBe(1);
  });

  it('admits exactly the six durable evidence-bearing states', () => {
    expect([...COMMUNICATION_STATE_RECORD_V2_STATES]).toStrictEqual([
      'rejected',
      'authorized',
      'provider-accepted',
      'delivered',
      'read',
      'failed',
    ]);
  });

  it('leaves the domain vocabulary at eighteen', () => {
    // The durable subset and the vocabulary are different sets. Deriving one from the other would
    // widen this contract the day a nineteenth state is added.
    expect(COMMUNICATION_STATES).toHaveLength(18);
    expect(COMMUNICATION_STATE_RECORD_V2_STATES).toHaveLength(6);
  });

  it.each([
    ['authorization-requested', 'conditional Tier B, no adopted receipt primitive'],
    ['scheduled', 'conditional Tier B, no adopted scheduling primitive'],
    ['completed', 'no distinct Core completion truth'],
    ['draft', 'ephemeral; construction is not a durable fact'],
    ['execution-submitted', 'no proved durable Core submission artifact'],
    ['answered', 'Core does not model voice outcomes'],
    ['no-answer', 'Core does not model voice outcomes'],
    ['busy', 'Core does not model voice outcomes'],
    ['follow-up-requested', 'a follow-up is a new lifecycle'],
    ['human-handoff-required', 'candidate contract is not an adopted primitive'],
    ['cancelled', 'rejected for the MVP'],
    ['expired', 'rejected for the MVP'],
  ])('rejects the non-durable state %s (%s)', (state) => {
    expect(communicationStateRecordV2StateSchema.safeParse(state).success).toBe(false);
    expect(parse(authorizationRecord({ state })).success).toBe(false);
  });

  it('rejects an unknown nineteenth state', () => {
    expect(parse(authorizationRecord({ state: 'teleported' })).success).toBe(false);
  });

  it('does not accept a V1 record, and V1 does not accept a V2 record', () => {
    const v1 = {
      communicationId: COMMUNICATION_ID,
      contractVersion: 1,
      channel: 'whatsapp',
      state: 'authorized',
      recordedAt: RECORDED_AT,
      recipient: { entityType: 'vendor', entityId: 'vendor-ref-1' },
      purposeCode: 'onboarding-followup',
      approvalDecisionId: DECISION_ID,
      reasonCode: 'approved-by-policy',
      correlationId: CORRELATION_ID,
    };

    expect(communicationStateRecordV1Schema.safeParse(v1).success).toBe(true);
    expect(parse(v1).success).toBe(false);
    expect(communicationStateRecordV1Schema.safeParse(authorizationRecord()).success).toBe(false);
  });
});

describe('rejected — the ADR-0134 deadlock, resolved', () => {
  it('parses with NO approvalDecisionId at all', () => {
    // V1 required one for `rejected` while CommunicationAuthorizationV1 FORBIDS it on a refusal, so a
    // lawful opt-out could not become a lawful V1 record without inventing a human decision. V2 has
    // no such field, so nothing is invented.
    expect(parse(rejectedRecord()).success).toBe(true);
  });

  it('refuses an approvalDecisionId if one is offered', () => {
    expect(parse(rejectedRecord({ approvalDecisionId: DECISION_ID })).success).toBe(false);
    expect(parse(rejectedRecord({ evidence: { approvalDecisionId: DECISION_ID } })).success).toBe(
      false,
    );
  });

  it('requires authorization evidence whose outcome is rejected', () => {
    expect(parse(rejectedRecord({ evidence: { outcome: 'authorized' } })).success).toBe(false);
  });

  it('refuses an authorized channel — a refusal authorizes nothing', () => {
    expect(parse(rejectedRecord({ evidence: { authorizedChannel: 'whatsapp' } })).success).toBe(
      false,
    );
  });

  it('cannot rest on result evidence', () => {
    const record = resultRecord({ state: 'rejected', reasonCode: 'recipient-opted-out' });

    expect(parse(record).success).toBe(false);
  });

  it('validates sourceEventId', () => {
    expect(parse(rejectedRecord({ evidence: { sourceEventId: 'not-a-uuid' } })).success).toBe(
      false,
    );
  });
});

describe('authorized', () => {
  it('parses with WhatsApp authorization evidence', () => {
    expect(parse(authorizationRecord()).success).toBe(true);
  });

  it('requires an outcome of authorized', () => {
    expect(parse(authorizationRecord({ evidence: { outcome: 'rejected' } })).success).toBe(false);
  });

  it('requires the authorized channel to be named', () => {
    expect(parse(withoutEvidenceKey(authorizationRecord(), 'authorizedChannel')).success).toBe(
      false,
    );
  });

  it.each([['sms'], ['email'], ['voice']])(
    'refuses %s — the first runtime cannot execute it',
    (channel) => {
      // Core may lawfully authorize these and the source contract can represent them. A record
      // claiming `authorized` for a channel nothing can send would lie about capability; widening
      // this is a deliberate future compatibility decision.
      expect(parse(authorizationRecord({ evidence: { authorizedChannel: channel } })).success).toBe(
        false,
      );
    },
  );

  it('cannot rest on result evidence', () => {
    expect(parse(resultRecord({ state: 'authorized' })).success).toBe(false);
  });
});

describe('result-backed states', () => {
  it.each([
    ['delivered', 'succeeded', undefined],
    ['read', 'succeeded', undefined],
    [
      'provider-accepted',
      'indeterminate',
      { failureCode: 'awaiting-reconciliation', retryClassification: 'requires-reconciliation' },
    ],
    [
      'failed',
      'failed',
      { failureCode: 'provider-rejected', retryClassification: 'not-retryable' },
    ],
  ])('accepts %s with matching result evidence', (state, outcome, failure) => {
    const record = resultRecord({
      state,
      evidence: { lifecycleState: state, outcome, ...(failure ? { failure } : {}) },
    });

    expect(parse(record).success).toBe(true);
  });

  it('rejects a state that disagrees with the evidence lifecycle state', () => {
    // The same fact stated twice. If they can disagree, one of them is decoration.
    const record = resultRecord({ state: 'read', evidence: { lifecycleState: 'delivered' } });

    expect(parse(record).success).toBe(false);
  });

  it('refuses provider-accepted reported as succeeded', () => {
    const record = resultRecord({
      state: 'provider-accepted',
      evidence: { lifecycleState: 'provider-accepted', outcome: 'succeeded' },
    });

    expect(parse(record).success).toBe(false);
  });

  it('refuses a failed state reported as succeeded', () => {
    const record = resultRecord({
      state: 'failed',
      evidence: { lifecycleState: 'failed', outcome: 'succeeded' },
    });

    expect(parse(record).success).toBe(false);
  });

  it('requires a structured failure for a failed outcome', () => {
    const record = resultRecord({
      state: 'failed',
      evidence: { lifecycleState: 'failed', outcome: 'failed' },
    });

    expect(parse(record).success).toBe(false);
  });

  it('requires an indeterminate outcome to carry a reconciliation failure', () => {
    const base = { lifecycleState: 'provider-accepted', outcome: 'indeterminate' };

    expect(parse(resultRecord({ state: 'provider-accepted', evidence: base })).success).toBe(false);
    expect(
      parse(
        resultRecord({
          state: 'provider-accepted',
          evidence: {
            ...base,
            failure: { failureCode: 'unclear', retryClassification: 'retryable' },
          },
        }),
      ).success,
    ).toBe(false);
  });

  it.each([['delivered'], ['read']])('refuses %s reported as indeterminate', (state) => {
    // If we do not know, we do not claim it arrived.
    const record = resultRecord({
      state,
      evidence: {
        lifecycleState: state,
        outcome: 'indeterminate',
        failure: { failureCode: 'unclear', retryClassification: 'requires-reconciliation' },
      },
    });

    expect(parse(record).success).toBe(false);
  });

  it('refuses a succeeded outcome that also carries a failure', () => {
    const record = resultRecord({
      evidence: {
        failure: { failureCode: 'provider-rejected', retryClassification: 'not-retryable' },
      },
    });

    expect(parse(record).success).toBe(false);
  });

  it('minimises failure to a code and a retry class', () => {
    for (const extra of [
      { failureCategory: 'provider' },
      { description: 'a provider description' },
    ]) {
      const record = resultRecord({
        state: 'failed',
        evidence: {
          lifecycleState: 'failed',
          outcome: 'failed',
          failure: {
            failureCode: 'provider-rejected',
            retryClassification: 'not-retryable',
            ...extra,
          },
        },
      });

      expect(parse(record).success).toBe(false);
    }
  });
});

describe('strictness and privacy', () => {
  it.each([
    ['executionIntentId'],
    ['executionResultId'],
    ['recipient'],
    ['purposeCode'],
    ['explanation'],
    ['channel'],
    ['approvalDecisionId'],
    ['policy'],
    ['hasConsent'],
    ['canSend'],
    ['authorizedUntil'],
    ['trusted'],
    ['verified'],
    ['authoritative'],
    ['payload'],
    ['signature'],
    ['semanticEventDigest'],
  ])('rejects a top-level %s', (key) => {
    expect(parse({ ...authorizationRecord(), [key]: 'anything' }).success).toBe(false);
  });

  it.each([
    ['executionIntentId'],
    ['executionResultId'],
    ['providerEvidence'],
    ['providerReference'],
    ['providerOccurredAt'],
    ['explanation'],
    ['rawPayload'],
  ])('rejects %s inside result evidence', (key) => {
    expect(parse(resultRecord({ evidence: { [key]: 'anything' } })).success).toBe(false);
  });

  it('rejects an unknown evidence kind and a non-tier-c tier', () => {
    expect(parse(authorizationRecord({ evidence: { kind: 'communication-draft' } })).success).toBe(
      false,
    );
    expect(parse(authorizationRecord({ evidence: { tier: 'tier-b' } })).success).toBe(false);
  });

  it('cannot be satisfied by a sourceEventId alone', () => {
    // An event id is a name any caller can type. It is a pointer TO provenance, never provenance.
    const record = authorizationRecord();
    record['evidence'] = {
      tier: 'tier-c',
      kind: 'communication-authorization',
      sourceEventId: EVENT_ID,
    };

    expect(parse(record).success).toBe(false);
  });
});

describe('common fields', () => {
  it.each([
    [['communicationId'] as const, 'not-a-uuid'],
    [['correlationId'] as const, 'not-a-uuid'],
    [['recordedAt'] as const, 'the third of never'],
    [['reasonCode'] as const, 'Not A Machine Token'],
  ])('validates %s', ([field], bad) => {
    const record = authorizationRecord({ [field]: bad });

    expect(parse(record).success).toBe(false);
  });

  it('keeps reasonCode an OPEN machine token', () => {
    // Core's refusal taxonomy is Core's. Closing this to a local enum would drop a reason Jarvis had
    // never heard of, which is exactly the failure ADR-0083 warns about.
    for (const code of ['recipient-opted-out', 'do-not-contact', 'some-future-core-reason']) {
      expect(parse(rejectedRecord({ reasonCode: code })).success).toBe(true);
    }
  });

  it('allows previousState to be absent, or one of the same six', () => {
    expect(parse(authorizationRecord()).success).toBe(true);
    expect(parse(resultRecord({ previousState: 'authorized' })).success).toBe(true);
  });

  it.each([['authorization-requested'], ['scheduled'], ['completed'], ['draft']])(
    'refuses previousState %s',
    (previousState) => {
      // Otherwise an undurable state would enter a durable record through the back door.
      expect(parse(resultRecord({ previousState })).success).toBe(false);
    },
  );
});

describe('V1 stays immutable, and there is no migration', () => {
  it('exports no V1 -> V2 conversion helper', async () => {
    const contracts = (await import('../index.js')) as unknown as Record<string, unknown>;

    for (const forbidden of [
      'migrateCommunicationStateRecord',
      'toCommunicationStateRecordV2',
      'upgradeCommunicationStateRecord',
      'createStateRecordFromEventId',
      'authorizeStateFromEventId',
      'evidenceFromEventId',
    ]) {
      expect(contracts).not.toHaveProperty(forbidden);
    }
  });

  it('publishes the intended V2 surface, and no internal evidence schema', async () => {
    const contracts = (await import('../index.js')) as unknown as Record<string, unknown>;

    for (const name of [
      'COMMUNICATION_STATE_RECORD_V2_CONTRACT_VERSION',
      'COMMUNICATION_STATE_RECORD_V2_STATES',
      'communicationStateRecordV2Schema',
      'communicationStateRecordV2StateSchema',
    ]) {
      expect(contracts).toHaveProperty(name);
    }
    for (const internal of [
      'authorizationEvidenceSchema',
      'resultEvidenceSchema',
      'minimisedFailureSchema',
      'communicationStateRecordV2EvidenceSchema',
    ]) {
      expect(contracts).not.toHaveProperty(internal);
    }
  });
});

/**
 * COMPILE-TIME coupling, which is the half a runtime test cannot reach.
 *
 * The earlier shape parsed the same inputs correctly but let the inferred TYPE describe impossible
 * records — a `rejected` whose outcome is `authorized`, a `read` whose evidence says `delivered`. Those
 * are now unrepresentable, and `@ts-expect-error` FAILS THE BUILD if any of them ever starts compiling,
 * so this block is a live assertion rather than documentation.
 */
describe('state/evidence coupling is structural', () => {
  const COMMON = {
    communicationId: COMMUNICATION_ID,
    contractVersion: 2,
    recordedAt: RECORDED_AT,
    correlationId: CORRELATION_ID,
  } as const;
  const AUTH = {
    tier: 'tier-c',
    kind: 'communication-authorization',
    sourceEventId: EVENT_ID,
    communicationRequestId: REQUEST_ID,
  } as const;
  const RESULT = {
    tier: 'tier-c',
    kind: 'communication-result',
    sourceEventId: EVENT_ID,
    communicationResultId: RESULT_ID,
  } as const;

  it('accepts the three lawful shapes at compile time', () => {
    const rejected = {
      ...COMMON,
      state: 'rejected',
      reasonCode: 'recipient-opted-out',
      evidence: { ...AUTH, outcome: 'rejected' },
    } satisfies CommunicationStateRecordV2;

    const authorized = {
      ...COMMON,
      state: 'authorized',
      reasonCode: 'approved-by-policy',
      evidence: { ...AUTH, outcome: 'authorized', authorizedChannel: 'whatsapp' },
    } satisfies CommunicationStateRecordV2;

    const delivered = {
      ...COMMON,
      state: 'delivered',
      reasonCode: 'delivered-to-recipient',
      evidence: { ...RESULT, lifecycleState: 'delivered', outcome: 'succeeded' },
    } satisfies CommunicationStateRecordV2;

    // And they are lawful at runtime too, so the type and the schema agree.
    for (const record of [rejected, authorized, delivered]) {
      expect(parse(record).success).toBe(true);
    }
  });

  it('makes every impossible combination a compile error', () => {
    // Each `@ts-expect-error` sits on the exact line TypeScript reports, so an unused directive is
    // itself a build failure. If any of these ever starts compiling, the coupling has regressed.
    const missingChannel = {
      ...COMMON,
      state: 'authorized',
      reasonCode: 'approved-by-policy',
      // @ts-expect-error authorized must name the channel it was authorized for
      evidence: { ...AUTH, outcome: 'authorized' },
    } satisfies CommunicationStateRecordV2;

    const authorizedButRejected = {
      ...COMMON,
      state: 'authorized',
      reasonCode: 'approved-by-policy',
      // @ts-expect-error an authorized state cannot rest on a rejection
      evidence: { ...AUTH, outcome: 'rejected', authorizedChannel: 'whatsapp' },
    } satisfies CommunicationStateRecordV2;

    const rejectedButAuthorized = {
      ...COMMON,
      state: 'rejected',
      reasonCode: 'recipient-opted-out',
      // @ts-expect-error a rejected state cannot rest on an authorization
      evidence: { ...AUTH, outcome: 'authorized' },
    } satisfies CommunicationStateRecordV2;

    const rejectedWithChannel = {
      ...COMMON,
      state: 'rejected',
      reasonCode: 'recipient-opted-out',
      // @ts-expect-error a refusal authorizes no channel, so it cannot even name the field
      evidence: { ...AUTH, outcome: 'rejected', authorizedChannel: 'whatsapp' },
    } satisfies CommunicationStateRecordV2;

    const readSaysDelivered = {
      ...COMMON,
      state: 'read',
      reasonCode: 'read-by-recipient',
      evidence: { ...RESULT, lifecycleState: 'delivered', outcome: 'succeeded' },
      // @ts-expect-error read cannot carry delivered evidence
    } satisfies CommunicationStateRecordV2;

    const providerAcceptedSaysFailed = {
      ...COMMON,
      state: 'provider-accepted',
      reasonCode: 'accepted-by-provider',
      evidence: { ...RESULT, lifecycleState: 'failed', outcome: 'failed' },
      // @ts-expect-error provider-accepted cannot carry failed evidence
    } satisfies CommunicationStateRecordV2;

    const resultStateWithAuthEvidence = {
      ...COMMON,
      state: 'delivered',
      reasonCode: 'delivered-to-recipient',
      // @ts-expect-error a result state cannot rest on authorization evidence
      evidence: { ...AUTH, outcome: 'authorized', authorizedChannel: 'whatsapp' },
    } satisfies CommunicationStateRecordV2;

    const authStateWithResultEvidence = {
      ...COMMON,
      state: 'authorized',
      reasonCode: 'approved-by-policy',
      // @ts-expect-error an authorization state cannot rest on result evidence
      evidence: { ...RESULT, lifecycleState: 'delivered', outcome: 'succeeded' },
    } satisfies CommunicationStateRecordV2;

    // Every one of them is refused at runtime too, so the type and the schema agree about what is
    // impossible rather than each guarding a different set.
    expect(
      [
        missingChannel,
        authorizedButRejected,
        rejectedButAuthorized,
        rejectedWithChannel,
        readSaysDelivered,
        providerAcceptedSaysFailed,
        resultStateWithAuthEvidence,
        authStateWithResultEvidence,
      ].every((record) => !parse(record).success),
    ).toBe(true);
  });

  it('refuses an explicit authorizedChannel: undefined on a rejection', () => {
    // `.optional()` would have accepted this. The rejected variant has no such field at all, so
    // strictObject treats it as an unknown key.
    const record = {
      ...COMMON,
      state: 'rejected',
      reasonCode: 'recipient-opted-out',
      evidence: { ...AUTH, outcome: 'rejected', authorizedChannel: undefined },
    };

    expect(parse(record).success).toBe(false);
  });
});

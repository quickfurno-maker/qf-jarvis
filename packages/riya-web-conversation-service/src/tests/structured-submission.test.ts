/**
 * RWC-P6B — deterministic idempotency, the guarded Core submission, and the accepted-result
 * reconciliation (ADR-0102 §11–§15).
 *
 * This is the slice where a mistake creates a second enquiry against a real person's project, so most
 * of what follows counts calls rather than inspecting values: **at most one availability read, at most
 * one Core state read, at most one submit, and at most two lookups — the second only as the authorized
 * recovery.**
 */
import { idempotencyKeySchema } from '@qf-jarvis/contracts';
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import type { ScriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import { RIYA_STRUCTURED_ACTION_REASON_CODES } from '../contracts/structured-action-result.js';
import { riyaIntakeIdempotencyKey } from '../internal/submission-identity.js';
import { createRiyaStructuredActionService } from '../service/create-structured-action-service.js';
import type { InMemoryContinuityStore } from './fakes/in-memory-continuity-store.js';
import type { QueuedCoreIntakePort } from './fakes/structured-action-harness.js';
import {
  ACTION_REF,
  ConflictOnceStore,
  CONVERSATION,
  continuityAt,
  coreState,
  queuedCoreIntakePort,
  REJECT,
  seededStore,
  SUBJECT,
  TENANT,
} from './fakes/structured-action-harness.js';

const AT_CONSENT = () => continuityAt('CONSENT');
const EVIDENCE = 'core.intake.evidence.1';

const KEY = riyaIntakeIdempotencyKey({
  tenantId: TENANT,
  conversationId: CONVERSATION,
  subjectRef: SUBJECT,
  discovery: AT_CONSENT().discovery,
});

const action = (over: Record<string, unknown> = {}): never =>
  ({
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    expectedContinuityRevision: 4,
    actionRef: ACTION_REF,
    subjectRef: SUBJECT,
    ...over,
  }) as never;

const notFound = (key: string = KEY) => ({
  contractVersion: 1,
  idempotencyKey: key,
  status: 'NOT_FOUND',
});

const accepted = (key: string = KEY) => ({
  contractVersion: 1,
  idempotencyKey: key,
  outcome: 'ACCEPTED',
  completionEvidenceRef: EVIDENCE,
});

const nonAccepted = (outcome: string, key: string = KEY) => ({
  contractVersion: 1,
  idempotencyKey: key,
  outcome,
  reasonCode: 'not-yet',
});

/**
 * Concretely typed on purpose: the specs assert CALL COUNTS, and a helper that widened these to their
 * port interfaces would hide the very counters this suite exists to read.
 */
interface Harness {
  readonly continuityStore?: InMemoryContinuityStore;
  readonly availabilityReader?: ScriptedAvailabilityReader;
  readonly coreIntakePort?: QueuedCoreIntakePort;
}

function build(over: Harness = {}) {
  const continuityStore = over.continuityStore ?? seededStore(AT_CONSENT());
  const availabilityReader = over.availabilityReader ?? scriptedAvailabilityReader();
  const coreIntakePort = over.coreIntakePort ?? queuedCoreIntakePort({});
  return {
    service: createRiyaStructuredActionService({
      continuityStore,
      availabilityReader,
      coreIntakePort,
    }),
    continuityStore,
    availabilityReader,
    coreIntakePort,
  };
}

// ---------------------------------------------------------------------------
// The deterministic key.
// ---------------------------------------------------------------------------

describe('the idempotency key binds the business intake and nothing else', () => {
  const base = {
    tenantId: TENANT,
    conversationId: CONVERSATION,
    subjectRef: SUBJECT,
    discovery: AT_CONSENT().discovery,
  };

  it('has the exact preferred form, and satisfies the ONE shared authority', () => {
    expect(KEY).toMatch(/^riya-intake\.[0-9a-f]{64}$/u);
    expect(KEY).toHaveLength(76);
    expect(idempotencyKeySchema.safeParse(KEY).success).toBe(true);
  });

  it('is deterministic: the same business identity derives the same key, every time', () => {
    expect(riyaIntakeIdempotencyKey(base)).toBe(KEY);
    expect(
      riyaIntakeIdempotencyKey({ ...base, discovery: continuityAt('CONSENT').discovery }),
    ).toBe(KEY);
  });

  it('every identity and EVERY discovery slot changes the key, independently', () => {
    // All three identity fields and all SEVEN discovery slots, each proved on its own. The optional
    // three matter most: the base fixture omits them, so if a refactor ever dropped one from the
    // preimage, a table that only exercised the four required values would stay green while two
    // materially different enquiries started hashing to the same key.
    const changed: Record<string, Parameters<typeof riyaIntakeIdempotencyKey>[0]> = {
      tenant: { ...base, tenantId: 'tenant.z' },
      conversation: { ...base, conversationId: 'conv.999' },
      subject: { ...base, subjectRef: 'subject.999' },
      service: {
        ...base,
        discovery: continuityAt('CONSENT', { serviceInterestRef: 'svc.two' }).discovery,
      },
      city: { ...base, discovery: continuityAt('CONSENT', { locationRef: 'city.beta' }).discovery },
      propertyType: {
        ...base,
        discovery: continuityAt('CONSENT', { propertyTypeRef: 'property.villa' }).discovery,
      },
      scope: {
        ...base,
        discovery: continuityAt('CONSENT', { scopeSummary: 'kitchen and two wardrobes' }).discovery,
      },
      budget: {
        ...base,
        discovery: continuityAt('CONSENT', { budgetNote: 'around 12 lakh' }).discovery,
      },
      timeline: {
        ...base,
        discovery: continuityAt('CONSENT', { timelineNote: 'next year' }).discovery,
      },
      consultationPreference: {
        ...base,
        discovery: continuityAt('CONSENT', { consultationPreferenceRef: 'consult.video' })
          .discovery,
      },
    };
    const keys = new Set<string>([KEY]);
    Object.entries(changed).forEach(([label, input]) => {
      const derived = riyaIntakeIdempotencyKey(input);
      expect(derived, label).not.toBe(KEY);
      keys.add(derived);
    });
    expect(Object.keys(changed)).toHaveLength(10);
    // All distinct: a collision between any two of these would silently merge two enquiries.
    expect(keys.size).toBe(11);
  });

  it('populating an OPTIONAL slot that was absent changes the key', () => {
    // The explicit null-versus-value proof. `JSON.stringify` renders an absent optional as `null` in
    // the preimage array, so "not stated" and "stated as something" are genuinely different inputs --
    // and a client who adds their property type is describing a different project than one who did
    // not mention it.
    for (const populated of [
      continuityAt('CONSENT', { propertyTypeRef: 'property.villa' }).discovery,
      continuityAt('CONSENT', { scopeSummary: 'kitchen and two wardrobes' }).discovery,
      continuityAt('CONSENT', { consultationPreferenceRef: 'consult.video' }).discovery,
    ]) {
      // The base fixture genuinely omits all three, which is what makes this an absent-to-present
      // comparison rather than a value-to-value one.
      expect(base.discovery.propertyTypeRef).toBeUndefined();
      expect(base.discovery.scopeSummary).toBeUndefined();
      expect(base.discovery.consultationPreferenceRef).toBeUndefined();
      expect(riyaIntakeIdempotencyKey({ ...base, discovery: populated })).not.toBe(KEY);
    }
  });

  it('a moved revision, a new action reference and a fresher snapshot do NOT change it', () => {
    // The whole reason the key exists. A conversational revision moves for reasons that have nothing
    // to do with the intake -- a concurrent turn, a provenance strengthening -- and if that changed
    // the key, a retry after a network wobble would derive a new one and Core would create a second
    // enquiry.
    expect(
      riyaIntakeIdempotencyKey({
        ...base,
        discovery: continuityAt('CONSENT', { continuityRevision: 41 }).discovery,
      }),
    ).toBe(KEY);
    // `actionRef`, `availabilitySnapshotRef` and `taxonomyVersion` are not parameters at all -- they
    // cannot influence the key because the function cannot see them.
    expect(Object.keys(base).sort()).toStrictEqual([
      'conversationId',
      'discovery',
      'subjectRef',
      'tenantId',
    ]);
  });

  it('reads no clock and no randomness: two derivations are byte-identical', () => {
    expect(riyaIntakeIdempotencyKey(base)).toBe(riyaIntakeIdempotencyKey(base));
  });
});

// ---------------------------------------------------------------------------
// Preconditions, before anything outbound.
// ---------------------------------------------------------------------------

describe('submission preconditions', () => {
  it('only CONSENT may submit', async () => {
    for (const phase of ['SUMMARY', 'CONTACT', 'COMPLETE'] as const) {
      const seeded =
        phase === 'SUMMARY'
          ? continuityAt('SUMMARY', { summaryConfirmed: false })
          : phase === 'COMPLETE'
            ? continuityAt('COMPLETE', { completionEvidenceRef: EVIDENCE })
            : continuityAt('CONTACT');
      const store = seededStore(seeded);
      const { service, availabilityReader, coreIntakePort } = build({ continuityStore: store });
      const outcome = await service.submitConfirmedIntake(action());
      expect(outcome, phase).toMatchObject({
        disposition: 'REFUSED',
        reasonCode: 'ACTION_NOT_PERMITTED',
      });
      expect(availabilityReader.calls()).toBe(0);
      expect(coreIntakePort.reads() + coreIntakePort.lookups() + coreIntakePort.submits()).toBe(0);
      expect(store.calls.compareAndSet).toBe(0);
    }
  });

  it('human review blocks the submission before any outbound call', async () => {
    const store = seededStore(continuityAt('CONSENT', { completeness: 'HUMAN_REVIEW_REQUIRED' }));
    const { service, availabilityReader, coreIntakePort } = build({ continuityStore: store });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'HUMAN_REVIEW_REQUIRED',
    });
    expect(availabilityReader.calls()).toBe(0);
    expect(coreIntakePort.reads()).toBe(0);
  });

  it('a pair Core has stopped selling blocks it, with no Core intake call at all', async () => {
    const store = seededStore(
      continuityAt('CONSENT', { serviceInterestRef: 'svc.two', locationRef: 'city.beta' }),
    );
    const { service, availabilityReader, coreIntakePort } = build({ continuityStore: store });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AVAILABILITY_CHANGED',
    });
    expect(availabilityReader.calls()).toBe(1);
    expect(coreIntakePort.reads() + coreIntakePort.lookups() + coreIntakePort.submits()).toBe(0);
  });

  it('an unprovable availability answer is NOT_READY, and reaches no Core intake port', async () => {
    const { service, coreIntakePort } = build({
      availabilityReader: scriptedAvailabilityReader({ rejects: true }),
    });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AUTHORITY_UNAVAILABLE',
    });
    expect(coreIntakePort.reads()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Core state, contact and consent.
// ---------------------------------------------------------------------------

describe('the Core intake state gates the submission, and Jarvis never changes it', () => {
  const cases: Record<
    string,
    { readonly state: Record<string, unknown>; readonly expected: object }
  > = {
    'a wrong tenant': {
      state: coreState({ tenantId: 'tenant.z' }),
      expected: { disposition: 'NOT_READY', reasonCode: 'AUTHORITY_MISMATCH' },
    },
    'a wrong conversation': {
      state: coreState({ conversationId: 'conv.999' }),
      expected: { disposition: 'NOT_READY', reasonCode: 'AUTHORITY_MISMATCH' },
    },
    'a wrong subject': {
      state: coreState({ subjectRef: 'subject.999' }),
      expected: { disposition: 'NOT_READY', reasonCode: 'AUTHORITY_MISMATCH' },
    },
    'missing contact': {
      state: coreState({ contact: { state: 'MISSING' } }),
      expected: { disposition: 'NOT_READY', reasonCode: 'CONTACT_MISSING' },
    },
    'missing consent': {
      state: coreState({ consent: { state: 'MISSING' } }),
      expected: { disposition: 'NOT_READY', reasonCode: 'CONSENT_MISSING' },
    },
    'a declined intake': {
      state: coreState({ consent: { state: 'DECLINED', evidenceRef: 'core.consent.1' } }),
      expected: { disposition: 'REFUSED', reasonCode: 'CONSENT_DECLINED' },
    },
    'a global opt-out': {
      state: coreState({ consent: { state: 'OPTED_OUT', evidenceRef: 'core.consent.1' } }),
      expected: { disposition: 'REFUSED', reasonCode: 'CONSENT_OPTED_OUT' },
    },
  };

  Object.entries(cases).forEach(([label, spec]) => {
    it(`stops on ${label}, with no lookup and no submit`, async () => {
      const store = seededStore(AT_CONSENT());
      const port = queuedCoreIntakePort({ read: [spec.state] });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      const outcome = await service.submitConfirmedIntake(action());
      expect(outcome).toMatchObject(spec.expected);
      expect(port.reads()).toBe(1);
      expect(port.lookups()).toBe(0);
      expect(port.submits()).toBe(0);
      expect(store.calls.compareAndSet).toBe(0);
      // The conversation is reported back so a surface can re-render, and it has not moved.
      expect(outcome.continuity?.phase).toBe('CONSENT');
    });
  });

  it('a declined intake and a global opt-out are DIFFERENT answers', () => {
    // Collapsing them would either over-apply a refusal or -- far worse -- under-apply an opt-out.
    expect(RIYA_STRUCTURED_ACTION_REASON_CODES).toContain('CONSENT_DECLINED');
    expect(RIYA_STRUCTURED_ACTION_REASON_CODES).toContain('CONSENT_OPTED_OUT');
  });
});

// ---------------------------------------------------------------------------
// Lookup before submit.
// ---------------------------------------------------------------------------

describe('lookup before mutation, always', () => {
  it('a key-matching NOT_FOUND submits EXACTLY once, through the canonical constructor', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound()],
      submit: [accepted()],
    });
    const { service, availabilityReader } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('COMPLETE');
    expect(outcome.continuity?.completionEvidenceRef).toBe(EVIDENCE);
    expect(outcome.continuity?.continuityRevision).toBe(5);

    expect(availabilityReader.calls()).toBe(1);
    expect(port.reads()).toBe(1);
    expect(port.lookups()).toBe(1);
    expect(port.submits()).toBe(1);
    expect(store.calls.compareAndSet).toBe(1);

    const sent = port.seenSubmissions()[0];
    expect(sent?.producingSystem).toBe('qf-jarvis');
    expect(sent?.idempotencyKey).toBe(KEY);
    expect(sent?.summaryConfirmed).toBe(true);
    expect(sent?.intakeStateRef).toBe('core.intake.state.1');
    expect(sent?.availabilitySnapshotRef).toBe('snap.synthetic.1');
    expect(sent?.taxonomyVersion).toBe(7);
    expect(sent?.continuityRevision).toBe(4);
    // The lookup asked about the SAME key that was then submitted.
    expect(port.seenLookups()[0]).toStrictEqual({
      tenantId: TENANT,
      conversationId: CONVERSATION,
      idempotencyKey: KEY,
    });
  });

  it('the submission is built through the CANONICAL constructor, and the discovery round-trips', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound()],
      submit: [accepted()],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    await service.submitConfirmedIntake(action());
    const sent = port.seenSubmissions()[0];
    // Re-proved by `createNeedDiscovery` inside the constructor, and byte-identical to what was
    // stored -- so the projection that made it acceptable moved nothing.
    expect(sent?.discovery).toStrictEqual(AT_CONSENT().discovery);
    // Powerless by construction: no outcome, no canSubmit, no consent, no lead, no contact.
    expect(Object.keys(sent ?? {}).sort()).toStrictEqual([
      'availabilitySnapshotRef',
      'continuityRevision',
      'contractVersion',
      'conversationId',
      'discovery',
      'idempotencyKey',
      'intakeStateRef',
      'producingSystem',
      'subjectRef',
      'summaryConfirmed',
      'taxonomyVersion',
      'tenantId',
    ]);
    // The action reference correlates a press; it is not part of the submission at all.
    expect(JSON.stringify(sent)).not.toContain(ACTION_REF);
  });

  it('no result and no stored state ever carries the hash preimage or a raw discovery value', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound()],
      submit: [accepted()],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    // The key is a hash. Nothing recoverable about a real person's project may travel with it.
    expect(JSON.stringify(outcome)).not.toContain(KEY);
    expect(JSON.stringify(outcome)).not.toContain('riya-intake.');
  });

  it('a lookup answering about ANOTHER key never submits', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound(`riya-intake.${'b'.repeat(64)}`)],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AUTHORITY_MISMATCH',
    });
    expect(port.submits()).toBe(0);
    expect(port.lookups()).toBe(1);
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('an unavailable or unprovable lookup never submits', async () => {
    for (const scripted of [REJECT, { contractVersion: 1, status: 'NOT_FOUND' }, 'nope']) {
      const store = seededStore(AT_CONSENT());
      const port = queuedCoreIntakePort({ read: [coreState()], lookup: [scripted] });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      const outcome = await service.submitConfirmedIntake(action());
      expect(outcome).toMatchObject({
        disposition: 'NOT_READY',
        reasonCode: 'AUTHORITY_UNAVAILABLE',
      });
      expect(port.submits()).toBe(0);
    }
  });

  it('a FOUND ACCEPTED result completes WITHOUT submitting', async () => {
    // The recovery this contract exists for: Core already recorded this submission, so submitting
    // again would be the duplicate enquiry the whole mechanism is built to prevent.
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [{ contractVersion: 1, idempotencyKey: KEY, status: 'FOUND', result: accepted() }],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('COMPLETE');
    expect(port.submits()).toBe(0);
    expect(port.lookups()).toBe(1);
  });

  it('a FOUND non-accepted result maps without submitting and without writing', async () => {
    const mapping: Record<string, object> = {
      NOT_READY: { disposition: 'NOT_READY', reasonCode: 'CORE_NOT_READY' },
      REJECTED: { disposition: 'REFUSED', reasonCode: 'CORE_REJECTED' },
      HUMAN_REVIEW_REQUIRED: { disposition: 'NOT_READY', reasonCode: 'HUMAN_REVIEW_REQUIRED' },
    };
    for (const [outcome, expected] of Object.entries(mapping)) {
      const store = seededStore(AT_CONSENT());
      const port = queuedCoreIntakePort({
        read: [coreState()],
        lookup: [
          {
            contractVersion: 1,
            idempotencyKey: KEY,
            status: 'FOUND',
            result: nonAccepted(outcome),
          },
        ],
      });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      expect(await service.submitConfirmedIntake(action()), outcome).toMatchObject(expected);
      expect(port.submits()).toBe(0);
      expect(store.calls.compareAndSet).toBe(0);
      expect(store.peek(TENANT, CONVERSATION)?.phase).toBe('CONSENT');
    }
  });

  it('a FOUND wrapper whose nested result names another key is refused by the parser', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [
        {
          contractVersion: 1,
          idempotencyKey: KEY,
          status: 'FOUND',
          result: accepted(`riya-intake.${'c'.repeat(64)}`),
        },
      ],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    expect(await service.submitConfirmedIntake(action())).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AUTHORITY_UNAVAILABLE',
    });
    expect(port.submits()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The direct submit.
// ---------------------------------------------------------------------------

describe('the direct submit is cross-checked before its evidence may be used', () => {
  it('a result naming another key completes nothing, and takes NO recovery lookup', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound()],
      submit: [accepted(`riya-intake.${'d'.repeat(64)}`)],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AUTHORITY_MISMATCH',
    });
    // A well-formed answer about somebody else's submission. There is nothing indeterminate about it.
    expect(port.lookups()).toBe(1);
    expect(port.submits()).toBe(1);
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('non-accepted direct outcomes map and write nothing', async () => {
    const mapping: Record<string, object> = {
      NOT_READY: { disposition: 'NOT_READY', reasonCode: 'CORE_NOT_READY' },
      REJECTED: { disposition: 'REFUSED', reasonCode: 'CORE_REJECTED' },
      HUMAN_REVIEW_REQUIRED: { disposition: 'NOT_READY', reasonCode: 'HUMAN_REVIEW_REQUIRED' },
    };
    for (const [outcome, expected] of Object.entries(mapping)) {
      const store = seededStore(AT_CONSENT());
      const port = queuedCoreIntakePort({
        read: [coreState()],
        lookup: [notFound()],
        submit: [nonAccepted(outcome)],
      });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      expect(await service.submitConfirmedIntake(action()), outcome).toMatchObject(expected);
      expect(port.submits()).toBe(1);
      expect(store.calls.compareAndSet).toBe(0);
    }
  });

  it("Core's reason code is never persisted and never returned", async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound()],
      submit: [
        {
          contractVersion: 1,
          idempotencyKey: KEY,
          outcome: 'REJECTED',
          reasonCode: 'vendor-capacity-exhausted',
        },
      ],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    const serialized = JSON.stringify(outcome) + JSON.stringify(store.peek(TENANT, CONVERSATION));
    expect(serialized).not.toContain('vendor-capacity-exhausted');
    // And completeness is untouched: a Core decision is not a discovery fact.
    expect(store.peek(TENANT, CONVERSATION)?.discovery.completeness).toBe(
      'SUFFICIENT_FOR_CORE_REVIEW',
    );
  });
});

// ---------------------------------------------------------------------------
// The indeterminate submit.
// ---------------------------------------------------------------------------

describe('an indeterminate submit is recovered by asking, never by asking again', () => {
  it('a rejected submit takes exactly ONE recovery lookup and never submits twice', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [
        notFound(),
        { contractVersion: 1, idempotencyKey: KEY, status: 'FOUND', result: accepted() },
      ],
      submit: [REJECT],
    });
    const { service, availabilityReader } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('COMPLETE');
    expect(port.submits()).toBe(1);
    expect(port.lookups()).toBe(2);
    expect(port.seenLookups()[1]?.idempotencyKey).toBe(KEY);
    // Nothing else re-ran.
    expect(port.reads()).toBe(1);
    expect(availabilityReader.calls()).toBe(1);
  });

  it('an UNPARSEABLE direct result takes the same single recovery', async () => {
    // Same fact as a rejected promise: the mutation may already have happened and we cannot tell.
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [
        notFound(),
        { contractVersion: 1, idempotencyKey: KEY, status: 'FOUND', result: accepted() },
      ],
      submit: [{ contractVersion: 1, outcome: 'ACCEPTED' }],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    expect((await service.submitConfirmedIntake(action())).disposition).toBe('APPLIED');
    expect(port.submits()).toBe(1);
    expect(port.lookups()).toBe(2);
  });

  it('a recovery lookup that reports NOT_FOUND is INDETERMINATE, not "never submitted"', async () => {
    // Core may simply not have finished recording a submission it accepted. Reading this as "safe to
    // retry" is exactly how the duplicate gets created.
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound(), notFound()],
      submit: [REJECT],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    expect(await service.submitConfirmedIntake(action())).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'SUBMISSION_INDETERMINATE',
    });
    expect(port.submits()).toBe(1);
    expect(port.lookups()).toBe(2);
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('a recovery lookup that throws, is malformed or names another key is INDETERMINATE', async () => {
    for (const recovery of [
      REJECT,
      'nope',
      { contractVersion: 1, idempotencyKey: `riya-intake.${'e'.repeat(64)}`, status: 'NOT_FOUND' },
    ]) {
      const store = seededStore(AT_CONSENT());
      const port = queuedCoreIntakePort({
        read: [coreState()],
        lookup: [notFound(), recovery],
        submit: [REJECT],
      });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      expect(await service.submitConfirmedIntake(action())).toMatchObject({
        disposition: 'NOT_READY',
        reasonCode: 'SUBMISSION_INDETERMINATE',
      });
      expect(port.submits()).toBe(1);
      expect(port.lookups()).toBe(2);
    }
  });

  it('a recovery FOUND non-accepted result maps normally', async () => {
    const store = seededStore(AT_CONSENT());
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [
        notFound(),
        {
          contractVersion: 1,
          idempotencyKey: KEY,
          status: 'FOUND',
          result: nonAccepted('REJECTED'),
        },
      ],
      submit: [REJECT],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    expect(await service.submitConfirmedIntake(action())).toMatchObject({
      disposition: 'REFUSED',
      reasonCode: 'CORE_REJECTED',
    });
    expect(port.submits()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The accepted-result reconciliation.
// ---------------------------------------------------------------------------

describe('an accepted result is reconciled, never re-submitted', () => {
  function acceptedRun(store: InMemoryContinuityStore) {
    const port = queuedCoreIntakePort({
      read: [coreState()],
      lookup: [notFound()],
      submit: [accepted()],
    });
    const built = build({ continuityStore: store, coreIntakePort: port });
    return { ...built, port };
  }

  it('a winner that already reached COMPLETE with the SAME evidence is APPLIED, with no second write', async () => {
    const store = new ConflictOnceStore();
    store.seed(AT_CONSENT());
    const { service, port } = acceptedRun(store);
    // The concurrent winner lands between this action's load and its compare-and-set.
    const original = store.compareAndSet.bind(store);
    store.compareAndSet = (input) => {
      store.seed(
        continuityAt('COMPLETE', { continuityRevision: 5, completionEvidenceRef: EVIDENCE }),
      );
      return original(input);
    };
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('COMPLETE');
    expect(outcome.continuity?.continuityRevision).toBe(5);
    expect(outcome.continuity?.completionEvidenceRef).toBe(EVIDENCE);
    // ONE reload, ONE compare-and-set attempt, and nothing external repeated.
    expect(store.calls.load).toBe(2);
    expect(store.calls.compareAndSet).toBe(1);
    expect(port.reads()).toBe(1);
    expect(port.lookups()).toBe(1);
    expect(port.submits()).toBe(1);
  });

  it('a COMPLETE carrying SOMEBODY ELSE’s evidence is a CONFLICT', async () => {
    const store = new ConflictOnceStore();
    store.seed(AT_CONSENT());
    const { service } = acceptedRun(store);
    const original = store.compareAndSet.bind(store);
    store.compareAndSet = (input) => {
      store.seed(
        continuityAt('COMPLETE', {
          continuityRevision: 5,
          completionEvidenceRef: 'core.intake.evidence.someone-else',
        }),
      );
      return original(input);
    };
    expect(await service.submitConfirmedIntake(action())).toMatchObject({
      disposition: 'CONFLICT',
      reasonCode: 'CONTINUITY_CONFLICT',
    });
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('a latest still at CONSENT with the SAME business identity gets ONE second attempt', async () => {
    const store = new ConflictOnceStore();
    store.seed(AT_CONSENT());
    const { service, port } = acceptedRun(store);
    const original = store.compareAndSet.bind(store);
    let swapped = false;
    store.compareAndSet = (input) => {
      if (!swapped) {
        swapped = true;
        // A concurrent turn moved the revision without changing the business identity -- exactly the
        // case the deterministic key is designed to survive.
        store.seed(continuityAt('CONSENT', { continuityRevision: 5 }));
      }
      return original(input);
    };
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('COMPLETE');
    expect(outcome.continuity?.continuityRevision).toBe(6);
    expect(outcome.continuity?.completionEvidenceRef).toBe(EVIDENCE);
    expect(store.calls.load).toBe(2);
    expect(store.calls.compareAndSet).toBe(2);
    // Core was not consulted again for any of it.
    expect(port.reads()).toBe(1);
    expect(port.lookups()).toBe(1);
    expect(port.submits()).toBe(1);
  });

  it('a latest at CONSENT whose BUSINESS IDENTITY changed is a CONFLICT, with no second attempt', async () => {
    const store = new ConflictOnceStore();
    store.seed(AT_CONSENT());
    const { service } = acceptedRun(store);
    const original = store.compareAndSet.bind(store);
    store.compareAndSet = (input) => {
      // The city moved. The conversation Core accepted is not the conversation in front of us.
      store.seed(continuityAt('CONSENT', { continuityRevision: 5, locationRef: 'city.beta' }));
      return original(input);
    };
    expect(await service.submitConfirmedIntake(action())).toMatchObject({
      disposition: 'CONFLICT',
      reasonCode: 'CONTINUITY_CONFLICT',
    });
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('a latest in any OTHER phase is a CONFLICT', async () => {
    const store = new ConflictOnceStore();
    store.seed(AT_CONSENT());
    const { service } = acceptedRun(store);
    const original = store.compareAndSet.bind(store);
    store.compareAndSet = (input) => {
      store.seed(continuityAt('SUMMARY', { continuityRevision: 5, summaryConfirmed: false }));
      return original(input);
    };
    expect(await service.submitConfirmedIntake(action())).toMatchObject({
      disposition: 'CONFLICT',
      reasonCode: 'CONTINUITY_CONFLICT',
    });
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('losing the SECOND attempt is a CONFLICT, and there is no third', async () => {
    const store = new ConflictOnceStore(2);
    store.seed(AT_CONSENT());
    const { service, port } = acceptedRun(store);
    const outcome = await service.submitConfirmedIntake(action());
    expect(outcome).toMatchObject({ disposition: 'CONFLICT', reasonCode: 'CONTINUITY_CONFLICT' });
    expect(store.calls.compareAndSet).toBe(2);
    expect(store.calls.load).toBe(2);
    expect(port.submits()).toBe(1);
  });
});

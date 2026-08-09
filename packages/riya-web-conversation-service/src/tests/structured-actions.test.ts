/**
 * RWC-P6B — action contracts, summary edit, summary confirm and the contact advance (ADR-0102).
 *
 * The theme running through all four: **nothing outbound happens before this service knows exactly
 * which conversation, at exactly which revision, it is acting on.** Most of the specs below therefore
 * assert a COUNT — availability reads, Core reads, compare-and-sets — because the interesting failures
 * are not wrong answers, they are extra calls.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import type { ScriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import { RiyaWebConversationError } from '../contracts/errors.js';
import {
  RIYA_STRUCTURED_ACTION_DISPOSITIONS,
  RIYA_STRUCTURED_ACTION_REASON_CODES,
} from '../contracts/structured-action-result.js';
import { createRiyaStructuredActionService } from '../service/create-structured-action-service.js';
import type { RiyaStructuredActionServiceConfig } from '../service/create-structured-action-service.js';
import {
  InMemoryContinuityStore,
  UnavailableContinuityStore,
} from './fakes/in-memory-continuity-store.js';
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

const EDIT = {
  version: 1 as const,
  edits: [{ field: 'location' as const, operation: 'SET' as const, value: 'city.beta' }],
};

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
  const continuityStore = over.continuityStore ?? new InMemoryContinuityStore();
  const availabilityReader = over.availabilityReader ?? scriptedAvailabilityReader();
  const coreIntakePort = over.coreIntakePort ?? queuedCoreIntakePort({ read: [coreState()] });
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

const identity = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 1,
  tenantId: TENANT,
  conversationId: CONVERSATION,
  expectedContinuityRevision: 4,
  actionRef: ACTION_REF,
  ...over,
});

// ---------------------------------------------------------------------------
// Construction and the action contracts.
// ---------------------------------------------------------------------------

describe('construction fails closed, and does not touch the text-turn config', () => {
  it('requires all three collaborators', () => {
    const full = {
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      coreIntakePort: queuedCoreIntakePort({}),
    };
    expect(() => createRiyaStructuredActionService(full)).not.toThrow();
    for (const missing of ['continuityStore', 'availabilityReader', 'coreIntakePort']) {
      const partialConfig = Object.fromEntries(
        Object.entries(full).filter(([name]) => name !== missing),
      ) as unknown as RiyaStructuredActionServiceConfig;
      expect(() => createRiyaStructuredActionService(partialConfig), missing).toThrow(
        RiyaWebConversationError,
      );
    }
  });

  it('refuses a Core port missing any one method', () => {
    const complete = queuedCoreIntakePort({});
    for (const missing of ['readCurrent', 'lookupSubmission', 'submit']) {
      const port = Object.fromEntries(
        Object.entries(complete).filter(([name]) => name !== missing),
      ) as never;
      expect(
        () =>
          createRiyaStructuredActionService({
            continuityStore: new InMemoryContinuityStore(),
            availabilityReader: scriptedAvailabilityReader(),
            coreIntakePort: port,
          }),
        missing,
      ).toThrow(RiyaWebConversationError);
    }
  });

  it('needs NO runtime and no runtimeId', () => {
    // The separation this slice is built on. A conversational deployment must not have to supply a
    // Core adapter it never calls, and a structured surface must not have to compose a runtime.
    const service = createRiyaStructuredActionService({
      continuityStore: new InMemoryContinuityStore(),
      availabilityReader: scriptedAvailabilityReader(),
      coreIntakePort: queuedCoreIntakePort({}),
    });
    expect(Object.keys(service).sort()).toStrictEqual([
      'advanceContact',
      'confirmSummary',
      'editSummary',
      'submitConfirmedIntake',
    ]);
  });
});

describe('the action schemas are strict, and a caller may state nothing it should not', () => {
  const store = () => seededStore(continuityAt('SUMMARY', { summaryConfirmed: false }));

  it('refuses malformed identity on every action', async () => {
    const bad = [
      identity({ version: 2 }),
      identity({ tenantId: '' }),
      identity({ tenantId: 'client@example.com' }),
      identity({ conversationId: 'has spaces' }),
      identity({ conversationId: 'x'.repeat(129) }),
      identity({ expectedContinuityRevision: -1 }),
      identity({ expectedContinuityRevision: 1.5 }),
      identity({ expectedContinuityRevision: '4' }),
      identity({ actionRef: '' }),
    ];
    const { service } = build({ continuityStore: store() });
    await Promise.all(
      bad.map(async (value) => {
        await expect(service.confirmSummary(value as never)).rejects.toBeInstanceOf(
          RiyaWebConversationError,
        );
      }),
    );
  });

  const forbidden: Record<string, Record<string, unknown>> = {
    'a phase': { phase: 'COMPLETE' },
    'a provenance': { provenance: 'user_confirmed' },
    'a summaryConfirmed flag': { summaryConfirmed: true },
    'a consent claim': { consentGranted: true },
    'an idempotency key': { idempotencyKey: `riya-intake.${'a'.repeat(64)}` },
    'an availability snapshot': { availabilitySnapshotRef: 'snap.1' },
    'a Core intake state': { intakeStateRef: 'core.intake.state.1' },
    'completion evidence': { completionEvidenceRef: 'core.intake.evidence.1' },
    'raw text': { normalizedText: 'yes please' },
    'a lead reference': { leadRef: 'lead.1' },
    'a canSubmit claim': { canSubmit: true },
  };
  for (const [label, extra] of Object.entries(forbidden)) {
    it(`refuses ${label}`, async () => {
      const { service } = build({ continuityStore: store() });
      await expect(service.confirmSummary(identity(extra) as never)).rejects.toBeInstanceOf(
        RiyaWebConversationError,
      );
    });
  }

  it('the Core-dependent actions require subjectRef; the summary actions forbid it', async () => {
    const { service } = build({ continuityStore: store() });
    await expect(service.advanceContact(identity() as never)).rejects.toBeInstanceOf(
      RiyaWebConversationError,
    );
    await expect(
      service.confirmSummary(identity({ subjectRef: SUBJECT }) as never),
    ).rejects.toBeInstanceOf(RiyaWebConversationError);
  });

  it('a malformed edit payload is an invalid input, not a refusal', async () => {
    const { service } = build({ continuityStore: store() });
    for (const edit of [
      { version: 1, edits: [] },
      { version: 1, edits: [{ field: 'location', operation: 'SET' }] },
      // A caller choosing provenance is the authority RWC-P4A and P4B spent two slices keeping away
      // from inference.
      {
        version: 1,
        edits: [
          { field: 'location', operation: 'SET', value: 'city.beta', provenance: 'user_confirmed' },
        ],
      },
      {
        version: 1,
        edits: [{ field: 'location', operation: 'SET', value: 'city.beta' }],
        skipProjectDetails: true,
      },
    ]) {
      await expect(
        service.editSummary(identity({ edit }) as never),
        JSON.stringify(edit),
      ).rejects.toBeInstanceOf(RiyaWebConversationError);
    }
  });

  it('the vocabularies are closed and frozen', () => {
    expect([...RIYA_STRUCTURED_ACTION_DISPOSITIONS]).toStrictEqual([
      'APPLIED',
      'NOT_READY',
      'REFUSED',
      'CONFLICT',
    ]);
    expect(Object.isFrozen(RIYA_STRUCTURED_ACTION_DISPOSITIONS)).toBe(true);
    expect([...RIYA_STRUCTURED_ACTION_REASON_CODES]).toStrictEqual([
      'CONTINUITY_NOT_FOUND',
      'STALE_REVISION',
      'ACTION_NOT_PERMITTED',
      'AUTHORITY_UNAVAILABLE',
      'AUTHORITY_MISMATCH',
      'AVAILABILITY_CHANGED',
      'CONTACT_MISSING',
      'CONSENT_MISSING',
      'CONSENT_DECLINED',
      'CONSENT_OPTED_OUT',
      'CORE_NOT_READY',
      'CORE_REJECTED',
      'HUMAN_REVIEW_REQUIRED',
      'CONTINUITY_CONFLICT',
      'SUBMISSION_INDETERMINATE',
    ]);
    expect(Object.isFrozen(RIYA_STRUCTURED_ACTION_REASON_CODES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Loading, before anything outbound.
// ---------------------------------------------------------------------------

describe('nothing outbound happens before the exact conversation and revision are known', () => {
  it('an absent conversation is NOT_READY, and creates nothing', async () => {
    const { service, continuityStore, availabilityReader, coreIntakePort } = build();
    const outcome = await service.confirmSummary(identity() as never);
    expect(outcome).toStrictEqual({
      version: 1,
      disposition: 'NOT_READY',
      reasonCode: 'CONTINUITY_NOT_FOUND',
    });
    // No continuity at all in the result: reporting a fabricated one would be this service inventing
    // the conversation it just refused to create.
    expect('continuity' in outcome).toBe(false);
    expect(continuityStore.calls.createInitialIfAbsent).toBe(0);
    expect(continuityStore.size).toBe(0);
    expect(availabilityReader.calls()).toBe(0);
    expect(coreIntakePort.reads()).toBe(0);
    expect(continuityStore.calls.compareAndSet).toBe(0);
  });

  it('a stale revision is a CONFLICT with ZERO authority calls and ZERO writes', async () => {
    const seeded = continuityAt('SUMMARY', { summaryConfirmed: false, continuityRevision: 9 });
    const { service, continuityStore, availabilityReader, coreIntakePort } = build({
      continuityStore: seededStore(seeded),
    });
    for (const run of [
      () => service.confirmSummary(identity() as never),
      () => service.editSummary(identity({ edit: EDIT }) as never),
      () => service.advanceContact(identity({ subjectRef: SUBJECT }) as never),
      () => service.submitConfirmedIntake(identity({ subjectRef: SUBJECT }) as never),
    ]) {
      const outcome = await run();
      expect(outcome.disposition).toBe('CONFLICT');
      expect(outcome.reasonCode).toBe('STALE_REVISION');
      expect(outcome.continuity?.continuityRevision).toBe(9);
    }
    expect(availabilityReader.calls()).toBe(0);
    expect(coreIntakePort.reads()).toBe(0);
    expect(coreIntakePort.lookups()).toBe(0);
    expect(coreIntakePort.submits()).toBe(0);
    expect(continuityStore.calls.compareAndSet).toBe(0);
  });

  it('an unavailable store fails closed and never becomes a served action', async () => {
    // Cast because the harness is typed on the counting fake; this store deliberately has no
    // counters, because nothing it is asked ever succeeds.
    const { service } = build({
      continuityStore: new UnavailableContinuityStore() as unknown as InMemoryContinuityStore,
    });
    await expect(service.confirmSummary(identity() as never)).rejects.toMatchObject({
      code: 'continuity-unavailable',
    });
  });
});

// ---------------------------------------------------------------------------
// Structured summary edit.
// ---------------------------------------------------------------------------

describe('structured summary edit', () => {
  const atSummary = () => continuityAt('SUMMARY', { summaryConfirmed: false });

  it('applies through the REAL P6A path with ONE availability read and ONE compare-and-set', async () => {
    const store = seededStore(atSummary());
    const { service, availabilityReader, coreIntakePort } = build({ continuityStore: store });
    const outcome = await service.editSummary(
      identity({
        edit: {
          version: 1,
          edits: [{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }],
        },
      }) as never,
    );
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.reasonCode).toBeUndefined();
    expect(outcome.continuity?.discovery.budgetNote).toBe('around 12 lakh');
    // Stamped by RWC-P6A, never chosen by the caller.
    expect(outcome.continuity?.fieldProvenance.budget).toBe('user_confirmed');
    expect(outcome.continuity?.continuityRevision).toBe(5);
    expect(availabilityReader.calls()).toBe(1);
    expect(store.calls.compareAndSet).toBe(1);
    expect(store.peek(TENANT, CONVERSATION)?.discovery.budgetNote).toBe('around 12 lakh');
    // Zero Core intake involvement: an edit is not a submission.
    expect(coreIntakePort.reads() + coreIntakePort.lookups() + coreIntakePort.submits()).toBe(0);
  });

  it('an edit that restates what is already there spends no revision and no write', async () => {
    const store = seededStore(atSummary());
    const { service } = build({ continuityStore: store });
    const first = await service.editSummary(
      identity({
        edit: {
          version: 1,
          edits: [{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }],
        },
      }) as never,
    );
    expect(first.continuity?.continuityRevision).toBe(5);
    const again = await service.editSummary(
      identity({
        expectedContinuityRevision: 5,
        edit: {
          version: 1,
          edits: [{ field: 'budget', operation: 'SET', value: 'around 12 lakh' }],
        },
      }) as never,
    );
    expect(again.disposition).toBe('APPLIED');
    expect(again.continuity?.continuityRevision).toBe(5);
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('an edit naming a service or city Core no longer lists is AVAILABILITY_CHANGED', async () => {
    const store = seededStore(atSummary());
    const { service } = build({ continuityStore: store });
    // `svc.two` is sold in `city.alpha` only, so moving the conversation to `city.beta` while it wants
    // `svc.two` is exactly the pair the shared P5 policy refuses.
    const toUnknownCity = await service.editSummary(
      identity({
        edit: { version: 1, edits: [{ field: 'location', operation: 'SET', value: 'city.gamma' }] },
      }) as never,
    );
    expect(toUnknownCity).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AVAILABILITY_CHANGED',
    });
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('an edit producing an UNAVAILABLE PAIR is refused even though each value is active', async () => {
    // The rule RWC-P5 exists for, reached without a model: an active city plus an active service does
    // not imply the pair.
    const store = seededStore(
      continuityAt('SUMMARY', { summaryConfirmed: false, serviceInterestRef: 'svc.two' }),
    );
    const { service } = build({ continuityStore: store });
    const outcome = await service.editSummary(
      identity({
        edit: { version: 1, edits: [{ field: 'location', operation: 'SET', value: 'city.beta' }] },
      }) as never,
    );
    expect(outcome).toMatchObject({ disposition: 'NOT_READY', reasonCode: 'AVAILABILITY_CHANGED' });
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('an unavailable or unprovable authority is NOT_READY, and writes nothing', async () => {
    for (const reader of [
      scriptedAvailabilityReader({ rejects: true }),
      scriptedAvailabilityReader({ returns: { version: 1, snapshotRef: 'snap.1' } }),
      scriptedAvailabilityReader({ returns: 'not a snapshot' }),
    ]) {
      const store = seededStore(atSummary());
      const { service } = build({ continuityStore: store, availabilityReader: reader });
      const outcome = await service.editSummary(identity({ edit: EDIT }) as never);
      expect(outcome).toMatchObject({
        disposition: 'NOT_READY',
        reasonCode: 'AUTHORITY_UNAVAILABLE',
      });
      expect(store.calls.compareAndSet).toBe(0);
    }
  });

  it('editing outside SUMMARY is a REFUSAL, not an availability problem', async () => {
    const store = seededStore(continuityAt('CONSENT'));
    const { service } = build({ continuityStore: store });
    const outcome = await service.editSummary(identity({ edit: EDIT }) as never);
    expect(outcome).toMatchObject({ disposition: 'REFUSED', reasonCode: 'ACTION_NOT_PERMITTED' });
  });

  it('a lost compare-and-set is a CONFLICT with no reload and no second attempt', async () => {
    const store = new ConflictOnceStore();
    store.seed(atSummary());
    const { service } = build({ continuityStore: store });
    const outcome = await service.editSummary(identity({ edit: EDIT }) as never);
    expect(outcome).toMatchObject({ disposition: 'CONFLICT', reasonCode: 'CONTINUITY_CONFLICT' });
    expect(store.calls.compareAndSet).toBe(1);
    // ONE load: the initial one. RWC-P4B reloads because observations stay true against a newer
    // state; an edit is a statement about a summary that no longer exists.
    expect(store.calls.load).toBe(1);
  });

  it('a compare-and-set NOT_FOUND on a row this action loaded is a repository invariant', async () => {
    const store = seededStore(atSummary());
    const { service } = build({ continuityStore: store });
    // Delete the row between the load and the write by racing a second store view: the in-memory fake
    // reports NOT_FOUND for a key it does not hold.
    const vanishing = {
      load: store.load.bind(store),
      createInitialIfAbsent: store.createInitialIfAbsent.bind(store),
      compareAndSet: () => Promise.resolve('NOT_FOUND' as const),
    };
    const { service: racing } = build({
      continuityStore: vanishing as unknown as InMemoryContinuityStore,
    });
    void service;
    await expect(racing.editSummary(identity({ edit: EDIT }) as never)).rejects.toMatchObject({
      code: 'repository-invariant',
    });
  });
});

// ---------------------------------------------------------------------------
// Structured summary confirmation.
// ---------------------------------------------------------------------------

describe('structured summary confirmation', () => {
  const atSummary = (over = {}) => continuityAt('SUMMARY', { summaryConfirmed: false, ...over });

  it('moves to CONTACT at exactly expected + 1, with one read and one write', async () => {
    const store = seededStore(atSummary());
    const { service, availabilityReader, coreIntakePort } = build({ continuityStore: store });
    const outcome = await service.confirmSummary(identity() as never);
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('CONTACT');
    expect(outcome.continuity?.summaryConfirmed).toBe(true);
    expect(outcome.continuity?.continuityRevision).toBe(5);
    // Every PRESENT value strengthened, and no absent one.
    expect(outcome.continuity?.fieldProvenance).toStrictEqual({
      serviceInterest: 'user_confirmed',
      location: 'user_confirmed',
      budget: 'user_confirmed',
      timeline: 'user_confirmed',
    });
    expect(availabilityReader.calls()).toBe(1);
    expect(store.calls.compareAndSet).toBe(1);
    expect(coreIntakePort.reads() + coreIntakePort.lookups() + coreIntakePort.submits()).toBe(0);
  });

  it('confirming an already-confirmed summary is refused', async () => {
    const store = seededStore(continuityAt('CONTACT'));
    const { service } = build({ continuityStore: store });
    const outcome = await service.confirmSummary(identity() as never);
    expect(outcome).toMatchObject({ disposition: 'REFUSED', reasonCode: 'ACTION_NOT_PERMITTED' });
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('human review is never overruled', async () => {
    const store = seededStore(atSummary({ completeness: 'HUMAN_REVIEW_REQUIRED' }));
    const { service } = build({ continuityStore: store });
    const outcome = await service.confirmSummary(identity() as never);
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'HUMAN_REVIEW_REQUIRED',
    });
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('a pair Core has stopped selling blocks the confirmation', async () => {
    const store = seededStore(
      atSummary({ serviceInterestRef: 'svc.two', locationRef: 'city.beta' }),
    );
    const { service } = build({ continuityStore: store });
    const outcome = await service.confirmSummary(identity() as never);
    expect(outcome).toMatchObject({
      disposition: 'NOT_READY',
      reasonCode: 'AVAILABILITY_CHANGED',
    });
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('a lost compare-and-set NEVER confirms a newer summary the client did not see', async () => {
    const store = new ConflictOnceStore();
    store.seed(atSummary());
    const { service, availabilityReader } = build({ continuityStore: store });
    const outcome = await service.confirmSummary(identity() as never);
    expect(outcome).toMatchObject({ disposition: 'CONFLICT', reasonCode: 'CONTINUITY_CONFLICT' });
    expect(store.calls.compareAndSet).toBe(1);
    expect(store.calls.load).toBe(1);
    expect(availabilityReader.calls()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CONTACT -> CONSENT.
// ---------------------------------------------------------------------------

describe('the contact advance', () => {
  const atContact = (over = {}) => continuityAt('CONTACT', over);
  const contactAction = () => identity({ subjectRef: SUBJECT }) as never;

  it('advances on READY, reads Core exactly once, and reads no availability at all', async () => {
    const store = seededStore(atContact());
    const port = queuedCoreIntakePort({ read: [coreState()] });
    const { service, availabilityReader } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.advanceContact(contactAction());
    expect(outcome.disposition).toBe('APPLIED');
    expect(outcome.continuity?.phase).toBe('CONSENT');
    expect(outcome.continuity?.continuityRevision).toBe(5);
    expect(port.reads()).toBe(1);
    expect(port.seenReads()[0]).toStrictEqual({
      tenantId: TENANT,
      conversationId: CONVERSATION,
      subjectRef: SUBJECT,
    });
    // Whether Core holds a phone number has nothing to do with which cities the business serves.
    expect(availabilityReader.calls()).toBe(0);
    expect(port.lookups() + port.submits()).toBe(0);
    expect(store.calls.compareAndSet).toBe(1);
  });

  it('the contact evidence reaches no result and no stored state', async () => {
    const store = seededStore(atContact());
    const port = queuedCoreIntakePort({
      read: [coreState({ contact: { state: 'READY', evidenceRef: 'core.contact.secret1' } })],
    });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.advanceContact(contactAction());
    const serialized = JSON.stringify(outcome) + JSON.stringify(store.peek(TENANT, CONVERSATION));
    expect(serialized).not.toContain('core.contact.secret1');
    expect(serialized).not.toContain('evidenceRef');
  });

  it('a Core answer about the wrong scope stops the action, with NO second Core call', async () => {
    for (const wrong of [
      coreState({ tenantId: 'tenant.z' }),
      coreState({ conversationId: 'conv.999' }),
      coreState({ subjectRef: 'subject.999' }),
    ]) {
      const store = seededStore(atContact());
      const port = queuedCoreIntakePort({ read: [wrong] });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      const outcome = await service.advanceContact(contactAction());
      expect(outcome).toMatchObject({
        disposition: 'NOT_READY',
        reasonCode: 'AUTHORITY_MISMATCH',
      });
      // Retrying a source that answered about the wrong conversation is how a composition talks
      // itself into believing the second answer.
      expect(port.reads()).toBe(1);
      expect(store.calls.compareAndSet).toBe(0);
    }
  });

  it('a Core port that throws or answers malformed is NOT_READY / AUTHORITY_UNAVAILABLE', async () => {
    for (const scripted of [
      REJECT,
      { version: 1 },
      'nope',
      coreState({ contact: { state: 'READY' } }),
    ]) {
      const store = seededStore(atContact());
      const port = queuedCoreIntakePort({ read: [scripted] });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      const outcome = await service.advanceContact(contactAction());
      expect(outcome).toMatchObject({
        disposition: 'NOT_READY',
        reasonCode: 'AUTHORITY_UNAVAILABLE',
      });
      expect(store.calls.compareAndSet).toBe(0);
    }
  });

  it('MISSING contact holds the conversation at CONTACT', async () => {
    const store = seededStore(atContact());
    const port = queuedCoreIntakePort({ read: [coreState({ contact: { state: 'MISSING' } })] });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.advanceContact(contactAction());
    expect(outcome).toMatchObject({ disposition: 'NOT_READY', reasonCode: 'CONTACT_MISSING' });
    expect(outcome.continuity?.phase).toBe('CONTACT');
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('the consent state does NOT block the advance itself', async () => {
    // Reaching the consent step is not the same as passing it. The submission is where consent is
    // evaluated, and refusing here would hide a declined intake behind a phase that never moved.
    for (const consent of [
      { state: 'MISSING' },
      { state: 'DECLINED', evidenceRef: 'core.consent.1' },
      { state: 'OPTED_OUT', evidenceRef: 'core.consent.1' },
    ]) {
      const store = seededStore(atContact());
      const port = queuedCoreIntakePort({ read: [coreState({ consent })] });
      const { service } = build({ continuityStore: store, coreIntakePort: port });
      const outcome = await service.advanceContact(contactAction());
      expect(outcome.disposition, JSON.stringify(consent)).toBe('APPLIED');
      expect(outcome.continuity?.phase).toBe('CONSENT');
    }
  });

  it('advancing from the wrong phase is refused before any write', async () => {
    const store = seededStore(continuityAt('SUMMARY', { summaryConfirmed: false }));
    const port = queuedCoreIntakePort({ read: [coreState()] });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.advanceContact(contactAction());
    expect(outcome).toMatchObject({ disposition: 'REFUSED', reasonCode: 'ACTION_NOT_PERMITTED' });
    expect(store.calls.compareAndSet).toBe(0);
  });

  it('a lost compare-and-set is a CONFLICT with no reload', async () => {
    const store = new ConflictOnceStore();
    store.seed(atContact());
    const port = queuedCoreIntakePort({ read: [coreState()] });
    const { service } = build({ continuityStore: store, coreIntakePort: port });
    const outcome = await service.advanceContact(contactAction());
    expect(outcome).toMatchObject({ disposition: 'CONFLICT', reasonCode: 'CONTINUITY_CONFLICT' });
    expect(store.calls.compareAndSet).toBe(1);
    expect(store.calls.load).toBe(1);
    expect(port.reads()).toBe(1);
  });
});

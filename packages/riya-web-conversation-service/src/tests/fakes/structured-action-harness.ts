/**
 * Deterministic setup for the RWC-P6B structured-action specs. TEST-ONLY.
 *
 * `src/tests/**` is excluded from `tsconfig.build.json`, so nothing here can reach `dist/`. That
 * matters more for this harness than for most: it contains a Core intake port that says "contact
 * ready, consent granted", which as a production default would submit enquiries nobody agreed to.
 *
 * Everything is synthetic. No real subject, no real city, no network and no contact detail.
 */
import type {
  CoreRiyaIntakeLookupInput,
  CoreRiyaIntakePort,
  CoreRiyaIntakeReadInput,
  CoreRiyaIntakeSubmissionRequestV1,
} from '@qf-jarvis/core-riya-intake';
import { syntheticAvailabilitySnapshot } from '@qf-jarvis/core-service-availability-read/testing';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
} from '@qf-jarvis/riya-conversation-continuity';

import { InMemoryContinuityStore } from './in-memory-continuity-store.js';

export const TENANT = 'tenant.a';
export const CONVERSATION = 'conv.1';
export const SUBJECT = 'subject.1';
export const ACTION_REF = 'action.1';

/** The canonical availability the specs run against: `svc.one` everywhere, `svc.two` in Alpha only. */
export const SNAPSHOT = syntheticAvailabilitySnapshot();

/**
 * A conversation that has reached the summary, with all four required values present.
 *
 * Built through the REAL RWC-P2A constructor rather than assembled by hand: a hand-built state would
 * bypass every invariant the constructor enforces, and the specs below assert behaviour that depends
 * on those invariants holding.
 */
export function continuityAt(
  phase: RiyaConversationPhase,
  over: {
    readonly continuityRevision?: number;
    readonly summaryConfirmed?: boolean;
    readonly serviceInterestRef?: string;
    readonly locationRef?: string;
    readonly budgetNote?: string;
    readonly timelineNote?: string;
    // The three OPTIONAL discovery slots. Absent from the default fixture on purpose -- a summary
    // needs only the four required values -- and overridable so the idempotency specs can prove each
    // one independently changes the derived key.
    readonly propertyTypeRef?: string;
    readonly scopeSummary?: string;
    readonly consultationPreferenceRef?: string;
    readonly completeness?:
      'MORE_DISCOVERY_REQUIRED' | 'SUFFICIENT_FOR_CORE_REVIEW' | 'HUMAN_REVIEW_REQUIRED';
    readonly completionEvidenceRef?: string;
    readonly tenantId?: string;
    readonly conversationId?: string;
  } = {},
): RiyaConversationContinuityStateV1 {
  const confirmed = over.summaryConfirmed ?? phase !== 'SUMMARY';
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: over.tenantId ?? TENANT,
    conversationId: over.conversationId ?? CONVERSATION,
    continuityRevision: over.continuityRevision ?? 4,
    phase,
    discovery: {
      serviceInterestRef: over.serviceInterestRef ?? 'svc.one',
      locationRef: over.locationRef ?? 'city.alpha',
      budgetNote: over.budgetNote ?? 'around 8 lakh',
      timelineNote: over.timelineNote ?? 'next month',
      // Omitted rather than passed as `undefined`: under `exactOptionalPropertyTypes` an own key
      // holding `undefined` is a different object from one where the field is absent, and absence is
      // what the default fixture is asserting about these three.
      ...(over.propertyTypeRef === undefined ? {} : { propertyTypeRef: over.propertyTypeRef }),
      ...(over.scopeSummary === undefined ? {} : { scopeSummary: over.scopeSummary }),
      ...(over.consultationPreferenceRef === undefined
        ? {}
        : { consultationPreferenceRef: over.consultationPreferenceRef }),
      completeness: over.completeness ?? 'SUFFICIENT_FOR_CORE_REVIEW',
    },
    // Derived from what is actually PRESENT, not hard-coded: RWC-P2A refuses a state whose
    // provenance and discovery disagree, so an optional slot supplied above must bring its own
    // provenance with it. Hard-coding four entries would make every optional-slot fixture fail on an
    // invariant that has nothing to do with what it is testing.
    fieldProvenance: {
      serviceInterest: 'user_stated',
      location: 'user_stated',
      budget: 'user_stated',
      timeline: 'user_stated',
      ...(over.propertyTypeRef === undefined ? {} : { propertyType: 'user_stated' as const }),
      ...(over.scopeSummary === undefined ? {} : { scope: 'user_stated' as const }),
      ...(over.consultationPreferenceRef === undefined
        ? {}
        : { consultationPreference: 'user_stated' as const }),
    },
    summaryConfirmed: confirmed,
    ...(over.completionEvidenceRef === undefined
      ? {}
      : { completionEvidenceRef: over.completionEvidenceRef }),
  });
}

/** A store seeded with one conversation. */
export function seededStore(state: RiyaConversationContinuityStateV1): InMemoryContinuityStore {
  const store = new InMemoryContinuityStore();
  store.seed(state);
  return store;
}

/**
 * A Core intake port whose answers are QUEUED, so a spec can give the first lookup one answer and the
 * recovery lookup another.
 *
 * Each entry is either a raw value to resolve or a marker to reject with. Raw, so the malformed paths
 * stay reachable — a fake that could only return canonical values would prove only that the service
 * agrees with a fixture.
 */
export const REJECT: unique symbol = Symbol('reject');

/** Deliberately `unknown`: the malformed paths are only reachable if a spec may script a raw value. */
export type Scripted = unknown;

export type QueuedCoreIntakePort = CoreRiyaIntakePort & {
  reads(): number;
  lookups(): number;
  submits(): number;
  seenReads(): readonly CoreRiyaIntakeReadInput[];
  seenLookups(): readonly CoreRiyaIntakeLookupInput[];
  seenSubmissions(): readonly CoreRiyaIntakeSubmissionRequestV1[];
};

export function queuedCoreIntakePort(script: {
  readonly read?: readonly Scripted[];
  readonly lookup?: readonly Scripted[];
  readonly submit?: readonly Scripted[];
}): QueuedCoreIntakePort {
  const readQueue = [...(script.read ?? [])];
  const lookupQueue = [...(script.lookup ?? [])];
  const submitQueue = [...(script.submit ?? [])];
  const reads: CoreRiyaIntakeReadInput[] = [];
  const lookups: CoreRiyaIntakeLookupInput[] = [];
  const submissions: CoreRiyaIntakeSubmissionRequestV1[] = [];

  // A realistic failure carries exactly the kind of detail that must never escape.
  const failure = (): Error => new Error('core intake at 10.0.0.11 — token=abc123');

  const next = (queue: Scripted[]): Promise<unknown> => {
    const value = queue.shift();
    if (value === REJECT) {
      return Promise.reject(failure());
    }
    if (value === undefined) {
      // A call the spec did not script. Louder than silently returning `undefined`, which would look
      // like a malformed answer and hide the extra call this suite exists to count.
      return Promise.reject(new Error('unscripted core intake call'));
    }
    return Promise.resolve(value);
  };

  return {
    readCurrent(input: CoreRiyaIntakeReadInput): Promise<unknown> {
      reads.push(input);
      return next(readQueue);
    },
    lookupSubmission(input: CoreRiyaIntakeLookupInput): Promise<unknown> {
      lookups.push(input);
      return next(lookupQueue);
    },
    submit(submission: CoreRiyaIntakeSubmissionRequestV1): Promise<unknown> {
      submissions.push(submission);
      return next(submitQueue);
    },
    reads: () => reads.length,
    lookups: () => lookups.length,
    submits: () => submissions.length,
    seenReads: () => reads,
    seenLookups: () => lookups,
    seenSubmissions: () => submissions,
  };
}

/** A canonical Core intake state for the harness scope. */
export function coreState(
  over: {
    readonly tenantId?: string;
    readonly conversationId?: string;
    readonly subjectRef?: string;
    readonly contact?: { readonly state: string; readonly evidenceRef?: string };
    readonly consent?: { readonly state: string; readonly evidenceRef?: string };
  } = {},
): Record<string, unknown> {
  return {
    version: 1,
    tenantId: over.tenantId ?? TENANT,
    conversationId: over.conversationId ?? CONVERSATION,
    subjectRef: over.subjectRef ?? SUBJECT,
    stateRef: 'core.intake.state.1',
    contact: over.contact ?? { state: 'READY', evidenceRef: 'core.contact.1' },
    consent: over.consent ?? { state: 'GRANTED', evidenceRef: 'core.consent.1' },
  };
}

/** A store whose FIRST compare-and-set always loses, so the reconciliation path is reachable. */
export class ConflictOnceStore extends InMemoryContinuityStore {
  #conflicts: number;

  constructor(conflicts = 1) {
    super();
    this.#conflicts = conflicts;
  }

  public override compareAndSet(input: {
    readonly expectedRevision: number;
    readonly nextState: RiyaConversationContinuityStateV1;
  }): Promise<'UPDATED' | 'REVISION_CONFLICT' | 'NOT_FOUND'> {
    if (this.#conflicts > 0) {
      this.#conflicts -= 1;
      this.calls.compareAndSet += 1;
      return Promise.resolve('REVISION_CONFLICT' as const);
    }
    return super.compareAndSet(input);
  }
}

import type {
  AosBehaviourContext,
  AosBehaviourTrigger,
  AosEvidenceFact,
  AosObservation,
  AosPriority,
} from '@qf-jarvis/aos-intelligence';
import { detectAosObservation } from '@qf-jarvis/aos-intelligence';
import type { ClientIntelligenceSnapshotV1 } from '@qf-jarvis/client-intelligence';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export interface AosClientJourneyBridgeInput {
  readonly subjectRef: string;
  readonly requirementRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly journey: ClientIntelligenceSnapshotV1['journey'];
}

export interface AosClientJourneyBridgeItem {
  readonly observation: AosObservation;
  readonly behaviour: {
    readonly trigger: AosBehaviourTrigger;
    readonly context: AosBehaviourContext;
  };
  readonly facts: readonly AosEvidenceFact[];
  readonly policyRefs: readonly string[];
}

function validInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function makeObservation(input: {
  readonly signalSuffix: string;
  readonly caseLane: string;
  readonly subjectRef: string;
  readonly requirementRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly priority: AosPriority;
  readonly reasonCode: string;
  readonly detectorType?: 'BUSINESS_EVENT' | 'OPPORTUNITY';
}): AosObservation {
  const observation: AosObservation = Object.freeze({
    kind: 'BUSINESS_EVENT' as const,
    input: Object.freeze({
      signalId: 'aos.client-journey.' + input.signalSuffix,
      detectorId: 'client-intelligence.journey',
      detectorType: input.detectorType ?? 'BUSINESS_EVENT',
      caseKey: input.subjectRef + ':' + input.caseLane + ':requirement:' + input.requirementRef,
      subjectRef: input.subjectRef,
      priority: input.priority,
      observedAt: input.observedAt,
      evidenceRefs: Object.freeze([input.evidenceRef]),
      reasonCode: input.reasonCode,
      score: 1,
    }),
  });
  // Reuse the canonical AOS validator now, so the bridge cannot return a shape
  // that the sentry would later refuse.
  void detectAosObservation(observation);
  return observation;
}

function fact(
  factId: string,
  sourceRef: string,
  observedAt: string,
  value: string | number | boolean,
): AosEvidenceFact {
  return Object.freeze({
    factId,
    kind: 'CORE_FACT' as const,
    dataClass: 'OPERATIONAL' as const,
    sourceRef,
    observedAt,
    value,
  });
}

function item(input: {
  readonly observation: AosObservation;
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
  readonly facts: readonly AosEvidenceFact[];
}): AosClientJourneyBridgeItem {
  return Object.freeze({
    observation: input.observation,
    behaviour: Object.freeze({
      trigger: input.trigger,
      context: Object.freeze({
        ...(input.context.cityRef === undefined ? {} : { cityRef: input.context.cityRef }),
        ...(input.context.localityRef === undefined
          ? {}
          : { localityRef: input.context.localityRef }),
        ...(input.context.categoryRef === undefined
          ? {}
          : { categoryRef: input.context.categoryRef }),
        metrics: Object.freeze({ ...input.context.metrics }),
      }),
    }),
    facts: Object.freeze(input.facts.map((one) => Object.freeze({ ...one }))),
    policyRefs: Object.freeze(['client-intelligence:v1']),
  });
}

/**
 * Reuse the already-built Core-owned client/vendor journey projection.
 *
 * Assignment is never treated as contact. The first-contact gap comes only from
 * Core's vendorNoContactCount / allReleasedVendorsContacted projection.
 */
export function bridgeClientJourneyToAos(
  input: AosClientJourneyBridgeInput,
): readonly AosClientJourneyBridgeItem[] {
  if (
    !REF.test(input.subjectRef) ||
    !REF.test(input.requirementRef) ||
    !REF.test(input.evidenceRef) ||
    !validInstant(input.observedAt)
  ) {
    throw new TypeError('aos-client-journey-bridge-input-invalid');
  }

  const journey = input.journey;
  if (
    !Number.isInteger(journey.vendorsReleased) ||
    !Number.isInteger(journey.vendorNoContactCount) ||
    journey.vendorsReleased < 0 ||
    journey.vendorNoContactCount < 0 ||
    journey.vendorNoContactCount > journey.vendorsReleased
  ) {
    throw new TypeError('aos-client-journey-bridge-count-invalid');
  }

  const successfulVendorContacts = Math.max(
    0,
    journey.vendorsReleased - journey.vendorNoContactCount,
  );
  const suffixBase = String(journey.vendorsReleased) + '.' + String(journey.vendorNoContactCount);
  const commonFacts = Object.freeze([
    fact('fact:vendors-released', input.evidenceRef, input.observedAt, journey.vendorsReleased),
    fact(
      'fact:vendor-no-contact-count',
      input.evidenceRef,
      input.observedAt,
      journey.vendorNoContactCount,
    ),
    fact(
      'fact:successful-vendor-contacts',
      input.evidenceRef,
      input.observedAt,
      successfulVendorContacts,
    ),
  ]);

  const items: AosClientJourneyBridgeItem[] = [];

  if (journey.vendorNoContactCount > 0) {
    items.push(
      item({
        observation: makeObservation({
          signalSuffix: 'contact-gap.' + suffixBase,
          caseLane: 'lead-delivery',
          subjectRef: input.subjectRef,
          requirementRef: input.requirementRef,
          evidenceRef: input.evidenceRef,
          observedAt: input.observedAt,
          priority: 'P1',
          reasonCode: 'VENDOR_FIRST_CONTACT_GAP',
        }),
        trigger: 'LEAD_FIRST_CONTACT_GAP',
        context: {
          metrics: {
            successfulVendorContacts,
            vendorExposureCount: journey.vendorsReleased,
          },
        },
        facts: commonFacts,
      }),
    );
  }

  if (
    journey.vendorsReleased >= 3 &&
    journey.vendorNoContactCount === 0 &&
    journey.allReleasedVendorsContacted
  ) {
    items.push(
      item({
        observation: makeObservation({
          signalSuffix: 'handoff-complete.' + suffixBase,
          caseLane: 'lead-delivery',
          subjectRef: input.subjectRef,
          requirementRef: input.requirementRef,
          evidenceRef: input.evidenceRef,
          observedAt: input.observedAt,
          priority: 'P2',
          reasonCode: 'LEAD_HANDOFF_COMPLETE',
        }),
        trigger: 'LEAD_HANDOFF_COMPLETE',
        context: {
          metrics: {
            successfulVendorContacts,
            vendorExposureCount: journey.vendorsReleased,
          },
        },
        facts: commonFacts,
      }),
    );
  }

  if (journey.satisfactionState === 'SATISFIED') {
    items.push(
      item({
        observation: makeObservation({
          signalSuffix: 'satisfied.' + suffixBase,
          caseLane: 'client-growth',
          subjectRef: input.subjectRef,
          requirementRef: input.requirementRef,
          evidenceRef: input.evidenceRef,
          observedAt: input.observedAt,
          priority: 'P3',
          reasonCode: 'CORE_CLIENT_SATISFIED',
        }),
        trigger: 'CLIENT_SATISFACTION_POSITIVE',
        context: { metrics: { clientSatisfactionScore: 1 } },
        facts: [
          ...commonFacts,
          fact('fact:client-satisfaction-positive', input.evidenceRef, input.observedAt, true),
        ],
      }),
    );
  } else if (
    journey.satisfactionState === 'DISSATISFIED' ||
    journey.satisfactionState === 'COMPLAINT'
  ) {
    items.push(
      item({
        observation: makeObservation({
          signalSuffix: 'dissatisfied.' + suffixBase,
          caseLane: 'client-recovery',
          subjectRef: input.subjectRef,
          requirementRef: input.requirementRef,
          evidenceRef: input.evidenceRef,
          observedAt: input.observedAt,
          priority: 'P1',
          reasonCode: 'CORE_CLIENT_DISSATISFIED',
        }),
        trigger: 'CLIENT_SATISFACTION_NEGATIVE',
        context: { metrics: { clientSatisfactionScore: 0 } },
        facts: [
          ...commonFacts,
          fact('fact:client-satisfaction-positive', input.evidenceRef, input.observedAt, false),
        ],
      }),
    );
  }

  if (journey.followUpDue) {
    items.push(
      item({
        observation: makeObservation({
          signalSuffix: 'follow-up.' + suffixBase,
          caseLane: 'client-follow-up',
          subjectRef: input.subjectRef,
          requirementRef: input.requirementRef,
          evidenceRef: input.evidenceRef,
          observedAt: input.observedAt,
          priority: 'P2',
          reasonCode: 'CORE_CLIENT_FOLLOW_UP_DUE',
        }),
        trigger: 'CLIENT_FOLLOW_UP_DUE',
        context: { metrics: {} },
        facts: commonFacts,
      }),
    );
  }

  return Object.freeze(items);
}

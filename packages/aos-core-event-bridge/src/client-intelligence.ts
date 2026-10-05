import type {
  AosBehaviourContext,
  AosBehaviourTrigger,
  AosEvidenceFact,
  AosObservation,
} from '@qf-jarvis/aos-intelligence';
import { detectAosObservation } from '@qf-jarvis/aos-intelligence';
import type { ClientIntelligenceSnapshotV1 } from '@qf-jarvis/client-intelligence';

import { bridgeClientJourneyToAos, type AosClientJourneyBridgeItem } from './client-journey.js';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export interface AosClientIntelligenceBridgeInput {
  readonly subjectRef: string;
  readonly requirementRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly snapshot: ClientIntelligenceSnapshotV1;
}

export type AosClientIntelligenceBridgeItem = AosClientJourneyBridgeItem;

function validInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function safeServiceRef(value: string): string {
  if (!REF.test(value)) throw new TypeError('aos-client-intelligence-service-ref-invalid');
  return value;
}

function observation(input: {
  readonly signalId: string;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly reasonCode: string;
}): AosObservation {
  const candidate: AosObservation = Object.freeze({
    kind: 'BUSINESS_EVENT' as const,
    input: Object.freeze({
      signalId: input.signalId,
      detectorId: 'client-intelligence.opportunity',
      detectorType: 'OPPORTUNITY' as const,
      caseKey: input.caseKey,
      subjectRef: input.subjectRef,
      priority: 'P3' as const,
      observedAt: input.observedAt,
      evidenceRefs: Object.freeze([input.evidenceRef]),
      reasonCode: input.reasonCode,
      score: 1,
    }),
  });
  void detectAosObservation(candidate);
  return candidate;
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

function bridgeItem(input: {
  readonly observation: AosObservation;
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
  readonly facts: readonly AosEvidenceFact[];
}): AosClientIntelligenceBridgeItem {
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
 * Bridge the full Client Intelligence snapshot into AOS.
 *
 * Lead-delivery and satisfaction signals come from the Core-backed journey projection.
 * Related-service opportunities become one case per target service so AOS cannot lose the
 * target category when several opportunities exist. Positive satisfaction is duplicated
 * into the same service-specific case only when the initial handoff is actually complete.
 */
export function bridgeClientIntelligenceToAos(
  input: AosClientIntelligenceBridgeInput,
): readonly AosClientIntelligenceBridgeItem[] {
  if (
    !REF.test(input.subjectRef) ||
    !REF.test(input.requirementRef) ||
    !REF.test(input.evidenceRef) ||
    !validInstant(input.observedAt)
  ) {
    throw new TypeError('aos-client-intelligence-bridge-input-invalid');
  }

  const base = [
    ...bridgeClientJourneyToAos({
      subjectRef: input.subjectRef,
      requirementRef: input.requirementRef,
      evidenceRef: input.evidenceRef,
      observedAt: input.observedAt,
      journey: input.snapshot.journey,
    }),
  ];

  const handoffComplete =
    input.snapshot.journey.vendorsReleased >= 3 &&
    input.snapshot.journey.vendorNoContactCount === 0 &&
    input.snapshot.journey.allReleasedVendorsContacted;
  const satisfactionPositive = input.snapshot.journey.satisfactionState === 'SATISFIED';

  for (const opportunity of input.snapshot.opportunities) {
    const serviceRef = safeServiceRef(opportunity.serviceRef);
    if (!Number.isFinite(opportunity.score) || opportunity.score < 0 || opportunity.score > 100) {
      throw new TypeError('aos-client-intelligence-opportunity-invalid');
    }

    const normalizedScore = opportunity.score / 100;
    const caseKey =
      input.subjectRef +
      ':client-growth:requirement:' +
      input.requirementRef +
      ':service:' +
      serviceRef;
    const serviceEvidenceRef = input.evidenceRef + ':service:' + serviceRef;

    base.push(
      bridgeItem({
        observation: observation({
          signalId: 'aos.client-opportunity.' + serviceRef,
          caseKey,
          subjectRef: input.subjectRef,
          evidenceRef: serviceEvidenceRef,
          observedAt: input.observedAt,
          reasonCode: 'CLIENT_RELATED_SERVICE_OPPORTUNITY',
        }),
        trigger: 'CLIENT_RELATED_SERVICE_ELIGIBLE',
        context: {
          categoryRef: serviceRef,
          metrics: { relatedServiceScore: normalizedScore },
        },
        facts: [
          fact(
            'fact:related-service-ref:' + serviceRef,
            serviceEvidenceRef,
            input.observedAt,
            serviceRef,
          ),
          fact(
            'fact:related-service-score:' + serviceRef,
            serviceEvidenceRef,
            input.observedAt,
            normalizedScore,
          ),
        ],
      }),
    );

    if (handoffComplete && satisfactionPositive) {
      base.push(
        bridgeItem({
          observation: observation({
            signalId: 'aos.client-satisfaction-for-service.' + serviceRef,
            caseKey,
            subjectRef: input.subjectRef,
            evidenceRef: input.evidenceRef,
            observedAt: input.observedAt,
            reasonCode: 'CLIENT_GROWTH_SATISFACTION_GATE',
          }),
          trigger: 'CLIENT_SATISFACTION_POSITIVE',
          context: {
            categoryRef: serviceRef,
            metrics: {
              clientSatisfactionScore: 1,
              successfulVendorContacts: input.snapshot.journey.vendorsReleased,
            },
          },
          facts: [
            fact(
              'fact:client-growth-satisfied:' + serviceRef,
              input.evidenceRef,
              input.observedAt,
              true,
            ),
            fact(
              'fact:client-growth-handoff-complete:' + serviceRef,
              input.evidenceRef,
              input.observedAt,
              true,
            ),
          ],
        }),
      );
    }
  }

  return Object.freeze(base);
}

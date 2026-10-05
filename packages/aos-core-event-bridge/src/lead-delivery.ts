import type {
  AosBehaviourContext,
  AosBehaviourTrigger,
  AosEvidenceFact,
  AosObservation,
} from '@qf-jarvis/aos-intelligence';
import { detectAosObservation } from '@qf-jarvis/aos-intelligence';

const REF = /^[A-Za-z0-9._:/-]{1,128}$/u;

export interface AosLeadDeliveryVendorAssignment {
  readonly assignmentRef: string;
  readonly vendorRef: string;
  readonly assignedAt: string;
  readonly firstContactConfirmed: boolean;
  readonly firstContactConfirmedAt?: string;
}

export interface AosLeadDeliveryProjection {
  readonly leadRef: string;
  readonly requirementRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly vendorAssignments: readonly AosLeadDeliveryVendorAssignment[];
}

export interface AosLeadDeliveryBridgeItem {
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

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60_000));
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
    dataClass: 'OPAQUE_REFERENCE' as const,
    sourceRef,
    observedAt,
    value,
  });
}

function item(input: {
  readonly signalId: string;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly correlationRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly reasonCode: string;
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
  readonly facts: readonly AosEvidenceFact[];
}): AosLeadDeliveryBridgeItem {
  const observation: AosObservation = Object.freeze({
    kind: 'BUSINESS_EVENT' as const,
    input: Object.freeze({
      signalId: input.signalId,
      detectorId: 'core.lead-delivery-projection',
      detectorType: 'BUSINESS_EVENT' as const,
      caseKey: input.caseKey,
      subjectRef: input.subjectRef,
      correlationRef: input.correlationRef,
      priority: 'P1' as const,
      observedAt: input.observedAt,
      evidenceRefs: Object.freeze([input.evidenceRef]),
      reasonCode: input.reasonCode,
      score: 1,
    }),
  });
  void detectAosObservation(observation);
  return Object.freeze({
    observation,
    behaviour: Object.freeze({
      trigger: input.trigger,
      context: Object.freeze({
        metrics: Object.freeze({ ...input.context.metrics }),
      }),
    }),
    facts: Object.freeze(input.facts.map((one) => Object.freeze({ ...one }))),
    policyRefs: Object.freeze(['core:lead-delivery-projection:v1']),
  });
}

/**
 * Converts a Core-owned assignment/contact projection into:
 * - one vendor-specific contact-gap case per unconfirmed vendor (Anisha target), and
 * - one lead-level aggregate gap case for replacement review.
 *
 * There is no phone number, client identity, eligibility calculation or assignment
 * authority in this projection. AOS receives opaque Core references only.
 */
export function bridgeLeadDeliveryProjectionToAos(
  input: AosLeadDeliveryProjection,
): readonly AosLeadDeliveryBridgeItem[] {
  if (
    !REF.test(input.leadRef) ||
    !REF.test(input.requirementRef) ||
    !REF.test(input.evidenceRef) ||
    !validInstant(input.observedAt) ||
    input.vendorAssignments.length < 1 ||
    input.vendorAssignments.length > 12
  ) {
    throw new TypeError('aos-lead-delivery-projection-invalid');
  }

  const vendorRefs = new Set<string>();
  const assignmentRefs = new Set<string>();
  for (const assignment of input.vendorAssignments) {
    if (
      !REF.test(assignment.assignmentRef) ||
      !REF.test(assignment.vendorRef) ||
      vendorRefs.has(assignment.vendorRef) ||
      assignmentRefs.has(assignment.assignmentRef) ||
      !validInstant(assignment.assignedAt) ||
      Date.parse(assignment.assignedAt) > Date.parse(input.observedAt) ||
      (assignment.firstContactConfirmedAt !== undefined &&
        (!validInstant(assignment.firstContactConfirmedAt) ||
          Date.parse(assignment.firstContactConfirmedAt) < Date.parse(assignment.assignedAt) ||
          Date.parse(assignment.firstContactConfirmedAt) > Date.parse(input.observedAt))) ||
      (assignment.firstContactConfirmed && assignment.firstContactConfirmedAt === undefined) ||
      (!assignment.firstContactConfirmed && assignment.firstContactConfirmedAt !== undefined)
    ) {
      throw new TypeError('aos-lead-delivery-assignment-invalid');
    }
    vendorRefs.add(assignment.vendorRef);
    assignmentRefs.add(assignment.assignmentRef);
  }

  const successfulVendorContacts = input.vendorAssignments.filter(
    (one) => one.firstContactConfirmed,
  ).length;
  const vendorExposureCount = input.vendorAssignments.length;
  const pending = input.vendorAssignments.filter((one) => !one.firstContactConfirmed);
  const items: AosLeadDeliveryBridgeItem[] = [];

  for (const assignment of pending) {
    const elapsedMinutes = minutesBetween(assignment.assignedAt, input.observedAt);
    const caseKey = input.leadRef + ':vendor-contact:' + assignment.assignmentRef;
    const signalId = 'aos.lead-contact.' + assignment.assignmentRef;
    if (caseKey.length > 256 || signalId.length > 128) {
      throw new TypeError('aos-lead-delivery-reference-too-long');
    }
    const assignmentEvidence = input.evidenceRef + ':assignment:' + assignment.assignmentRef;
    if (assignmentEvidence.length > 256) {
      throw new TypeError('aos-lead-delivery-reference-too-long');
    }

    items.push(
      item({
        signalId,
        caseKey,
        subjectRef: assignment.vendorRef,
        correlationRef: input.leadRef,
        evidenceRef: assignmentEvidence,
        observedAt: input.observedAt,
        reasonCode: 'VENDOR_FIRST_CONTACT_MISSING',
        trigger: 'VENDOR_FIRST_CONTACT_MISSING',
        context: {
          metrics: {
            elapsedMinutes,
            successfulVendorContacts,
            vendorExposureCount,
          },
        },
        facts: [
          fact(
            'fact:lead-ref:' + assignment.assignmentRef,
            assignmentEvidence,
            input.observedAt,
            input.leadRef,
          ),
          fact(
            'fact:requirement-ref:' + assignment.assignmentRef,
            assignmentEvidence,
            input.observedAt,
            input.requirementRef,
          ),
          fact(
            'fact:elapsed-minutes:' + assignment.assignmentRef,
            assignmentEvidence,
            input.observedAt,
            elapsedMinutes,
          ),
          fact(
            'fact:successful-contacts:' + assignment.assignmentRef,
            assignmentEvidence,
            input.observedAt,
            successfulVendorContacts,
          ),
        ],
      }),
    );
  }

  if (successfulVendorContacts < 3 && pending.length > 0) {
    const elapsedMinutes = Math.max(
      ...pending.map((one) => minutesBetween(one.assignedAt, input.observedAt)),
    );
    const caseKey = input.leadRef + ':lead-delivery:' + input.requirementRef;
    const signalId = 'aos.lead-gap.' + input.requirementRef;
    if (caseKey.length > 256 || signalId.length > 128) {
      throw new TypeError('aos-lead-delivery-reference-too-long');
    }
    items.push(
      item({
        signalId,
        caseKey,
        subjectRef: input.leadRef,
        correlationRef: input.requirementRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        reasonCode: 'LEAD_FIRST_CONTACT_GAP',
        trigger: 'LEAD_FIRST_CONTACT_GAP',
        context: {
          metrics: {
            elapsedMinutes,
            successfulVendorContacts,
            vendorExposureCount,
          },
        },
        facts: [
          fact(
            'fact:lead-successful-contact-count',
            input.evidenceRef,
            input.observedAt,
            successfulVendorContacts,
          ),
          fact(
            'fact:lead-vendor-exposure-count',
            input.evidenceRef,
            input.observedAt,
            vendorExposureCount,
          ),
          fact(
            'fact:lead-oldest-pending-minutes',
            input.evidenceRef,
            input.observedAt,
            elapsedMinutes,
          ),
        ],
      }),
    );
  }

  return Object.freeze(items);
}

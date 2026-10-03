import type {
  AosBehaviourContext,
  AosBehaviourTrigger,
  AosEvidenceFact,
  AosObservation,
  AosPriority,
} from '@qf-jarvis/aos-intelligence';
import { detectAosObservation } from '@qf-jarvis/aos-intelligence';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;
const PACKAGE_BANDS = ['low', 'medium', 'high', 'critical'] as const;
export type AosVendorPackageReadinessBand = (typeof PACKAGE_BANDS)[number];

export interface AosVendorSuccessProjection {
  readonly subjectRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly inactiveDays: number;
  readonly matchingDemandCount: number;
  readonly packageReadinessBand: AosVendorPackageReadinessBand;
  readonly rechargeOpportunity: boolean;
  readonly retentionRisk: boolean;
  readonly winbackCandidate: boolean;
  readonly complaintOpen: boolean;
}

export interface AosVendorSuccessBridgeItem {
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

function fact(
  id: string,
  sourceRef: string,
  observedAt: string,
  value: string | number | boolean,
): AosEvidenceFact {
  return Object.freeze({
    factId: id,
    kind: 'CORE_FACT' as const,
    dataClass: 'OPERATIONAL' as const,
    sourceRef,
    observedAt,
    value,
  });
}

function makeItem(input: {
  readonly subjectRef: string;
  readonly evidenceRef: string;
  readonly observedAt: string;
  readonly suffix: string;
  readonly priority: AosPriority;
  readonly detectorType?: 'BUSINESS_EVENT' | 'OPPORTUNITY';
  readonly reasonCode: string;
  readonly trigger: AosBehaviourTrigger;
  readonly context: AosBehaviourContext;
  readonly facts: readonly AosEvidenceFact[];
}): AosVendorSuccessBridgeItem {
  const observation: AosObservation = Object.freeze({
    kind: 'BUSINESS_EVENT' as const,
    input: Object.freeze({
      signalId: 'aos.vendor-success.' + input.suffix,
      detectorId: 'core.vendor-success-projection',
      detectorType: input.detectorType ?? 'BUSINESS_EVENT',
      caseKey: input.subjectRef + ':vendor-success',
      subjectRef: input.subjectRef,
      priority: input.priority,
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
    policyRefs: Object.freeze(['core:vendor-success-projection:v1']),
  });
}

/**
 * Bounded Core-owned vendor-success projection.
 *
 * It deliberately carries no vendor balance, package price, phone number, client
 * identity, lead contact detail or payment state. Matching-demand count is already
 * Core-filtered for the vendor; AOS does not perform eligibility or expose a lead.
 */
export function bridgeVendorSuccessProjectionToAos(
  input: AosVendorSuccessProjection,
): readonly AosVendorSuccessBridgeItem[] {
  if (
    !REF.test(input.subjectRef) ||
    !REF.test(input.evidenceRef) ||
    !validInstant(input.observedAt) ||
    !Number.isInteger(input.inactiveDays) ||
    input.inactiveDays < 0 ||
    input.inactiveDays > 3650 ||
    !Number.isInteger(input.matchingDemandCount) ||
    input.matchingDemandCount < 0 ||
    input.matchingDemandCount > 1_000_000 ||
    !PACKAGE_BANDS.includes(input.packageReadinessBand)
  ) {
    throw new TypeError('aos-vendor-success-projection-invalid');
  }

  const common = Object.freeze([
    fact('fact:vendor-inactive-days', input.evidenceRef, input.observedAt, input.inactiveDays),
    fact(
      'fact:vendor-matching-demand-count',
      input.evidenceRef,
      input.observedAt,
      input.matchingDemandCount,
    ),
    fact(
      'fact:vendor-package-readiness-band',
      input.evidenceRef,
      input.observedAt,
      input.packageReadinessBand,
    ),
  ]);
  const items: AosVendorSuccessBridgeItem[] = [];

  if (input.inactiveDays >= 30 && input.matchingDemandCount > 0) {
    items.push(
      makeItem({
        subjectRef: input.subjectRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        suffix: 'inactive-demand',
        priority: 'P2',
        detectorType: 'OPPORTUNITY',
        reasonCode: 'CORE_INACTIVE_VENDOR_MATCHING_DEMAND',
        trigger: 'MATCHING_DEMAND_DETECTED',
        context: {
          metrics: {
            vendorInactiveDays: input.inactiveDays,
            matchingDemandCount: input.matchingDemandCount,
          },
        },
        facts: common,
      }),
    );
  }

  if (input.packageReadinessBand === 'low' || input.packageReadinessBand === 'critical') {
    items.push(
      makeItem({
        subjectRef: input.subjectRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        suffix: 'package-readiness',
        priority: 'P2',
        reasonCode: 'CORE_VENDOR_PACKAGE_READINESS_LOW',
        trigger: 'VENDOR_PACKAGE_READINESS_LOW',
        context: { metrics: {} },
        facts: common,
      }),
    );
  }

  if (input.rechargeOpportunity) {
    items.push(
      makeItem({
        subjectRef: input.subjectRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        suffix: 'recharge-opportunity',
        priority: 'P2',
        detectorType: 'OPPORTUNITY',
        reasonCode: 'CORE_VENDOR_RECHARGE_OPPORTUNITY',
        trigger: 'VENDOR_RECHARGE_OPPORTUNITY',
        context: { metrics: {} },
        facts: common,
      }),
    );
  }

  if (input.retentionRisk) {
    items.push(
      makeItem({
        subjectRef: input.subjectRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        suffix: 'retention-risk',
        priority: 'P2',
        reasonCode: 'CORE_VENDOR_RETENTION_RISK',
        trigger: 'VENDOR_RETENTION_RISK',
        context: { metrics: {} },
        facts: common,
      }),
    );
  }

  if (input.winbackCandidate) {
    items.push(
      makeItem({
        subjectRef: input.subjectRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        suffix: 'winback',
        priority: 'P2',
        detectorType: 'OPPORTUNITY',
        reasonCode: 'CORE_VENDOR_WINBACK_CANDIDATE',
        trigger: 'VENDOR_WINBACK_CANDIDATE',
        context: { metrics: {} },
        facts: common,
      }),
    );
  }

  if (input.complaintOpen) {
    items.push(
      makeItem({
        subjectRef: input.subjectRef,
        evidenceRef: input.evidenceRef,
        observedAt: input.observedAt,
        suffix: 'complaint',
        priority: 'P1',
        reasonCode: 'CORE_VENDOR_COMPLAINT',
        trigger: 'VENDOR_COMPLAINT_RECORDED',
        context: { metrics: {} },
        facts: common,
      }),
    );
  }

  return Object.freeze(items);
}

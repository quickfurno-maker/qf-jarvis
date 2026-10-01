import {
  type AosBehaviourContext,
  type AosBehaviourTrigger,
  type AosObservation,
  type AosPriority,
} from '@qf-jarvis/aos-intelligence';
import { safeParseCanonicalEvent, type CanonicalEvent } from '@qf-jarvis/contracts';

export type AosCoreEventBridgeResult =
  | {
      readonly outcome: 'BRIDGED';
      readonly eventType: string;
      readonly observation: Extract<AosObservation, { readonly kind: 'BUSINESS_EVENT' }>;
      readonly behaviour: {
        readonly trigger: AosBehaviourTrigger;
        readonly context: AosBehaviourContext;
      };
    }
  | {
      readonly outcome: 'IGNORED';
      readonly eventType: string;
      readonly reason: 'NOT_AN_AOS_INPUT' | 'ASSIGNMENT_IS_NOT_CONTACT';
    }
  | {
      readonly outcome: 'INVALID';
      readonly reason: 'CANONICAL_EVENT_INVALID';
    };

interface BridgeSpec {
  readonly caseLane: string;
  readonly priority: AosPriority;
  readonly detectorType?: 'BUSINESS_EVENT' | 'OPPORTUNITY';
  readonly reasonCode: string;
  readonly trigger: AosBehaviourTrigger;
  readonly metrics?: AosBehaviourContext['metrics'];
}

const SPECS: Readonly<Record<string, BridgeSpec>> = Object.freeze({
  'qf.client.follow-up-due-detected': Object.freeze({
    caseLane: 'client-follow-up',
    priority: 'P2',
    reasonCode: 'CORE_CLIENT_FOLLOW_UP_DUE',
    trigger: 'CLIENT_FOLLOW_UP_DUE',
  }),
  'qf.client.satisfaction-recorded': Object.freeze({
    caseLane: 'client-growth',
    priority: 'P3',
    reasonCode: 'CORE_CLIENT_SATISFIED',
    trigger: 'CLIENT_SATISFACTION_POSITIVE',
    metrics: Object.freeze({ clientSatisfactionScore: 1 }),
  }),
  'qf.client.dissatisfaction-recorded': Object.freeze({
    caseLane: 'client-recovery',
    priority: 'P1',
    reasonCode: 'CORE_CLIENT_DISSATISFIED',
    trigger: 'CLIENT_SATISFACTION_NEGATIVE',
    metrics: Object.freeze({ clientSatisfactionScore: 0 }),
  }),
  'qf.client.complaint-recorded': Object.freeze({
    caseLane: 'client-recovery',
    priority: 'P1',
    reasonCode: 'CORE_CLIENT_COMPLAINT',
    trigger: 'CLIENT_SATISFACTION_NEGATIVE',
    metrics: Object.freeze({ clientSatisfactionScore: 0 }),
  }),
  'qf.client.additional-service-identified': Object.freeze({
    caseLane: 'client-growth',
    priority: 'P3',
    detectorType: 'OPPORTUNITY',
    reasonCode: 'CORE_ADDITIONAL_SERVICE_IDENTIFIED',
    trigger: 'CLIENT_RELATED_SERVICE_ELIGIBLE',
    metrics: Object.freeze({ relatedServiceScore: 1 }),
  }),
  'qf.vendor.inactivity-detected': Object.freeze({
    caseLane: 'vendor-success',
    priority: 'P2',
    reasonCode: 'CORE_VENDOR_INACTIVE',
    trigger: 'VENDOR_INACTIVE',
  }),
  'qf.vendor.recharge-opportunity-detected': Object.freeze({
    caseLane: 'vendor-success',
    priority: 'P2',
    detectorType: 'OPPORTUNITY',
    reasonCode: 'CORE_VENDOR_RECHARGE_OPPORTUNITY',
    trigger: 'VENDOR_RECHARGE_OPPORTUNITY',
  }),
  'qf.vendor.package-readiness-changed': Object.freeze({
    caseLane: 'vendor-success',
    priority: 'P2',
    reasonCode: 'CORE_VENDOR_PACKAGE_READINESS_LOW',
    trigger: 'VENDOR_PACKAGE_READINESS_LOW',
  }),
  'qf.vendor.complaint-recorded': Object.freeze({
    caseLane: 'vendor-success',
    priority: 'P1',
    reasonCode: 'CORE_VENDOR_COMPLAINT',
    trigger: 'VENDOR_COMPLAINT_RECORDED',
  }),
  'qf.vendor.retention-risk-detected': Object.freeze({
    caseLane: 'vendor-success',
    priority: 'P2',
    reasonCode: 'CORE_VENDOR_RETENTION_RISK',
    trigger: 'VENDOR_RETENTION_RISK',
  }),
  'qf.vendor.winback-candidate-detected': Object.freeze({
    caseLane: 'vendor-success',
    priority: 'P2',
    detectorType: 'OPPORTUNITY',
    reasonCode: 'CORE_VENDOR_WINBACK_CANDIDATE',
    trigger: 'VENDOR_WINBACK_CANDIDATE',
  }),
});

function subjectRef(subject: { readonly entityType: string; readonly entityId: string }): string {
  return subject.entityType + ':' + subject.entityId;
}

function caseQualifier(event: CanonicalEvent): string | undefined {
  switch (event.eventType) {
    case 'qf.client.follow-up-due-detected':
    case 'qf.client.satisfaction-recorded':
    case 'qf.client.dissatisfaction-recorded':
      return subjectRef(event.payload.lead);
    case 'qf.client.additional-service-identified':
      return subjectRef(event.payload.request.originatingLead);
    default:
      return undefined;
  }
}

export function bridgeCanonicalCoreEvent(input: unknown): AosCoreEventBridgeResult {
  const parsed = safeParseCanonicalEvent(input);
  if (!parsed.success) {
    return Object.freeze({
      outcome: 'INVALID' as const,
      reason: 'CANONICAL_EVENT_INVALID' as const,
    });
  }

  const event = parsed.data;
  if (event.eventType === 'qf.assignment.batch-completed') {
    return Object.freeze({
      outcome: 'IGNORED' as const,
      eventType: event.eventType,
      reason: 'ASSIGNMENT_IS_NOT_CONTACT' as const,
    });
  }

  if (
    event.eventType === 'qf.vendor.package-readiness-changed' &&
    event.payload.readinessBand !== 'low' &&
    event.payload.readinessBand !== 'critical'
  ) {
    return Object.freeze({
      outcome: 'IGNORED' as const,
      eventType: event.eventType,
      reason: 'NOT_AN_AOS_INPUT' as const,
    });
  }

  const spec = SPECS[event.eventType];
  if (spec === undefined) {
    return Object.freeze({
      outcome: 'IGNORED' as const,
      eventType: event.eventType,
      reason: 'NOT_AN_AOS_INPUT' as const,
    });
  }

  const opaqueSubject = subjectRef(event.subject);
  const qualifier = caseQualifier(event);
  const observation: Extract<AosObservation, { readonly kind: 'BUSINESS_EVENT' }> = Object.freeze({
    kind: 'BUSINESS_EVENT' as const,
    input: Object.freeze({
      signalId: 'aos.event.' + event.eventId,
      detectorId: 'core.canonical-event',
      detectorType: spec.detectorType ?? 'BUSINESS_EVENT',
      caseKey:
        opaqueSubject + ':' + spec.caseLane + (qualifier === undefined ? '' : ':' + qualifier),
      subjectRef: opaqueSubject,
      correlationRef: event.correlationId,
      priority: spec.priority,
      observedAt: event.occurredAt,
      evidenceRefs: Object.freeze(['core-event:' + event.eventId]),
      reasonCode: spec.reasonCode,
      score: 1,
    }),
  });

  return Object.freeze({
    outcome: 'BRIDGED' as const,
    eventType: event.eventType,
    observation,
    behaviour: Object.freeze({
      trigger: spec.trigger,
      context: Object.freeze({
        metrics: spec.metrics ?? Object.freeze({}),
      }),
    }),
  });
}

export { bridgeClientJourneyToAos } from './client-journey.js';
export { bridgeClientIntelligenceToAos } from './client-intelligence.js';
export type {
  AosClientIntelligenceBridgeInput,
  AosClientIntelligenceBridgeItem,
} from './client-intelligence.js';
export type { AosClientJourneyBridgeInput, AosClientJourneyBridgeItem } from './client-journey.js';
export { bridgeLeadDeliveryProjectionToAos } from './lead-delivery.js';
export type {
  AosLeadDeliveryBridgeItem,
  AosLeadDeliveryProjection,
  AosLeadDeliveryVendorAssignment,
} from './lead-delivery.js';
export { bridgeVendorSuccessProjectionToAos } from './vendor-success.js';
export type {
  AosVendorPackageReadinessBand,
  AosVendorSuccessBridgeItem,
  AosVendorSuccessProjection,
} from './vendor-success.js';

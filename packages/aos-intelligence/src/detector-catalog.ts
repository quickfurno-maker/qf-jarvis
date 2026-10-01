import type { AosDetectorType, AosPriority } from './contracts.js';

export const AOS_DETECTOR_COVERAGE_STATES = [
  'IMPLEMENTED',
  'SOURCE_PARTIAL',
  'SOURCE_REQUIRED',
  'PLANNED',
] as const;
export type AosDetectorCoverageState = (typeof AOS_DETECTOR_COVERAGE_STATES)[number];

export interface AosDetectorDefinition {
  readonly detectorId: string;
  readonly label: string;
  readonly domain:
    | 'LEAD_DELIVERY'
    | 'CLIENT_VALUE'
    | 'VENDOR_SUCCESS'
    | 'MARKETPLACE'
    | 'COMMUNICATIONS'
    | 'INFRASTRUCTURE'
    | 'MODEL_RUNTIME';
  readonly detectorType: AosDetectorType;
  readonly defaultPriority: AosPriority;
  readonly coverage: AosDetectorCoverageState;
  readonly sourceRefs: readonly string[];
  readonly modelRequired: false;
  readonly executionAuthority: 'NONE';
  readonly description: string;
}

function detector(
  input: Omit<AosDetectorDefinition, 'modelRequired' | 'executionAuthority'>,
): AosDetectorDefinition {
  return Object.freeze({
    ...input,
    sourceRefs: Object.freeze([...input.sourceRefs]),
    modelRequired: false as const,
    executionAuthority: 'NONE' as const,
  });
}

/**
 * The code-backed AOS detector inventory.
 *
 * Detection stays deterministic. OpenAI may interpret or recommend after a
 * detector creates evidence; it is never required to notice the underlying
 * failure.
 */
export const AOS_DETECTOR_CATALOG_V1: readonly AosDetectorDefinition[] = Object.freeze([
  detector({
    detectorId: 'lead.vendor-first-contact-gap',
    label: 'Vendor first-contact gap',
    domain: 'LEAD_DELIVERY',
    detectorType: 'JOURNEY',
    defaultPriority: 'P1',
    coverage: 'SOURCE_PARTIAL',
    sourceRefs: ['core.client-vendor-journey'],
    description:
      'Detects when Core reports one or more released vendors have not established first contact.',
  }),
  detector({
    detectorId: 'lead.first-contact-sla',
    label: 'First-contact SLA breach',
    domain: 'LEAD_DELIVERY',
    detectorType: 'SLA',
    defaultPriority: 'P1',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['core.assignment/contact-timestamps'],
    description:
      'Measures elapsed time against governed first-contact thresholds once authoritative timestamps are supplied.',
  }),
  detector({
    detectorId: 'lead.handoff-complete',
    label: 'Three-vendor handoff completion',
    domain: 'LEAD_DELIVERY',
    detectorType: 'JOURNEY',
    defaultPriority: 'P2',
    coverage: 'SOURCE_PARTIAL',
    sourceRefs: ['core.client-vendor-journey'],
    description:
      'Recognizes handoff only after Core confirms all three released vendors contacted the client.',
  }),
  detector({
    detectorId: 'client.satisfaction',
    label: 'Client satisfaction / dissatisfaction',
    domain: 'CLIENT_VALUE',
    detectorType: 'BUSINESS_EVENT',
    defaultPriority: 'P2',
    coverage: 'SOURCE_PARTIAL',
    sourceRefs: ['qf.client.satisfaction-recorded', 'qf.client.dissatisfaction-recorded'],
    description:
      'Uses explicit Core-recorded satisfaction evidence; never derives satisfaction from revenue intent.',
  }),
  detector({
    detectorId: 'client.related-service',
    label: 'Related-service opportunity',
    domain: 'CLIENT_VALUE',
    detectorType: 'OPPORTUNITY',
    defaultPriority: 'P3',
    coverage: 'SOURCE_PARTIAL',
    sourceRefs: [
      'qf.client.additional-service-identified',
      'client-intelligence.service-blueprints',
    ],
    description:
      'Surfaces governed related-service opportunities, gated downstream by verified satisfaction.',
  }),
  detector({
    detectorId: 'vendor.recharge-opportunity',
    label: 'Vendor recharge opportunity',
    domain: 'VENDOR_SUCCESS',
    detectorType: 'OPPORTUNITY',
    defaultPriority: 'P2',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['qf.vendor.recharge-opportunity-detected'],
    description:
      'Consumes Core-derived recharge-opportunity bands without copying a raw balance into AOS.',
  }),
  detector({
    detectorId: 'vendor.low-balance',
    label: 'Low balance / depletion risk',
    domain: 'VENDOR_SUCCESS',
    detectorType: 'BUSINESS_EVENT',
    defaultPriority: 'P2',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['core.vendor-credit-read'],
    description:
      'Reserved for a bounded authoritative Core credit projection; AOS does not infer balance from lead history.',
  }),
  detector({
    detectorId: 'vendor.package-readiness',
    label: 'Vendor package-readiness risk',
    domain: 'VENDOR_SUCCESS',
    detectorType: 'BUSINESS_EVENT',
    defaultPriority: 'P2',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['qf.vendor.package-readiness-changed'],
    description:
      'Consumes a Core-owned qualitative readiness band and recommends recharge conversation only for low/critical readiness.',
  }),
  detector({
    detectorId: 'vendor.complaint',
    label: 'Vendor complaint / satisfaction risk',
    domain: 'VENDOR_SUCCESS',
    detectorType: 'BUSINESS_EVENT',
    defaultPriority: 'P1',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['qf.vendor.complaint-recorded'],
    description:
      'Treats a recorded vendor complaint as a success/retention case for Anisha or human review; AOS does not adjudicate the complaint.',
  }),
  detector({
    detectorId: 'vendor.retention-risk',
    label: 'Vendor retention risk',
    domain: 'VENDOR_SUCCESS',
    detectorType: 'BUSINESS_EVENT',
    defaultPriority: 'P2',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['qf.vendor.retention-risk-detected'],
    description:
      'Consumes bounded Core retention-risk evidence and recommends Anisha success follow-up.',
  }),
  detector({
    detectorId: 'vendor.winback',
    label: 'Vendor win-back candidate',
    domain: 'VENDOR_SUCCESS',
    detectorType: 'OPPORTUNITY',
    defaultPriority: 'P2',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['qf.vendor.winback-candidate-detected'],
    description:
      'Consumes Core win-back evidence without granting contact or promotional authority.',
  }),
  detector({
    detectorId: 'market.supply-demand',
    label: 'Local supply-demand pressure',
    domain: 'MARKETPLACE',
    detectorType: 'SUPPLY_DEMAND',
    defaultPriority: 'P1',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['core.marketplace-aggregate-snapshot'],
    description:
      'Compares open demand with eligible supply by city/locality/category using aggregate Core facts.',
  }),
  detector({
    detectorId: 'market.relative-anomaly',
    label: 'Marketplace relative anomaly',
    domain: 'MARKETPLACE',
    detectorType: 'RELATIVE_ANOMALY',
    defaultPriority: 'P2',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['governed.marketplace-metrics'],
    description:
      'Detects material deviation from governed baselines before model reasoning is considered.',
  }),
  detector({
    detectorId: 'market.change-point',
    label: 'Marketplace change point',
    domain: 'MARKETPLACE',
    detectorType: 'CHANGE_POINT',
    defaultPriority: 'P2',
    coverage: 'PLANNED',
    sourceRefs: ['governed.marketplace-time-series'],
    description: 'Flags sustained regime changes that fixed thresholds may miss.',
  }),
  detector({
    detectorId: 'communications.delivery-health',
    label: 'Communication delivery degradation',
    domain: 'COMMUNICATIONS',
    detectorType: 'RELATIVE_ANOMALY',
    defaultPriority: 'P1',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['qf.communication.result-recorded'],
    description:
      'Detects delivery and failure-rate degradation from Core-recorded communication results.',
  }),
  detector({
    detectorId: 'infra.worker-health',
    label: 'Worker / queue health',
    domain: 'INFRASTRUCTURE',
    detectorType: 'INFRASTRUCTURE',
    defaultPriority: 'P1',
    coverage: 'SOURCE_REQUIRED',
    sourceRefs: ['jarvis.system-health-snapshot'],
    description:
      'Detects queue growth, worker failure and latency degradation from bounded system-health metrics.',
  }),
  detector({
    detectorId: 'model.gateway-health',
    label: 'Model gateway health',
    domain: 'MODEL_RUNTIME',
    detectorType: 'INFRASTRUCTURE',
    defaultPriority: 'P1',
    coverage: 'SOURCE_PARTIAL',
    sourceRefs: ['jarvis.model-gateway-observation'],
    description:
      'Tracks provider/model latency, refusal and circuit posture without exposing credentials or prompts.',
  }),
  detector({
    detectorId: 'market.unknown-pattern',
    label: 'Unknown-pattern candidate',
    domain: 'MARKETPLACE',
    detectorType: 'UNKNOWN_PATTERN',
    defaultPriority: 'P2',
    coverage: 'PLANNED',
    sourceRefs: ['governed.aggregate-feature-stream'],
    description:
      'Future deterministic/statistical novelty detector; model interpretation remains downstream.',
  }),
]);

export function aosDetectorCoverageSummary(): Readonly<Record<AosDetectorCoverageState, number>> {
  const summary: Record<AosDetectorCoverageState, number> = {
    IMPLEMENTED: 0,
    SOURCE_PARTIAL: 0,
    SOURCE_REQUIRED: 0,
    PLANNED: 0,
  };
  for (const detector of AOS_DETECTOR_CATALOG_V1) summary[detector.coverage] += 1;
  return Object.freeze(summary);
}

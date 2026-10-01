export const AOS_MODES = ['OBSERVE', 'SUGGEST'] as const;
export type AosMode = (typeof AOS_MODES)[number];

export const AOS_PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type AosPriority = (typeof AOS_PRIORITIES)[number];

export const AOS_DETECTOR_TYPES = [
  'BUSINESS_EVENT',
  'OPPORTUNITY',
  'BUSINESS_INVARIANT',
  'SLA',
  'JOURNEY',
  'RELATIVE_ANOMALY',
  'CHANGE_POINT',
  'SUPPLY_DEMAND',
  'VENDOR_BEHAVIOUR',
  'CLIENT_BEHAVIOUR',
  'INFRASTRUCTURE',
  'UNKNOWN_PATTERN',
] as const;
export type AosDetectorType = (typeof AOS_DETECTOR_TYPES)[number];

export interface AosSignal {
  readonly signalId: string;
  readonly detectorId: string;
  readonly detectorType: AosDetectorType;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly correlationRef?: string;
  readonly priority: AosPriority;
  readonly score: number;
  readonly observedAt: string;
  readonly evidenceRefs: readonly string[];
  readonly reasonCode: string;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export const AOS_CASE_STATES = [
  'DETECTED',
  'ANALYZING',
  'RECOMMENDED',
  'ACKNOWLEDGED',
  'ACTIONED',
  'RESOLVED',
  'DISMISSED',
] as const;
export type AosCaseState = (typeof AOS_CASE_STATES)[number];

export interface AosCase {
  readonly caseId: string;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly state: AosCaseState;
  readonly priority: AosPriority;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly signalIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly detectorTypes: readonly AosDetectorType[];
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export const AOS_EVIDENCE_KINDS = [
  'CORE_FACT',
  'METRIC',
  'POLICY',
  'HISTORY',
  'CAPACITY',
  'COMMUNICATION_STATE',
] as const;
export type AosEvidenceKind = (typeof AOS_EVIDENCE_KINDS)[number];

export const AOS_EVIDENCE_DATA_CLASSES = [
  'OPERATIONAL',
  'BUSINESS_AGGREGATE',
  'OPAQUE_REFERENCE',
] as const;
export type AosEvidenceDataClass = (typeof AOS_EVIDENCE_DATA_CLASSES)[number];

export interface AosEvidenceFact {
  readonly factId: string;
  readonly kind: AosEvidenceKind;
  readonly dataClass: AosEvidenceDataClass;
  readonly sourceRef: string;
  readonly observedAt: string;
  readonly value: string | number | boolean;
}

export interface AosEvidencePacket {
  readonly protocol: 'qfj.aos.evidence.v1';
  readonly caseId: string;
  readonly caseKey: string;
  readonly subjectRef: string;
  readonly generatedAt: string;
  readonly facts: readonly AosEvidenceFact[];
  readonly policyRefs: readonly string[];
  readonly containsDirectPii: false;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export const AOS_MODEL_ROUTES = ['NO_MODEL', 'ROUTINE', 'DEEP'] as const;
export type AosModelRoute = (typeof AOS_MODEL_ROUTES)[number];

export interface AosModelRoutingInput {
  readonly priority: AosPriority;
  readonly noveltyScore: number;
  readonly evidenceConflictCount: number;
  readonly similarResolvedCaseCount: number;
  /**
   * True when the governed behaviour registry already supplies a complete bounded
   * recommendation for this case. Known cases should not pay for a model call
   * unless novelty, evidence conflict or criticality justifies escalation.
   */
  readonly deterministicRecommendationAvailable?: boolean;
  readonly routineBudgetAvailable: boolean;
  readonly deepBudgetAvailable: boolean;
}

export const AOS_RECOMMENDATION_ACTIONS = [
  'NO_ACTION',
  'REVIEW_CASE',
  'REQUEST_VENDOR_REMINDER',
  'REQUEST_REPLACEMENT_BATCH',
  'REQUEST_CLIENT_FOLLOW_UP',
  'REQUEST_SATISFACTION_CHECK',
  'REQUEST_RELATED_SERVICE_SUGGESTION',
  'REQUEST_LOW_BALANCE_ALERT',
  'REQUEST_RECHARGE_NUDGE',
  'REQUEST_VENDOR_REACTIVATION',
  'REQUEST_VENDOR_SUCCESS_FOLLOW_UP',
  'REQUEST_HUMAN_REVIEW',
  'REQUEST_SUPPLY_REVIEW',
  'REQUEST_VENDOR_ACQUISITION_REVIEW',
  'REQUEST_INCIDENT_INVESTIGATION',
  'REQUEST_MODEL_FALLBACK_REVIEW',
] as const;
export type AosRecommendationAction = (typeof AOS_RECOMMENDATION_ACTIONS)[number];

export interface AosRecommendation {
  readonly protocol: 'qfj.aos.recommendation.v1';
  readonly recommendationId: string;
  readonly caseId: string;
  readonly action: AosRecommendationAction;
  readonly confidence: number;
  readonly rationale: string;
  readonly alternatives: readonly AosRecommendationAction[];
  readonly evidenceRefs: readonly string[];
  readonly policyRefs: readonly string[];
  readonly requiresCoreDecision: boolean;
  readonly requiresOwnerReview: boolean;
  readonly executionAuthorized: false;
  readonly businessEffect: false;
}

export const AOS_CRITIC_RESULTS = ['PASS', 'HOLD'] as const;
export type AosCriticResult = (typeof AOS_CRITIC_RESULTS)[number];

export interface AosCritique {
  readonly result: AosCriticResult;
  readonly reasonCodes: readonly string[];
  readonly executionAuthorized: false;
}

export const AOS_OWNER_DECISIONS = ['APPROVE', 'REJECT', 'MODIFY', 'IGNORE'] as const;
export type AosOwnerDecision = (typeof AOS_OWNER_DECISIONS)[number];

export const AOS_OUTCOMES = ['RECOVERED', 'NO_CHANGE', 'FAILED', 'UNKNOWN'] as const;
export type AosOutcome = (typeof AOS_OUTCOMES)[number];

export interface AosOutcomeRecord {
  readonly caseId: string;
  readonly recommendationId: string;
  readonly ownerDecision: AosOwnerDecision;
  readonly outcome: AosOutcome;
  readonly policyViolation: boolean;
  readonly unsupportedReasoning: boolean;
}

export interface AosCapabilityEvidence {
  readonly sampleCount: number;
  readonly ownerDecisionCount: number;
  readonly ownerAcceptedCount: number;
  readonly resolvedCount: number;
  readonly successfulOutcomeCount: number;
  readonly falsePositiveCount: number;
  readonly policyViolationCount: number;
  readonly unsupportedReasoningCount: number;
}

export type AosCapabilityMaturity = 'OBSERVE_ONLY' | 'SUGGEST_ONLY' | 'ELIGIBLE_FOR_APPROVAL_PILOT';

export interface AosCapabilityAssessment {
  readonly maturity: AosCapabilityMaturity;
  readonly acceptanceRate: number | null;
  readonly successfulOutcomeRate: number | null;
  readonly falsePositiveRate: number | null;
  readonly supportRate: number | null;
  readonly productionApproval: false;
  readonly reasons: readonly string[];
}

import {
  AOS_RECOMMENDATION_ACTIONS,
  type AosCase,
  type AosCritique,
  type AosEvidencePacket,
  type AosRecommendation,
  type AosRecommendationAction,
} from './contracts.js';
import { validRef, validUnit } from './validation.js';

const CORE_DECISION_ACTIONS = new Set<AosRecommendationAction>([
  'REQUEST_VENDOR_REMINDER',
  'REQUEST_REPLACEMENT_BATCH',
  'REQUEST_CLIENT_FOLLOW_UP',
  'REQUEST_PACKAGE_CAPACITY_HOLD_REVIEW',
]);

export interface AosRecommendationCandidate {
  readonly recommendationId: string;
  readonly action: AosRecommendationAction;
  readonly confidence: number;
  readonly rationale: string;
  readonly alternatives?: readonly AosRecommendationAction[];
  readonly evidenceRefs: readonly string[];
  readonly policyRefs?: readonly string[];
  readonly requiresOwnerReview?: boolean;
}

function uniqueActions(
  actions: readonly AosRecommendationAction[],
): readonly AosRecommendationAction[] {
  return Object.freeze([...new Set(actions)]);
}

export function createAosRecommendation(
  packet: AosEvidencePacket,
  candidate: AosRecommendationCandidate,
): AosRecommendation {
  const alternatives = uniqueActions(candidate.alternatives ?? []);
  if (
    !validRef(candidate.recommendationId) ||
    !AOS_RECOMMENDATION_ACTIONS.includes(candidate.action) ||
    !validUnit(candidate.confidence) ||
    candidate.rationale.trim().length < 1 ||
    candidate.rationale.length > 1200 ||
    alternatives.length > 5 ||
    alternatives.includes(candidate.action) ||
    alternatives.some((action) => !AOS_RECOMMENDATION_ACTIONS.includes(action)) ||
    candidate.evidenceRefs.length > 32 ||
    (candidate.policyRefs?.length ?? 0) > 16
  ) {
    throw new TypeError('aos-recommendation-candidate-invalid');
  }
  if (
    candidate.evidenceRefs.some((ref) => !validRef(ref)) ||
    (candidate.policyRefs ?? []).some((ref) => !validRef(ref))
  ) {
    throw new TypeError('aos-recommendation-reference-invalid');
  }

  return Object.freeze({
    protocol: 'qfj.aos.recommendation.v1' as const,
    recommendationId: candidate.recommendationId,
    caseId: packet.caseId,
    action: candidate.action,
    confidence: candidate.confidence,
    rationale: candidate.rationale.trim(),
    alternatives,
    evidenceRefs: Object.freeze([...new Set(candidate.evidenceRefs)].sort()),
    policyRefs: Object.freeze([...new Set(candidate.policyRefs ?? [])].sort()),
    requiresCoreDecision: CORE_DECISION_ACTIONS.has(candidate.action),
    requiresOwnerReview: candidate.requiresOwnerReview ?? candidate.action !== 'NO_ACTION',
    executionAuthorized: false as const,
    businessEffect: false as const,
  });
}

export function critiqueAosRecommendation(
  currentCase: AosCase,
  packet: AosEvidencePacket,
  recommendation: AosRecommendation,
): AosCritique {
  const reasons: string[] = [];
  if (recommendation.caseId !== currentCase.caseId || packet.caseId !== currentCase.caseId) {
    reasons.push('CASE_BINDING_MISMATCH');
  }
  const allowedEvidence = new Set([
    ...packet.facts.map((fact) => fact.factId),
    ...packet.facts.map((fact) => fact.sourceRef),
    ...packet.policyRefs,
  ]);
  if (
    recommendation.action !== 'NO_ACTION' &&
    (recommendation.evidenceRefs.length === 0 ||
      recommendation.evidenceRefs.some((ref) => !allowedEvidence.has(ref)))
  ) {
    reasons.push('EVIDENCE_NOT_BOUND');
  }
  if (recommendation.policyRefs.some((ref) => !packet.policyRefs.includes(ref))) {
    reasons.push('POLICY_NOT_BOUND');
  }
  if (
    recommendation.action !== 'NO_ACTION' &&
    recommendation.action !== 'REVIEW_CASE' &&
    recommendation.confidence < 0.6
  ) {
    reasons.push('CONFIDENCE_TOO_LOW_FOR_ACTIONABLE_SUGGESTION');
  }
  const rawRecommendation = recommendation as unknown as Readonly<Record<string, unknown>>;
  if (
    rawRecommendation['executionAuthorized'] !== false ||
    rawRecommendation['businessEffect'] !== false
  ) {
    reasons.push('AUTHORITY_VIOLATION');
  }
  if (
    recommendation.action === 'REQUEST_REPLACEMENT_BATCH' &&
    !recommendation.requiresOwnerReview
  ) {
    reasons.push('REPLACEMENT_OWNER_REVIEW_REQUIRED');
  }

  return Object.freeze({
    result: reasons.length === 0 ? ('PASS' as const) : ('HOLD' as const),
    reasonCodes: Object.freeze(reasons.sort()),
    executionAuthorized: false as const,
  });
}

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export const MODEL_TASK_CLASSES = [
  'QUICK_REPLY',
  'GROUNDED_QA',
  'STRUCTURED_EXTRACTION',
  'COMPLEX_REASONING',
  'MULTIMODAL_REASONING',
] as const;
export type ModelTaskClass = (typeof MODEL_TASK_CLASSES)[number];

export type ModelServiceTier = 'FAST' | 'BALANCED' | 'STRONG';
export type ModelDataClass = 'HOSTED_ALLOWED' | 'LOCAL_ONLY' | 'HUMAN_ONLY';
export type RouteOptimization = 'LATENCY' | 'COST' | 'QUALITY';
export type DecisionRisk = 'LOW' | 'MEDIUM' | 'HIGH';

const TIERS = ['FAST', 'BALANCED', 'STRONG'] as const;
const DATA_CLASSES = ['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'] as const;
const OPTIMIZATIONS = ['LATENCY', 'COST', 'QUALITY'] as const;
const RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;

const TIER_RANK: Readonly<Record<ModelServiceTier, number>> = Object.freeze({
  FAST: 0,
  BALANCED: 1,
  STRONG: 2,
});

export interface CertifiedModelCandidate {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass: 'HOSTED' | 'LOCAL';
  readonly certificationRef: string;
  readonly evaluationRef: string;
  /**
   * Separate evidence that this exact release/provider is approved as a fallback target.
   * A normal primary certification is not enough.
   */
  readonly fallbackCertificationRef?: string;
  readonly certifiedTaskClasses: readonly ModelTaskClass[];
  readonly tier: ModelServiceTier;
  readonly maxContextTokens: number;
  readonly supportsStructuredOutput: boolean;
  readonly latencyRank: number;
  readonly costRank: number;
}

export interface AdaptiveModelRouteInput {
  readonly taskClass: ModelTaskClass;
  readonly dataClass: ModelDataClass;
  readonly risk: DecisionRisk;
  readonly requiredContextTokens: number;
  readonly requireStructuredOutput: boolean;
  readonly optimization: RouteOptimization;
  readonly allowCertifiedFallback: boolean;
  readonly candidates: readonly CertifiedModelCandidate[];
}

export type AdaptiveModelRouteDecision =
  | {
      readonly decision: 'HUMAN_REQUIRED';
      readonly reason: 'HUMAN_ONLY' | 'NO_CERTIFIED_ROUTE';
      readonly requiredTier: ModelServiceTier;
    }
  | {
      readonly decision: 'ROUTE_INTENT_READY';
      readonly requiredTier: ModelServiceTier;
      readonly primaryReleaseId: string;
      readonly fallbackReleaseId?: string;
      readonly actualRoutingAuthority: 'MODEL_GATEWAY';
    };

function validCandidate(value: CertifiedModelCandidate): boolean {
  return (
    REF.test(value.releaseId) &&
    REF.test(value.providerId) &&
    REF.test(value.modelId) &&
    REF.test(value.modelVersion) &&
    REF.test(value.certificationRef) &&
    REF.test(value.evaluationRef) &&
    (value.fallbackCertificationRef === undefined || REF.test(value.fallbackCertificationRef)) &&
    (value.executionClass === 'HOSTED' || value.executionClass === 'LOCAL') &&
    (TIERS as readonly string[]).includes(value.tier) &&
    Number.isInteger(value.maxContextTokens) &&
    value.maxContextTokens > 0 &&
    Number.isInteger(value.latencyRank) &&
    value.latencyRank >= 0 &&
    Number.isInteger(value.costRank) &&
    value.costRank >= 0 &&
    typeof value.supportsStructuredOutput === 'boolean' &&
    value.certifiedTaskClasses.length > 0 &&
    value.certifiedTaskClasses.every((task) =>
      (MODEL_TASK_CLASSES as readonly string[]).includes(task),
    )
  );
}

function requiredTier(input: AdaptiveModelRouteInput): ModelServiceTier {
  if (
    input.risk === 'HIGH' ||
    input.taskClass === 'COMPLEX_REASONING' ||
    input.taskClass === 'MULTIMODAL_REASONING'
  ) {
    return 'STRONG';
  }
  if (input.risk === 'MEDIUM' || input.taskClass === 'STRUCTURED_EXTRACTION') {
    return 'BALANCED';
  }
  return 'FAST';
}

function eligible(
  input: AdaptiveModelRouteInput,
  tier: ModelServiceTier,
): readonly CertifiedModelCandidate[] {
  const seen = new Set<string>();
  return input.candidates.filter((candidate) => {
    if (!validCandidate(candidate) || seen.has(candidate.releaseId)) {
      throw new TypeError('adaptive-model-candidate-invalid');
    }
    seen.add(candidate.releaseId);

    if (input.dataClass === 'LOCAL_ONLY' && candidate.executionClass !== 'LOCAL') return false;
    if (!candidate.certifiedTaskClasses.includes(input.taskClass)) return false;
    if (candidate.maxContextTokens < input.requiredContextTokens) return false;
    if (input.requireStructuredOutput && !candidate.supportsStructuredOutput) return false;
    return TIER_RANK[candidate.tier] >= TIER_RANK[tier];
  });
}

function orderCandidates(
  values: readonly CertifiedModelCandidate[],
  optimization: RouteOptimization,
): readonly CertifiedModelCandidate[] {
  return [...values].sort((a, b) => {
    if (optimization === 'QUALITY') {
      const tier = TIER_RANK[b.tier] - TIER_RANK[a.tier];
      if (tier !== 0) return tier;
    } else if (optimization === 'COST') {
      const cost = a.costRank - b.costRank;
      if (cost !== 0) return cost;
    }

    const latency = a.latencyRank - b.latencyRank;
    if (latency !== 0) return latency;
    const cost = a.costRank - b.costRank;
    if (cost !== 0) return cost;
    return a.releaseId.localeCompare(b.releaseId);
  });
}

/**
 * Produce a content-free routing intent over already-certified releases.
 *
 * This function does not invoke a provider, build a gateway, read a credential, or decide production
 * rollout. The existing Model Gateway remains the only runtime provider router.
 */
export function planAdaptiveModelRoute(input: AdaptiveModelRouteInput): AdaptiveModelRouteDecision {
  if (
    !(MODEL_TASK_CLASSES as readonly string[]).includes(input.taskClass) ||
    !(DATA_CLASSES as readonly string[]).includes(input.dataClass) ||
    !(RISKS as readonly string[]).includes(input.risk) ||
    !(OPTIMIZATIONS as readonly string[]).includes(input.optimization) ||
    !Number.isInteger(input.requiredContextTokens) ||
    input.requiredContextTokens < 0 ||
    typeof input.requireStructuredOutput !== 'boolean' ||
    typeof input.allowCertifiedFallback !== 'boolean' ||
    input.candidates.length > 64
  ) {
    throw new TypeError('adaptive-model-route-invalid');
  }

  const tier = requiredTier(input);
  if (input.dataClass === 'HUMAN_ONLY') {
    return Object.freeze({
      decision: 'HUMAN_REQUIRED',
      reason: 'HUMAN_ONLY',
      requiredTier: tier,
    });
  }

  const ordered = orderCandidates(eligible(input, tier), input.optimization);
  const primary = ordered[0];
  if (primary === undefined) {
    return Object.freeze({
      decision: 'HUMAN_REQUIRED',
      reason: 'NO_CERTIFIED_ROUTE',
      requiredTier: tier,
    });
  }

  const fallback = input.allowCertifiedFallback
    ? ordered.find(
        (candidate) =>
          candidate.releaseId !== primary.releaseId &&
          candidate.providerId !== primary.providerId &&
          candidate.fallbackCertificationRef !== undefined,
      )
    : undefined;

  return Object.freeze({
    decision: 'ROUTE_INTENT_READY',
    requiredTier: tier,
    primaryReleaseId: primary.releaseId,
    ...(fallback === undefined ? {} : { fallbackReleaseId: fallback.releaseId }),
    actualRoutingAuthority: 'MODEL_GATEWAY',
  });
}

export type CoreFactStatus = 'NOT_REQUIRED' | 'VERIFIED' | 'UNVERIFIED' | 'CONTRADICTED';
export type ConfidenceAction = 'ANSWER' | 'VERIFY_CORE' | 'ASK_CLARIFYING' | 'ESCALATE_HUMAN';

export interface AnswerConfidenceInput {
  readonly evidenceScore: number;
  readonly retrievalCoverage: number;
  readonly ambiguityScore: number;
  readonly groundingSourceCount: number;
  readonly coreFactStatus: CoreFactStatus;
  readonly structuredOutputValid: boolean;
  readonly contradictionCount: number;
}

export interface AnswerConfidenceDecision {
  readonly band: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly action: ConfidenceAction;
  readonly reason:
    | 'SUPPORTED'
    | 'CORE_VERIFICATION_REQUIRED'
    | 'CONTRADICTED'
    | 'STRUCTURE_INVALID'
    | 'AMBIGUOUS'
    | 'INSUFFICIENT_GROUNDING';
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Derive confidence from observable evidence signals, never from a model's self-reported confidence.
 */
export function assessAnswerConfidence(input: AnswerConfidenceInput): AnswerConfidenceDecision {
  if (
    !unit(input.evidenceScore) ||
    !unit(input.retrievalCoverage) ||
    !unit(input.ambiguityScore) ||
    !Number.isInteger(input.groundingSourceCount) ||
    input.groundingSourceCount < 0 ||
    !['NOT_REQUIRED', 'VERIFIED', 'UNVERIFIED', 'CONTRADICTED'].includes(input.coreFactStatus) ||
    typeof input.structuredOutputValid !== 'boolean' ||
    !Number.isInteger(input.contradictionCount) ||
    input.contradictionCount < 0
  ) {
    throw new TypeError('answer-confidence-input-invalid');
  }

  if (input.coreFactStatus === 'CONTRADICTED' || input.contradictionCount > 0) {
    return Object.freeze({
      band: 'LOW',
      action: 'ESCALATE_HUMAN',
      reason: 'CONTRADICTED',
    });
  }

  if (input.coreFactStatus === 'UNVERIFIED') {
    return Object.freeze({
      band: 'LOW',
      action: 'VERIFY_CORE',
      reason: 'CORE_VERIFICATION_REQUIRED',
    });
  }

  if (!input.structuredOutputValid) {
    return Object.freeze({
      band: 'LOW',
      action: 'ESCALATE_HUMAN',
      reason: 'STRUCTURE_INVALID',
    });
  }

  if (input.ambiguityScore > 0.6) {
    return Object.freeze({
      band: 'LOW',
      action: 'ASK_CLARIFYING',
      reason: 'AMBIGUOUS',
    });
  }

  if (
    input.evidenceScore >= 0.8 &&
    input.retrievalCoverage >= 0.75 &&
    input.groundingSourceCount > 0
  ) {
    return Object.freeze({
      band: 'HIGH',
      action: 'ANSWER',
      reason: 'SUPPORTED',
    });
  }

  return Object.freeze({
    band: 'MEDIUM',
    action: 'ASK_CLARIFYING',
    reason: 'INSUFFICIENT_GROUNDING',
  });
}

import {
  createModelCapabilityRegistry,
  type ModelCapabilityProfile,
  type ModelCapabilityProfileSummary,
  type ModelCapabilityRequirement,
} from '@qf-jarvis/model-gateway';

const REF = /^[A-Za-z0-9._:/-]{1,256}$/u;

export const ADAPTIVE_COMPLEXITIES = ['SIMPLE', 'STANDARD', 'COMPLEX'] as const;
export type AdaptiveComplexity = (typeof ADAPTIVE_COMPLEXITIES)[number];

export interface AdaptiveModelRoutingPolicy {
  readonly policyRef: string;
  readonly releaseOrderByComplexity: Readonly<Record<AdaptiveComplexity, readonly string[]>>;
  readonly fallbackEnabled: boolean;
  readonly certifiedFallbackByPrimary: Readonly<Record<string, string>>;
}

export function createAdaptiveModelRoutingPolicy(
  input: AdaptiveModelRoutingPolicy,
): AdaptiveModelRoutingPolicy {
  if (!REF.test(input.policyRef) || typeof input.fallbackEnabled !== 'boolean') {
    throw new TypeError('adaptive-model-routing-policy-invalid');
  }
  const seen = new Set<string>();
  const normalized = {} as Record<AdaptiveComplexity, readonly string[]>;
  for (const complexity of ADAPTIVE_COMPLEXITIES) {
    const orderCandidate: unknown = input.releaseOrderByComplexity[complexity];
    if (!Array.isArray(orderCandidate)) {
      throw new TypeError('adaptive-model-routing-policy-invalid');
    }
    const order = input.releaseOrderByComplexity[complexity];
    if (order.length === 0 || order.length > 32) {
      throw new TypeError('adaptive-model-routing-policy-invalid');
    }
    const local = new Set<string>();
    for (const id of order) {
      if (typeof id !== 'string' || !REF.test(id) || local.has(id)) {
        throw new TypeError('adaptive-model-routing-policy-invalid');
      }
      local.add(id);
      seen.add(id);
    }
    normalized[complexity] = Object.freeze([...order]);
  }
  const fallbacks: Record<string, string> = {};
  for (const [primary, fallback] of Object.entries(input.certifiedFallbackByPrimary)) {
    if (!REF.test(primary) || !REF.test(fallback) || primary === fallback) {
      throw new TypeError('adaptive-model-routing-policy-invalid');
    }
    if (!seen.has(primary) || !seen.has(fallback)) {
      throw new TypeError('adaptive-model-routing-policy-invalid');
    }
    fallbacks[primary] = fallback;
  }
  return Object.freeze({
    policyRef: input.policyRef,
    releaseOrderByComplexity: Object.freeze(normalized),
    fallbackEnabled: input.fallbackEnabled,
    certifiedFallbackByPrimary: Object.freeze(fallbacks),
  });
}

export type AdaptiveRouteDecision =
  | {
      readonly decision: 'PRIMARY_SELECTED';
      readonly release: ModelCapabilityProfileSummary;
      readonly policyRef: string;
    }
  | {
      readonly decision: 'NO_CERTIFIED_RELEASE' | 'NO_CAPABLE_RELEASE' | 'POLICY_RELEASE_MISSING';
      readonly policyRef: string;
    };

export function selectAdaptiveModelRelease(input: {
  readonly profiles: readonly ModelCapabilityProfile[];
  readonly requirement: ModelCapabilityRequirement;
  readonly complexity: AdaptiveComplexity;
  readonly policy: AdaptiveModelRoutingPolicy;
}): AdaptiveRouteDecision {
  const registry = createModelCapabilityRegistry(input.profiles);
  let sawKnown = false;
  let sawCertified = false;

  for (const releaseId of input.policy.releaseOrderByComplexity[input.complexity]) {
    const profile = registry.getByReleaseId(releaseId);
    if (profile === undefined) continue;
    sawKnown = true;
    if (profile.evaluationApprovalRef === undefined) continue;
    sawCertified = true;
    const resolved = registry.resolveRelease(profile.release, input.requirement);
    if (resolved.ok) {
      return Object.freeze({
        decision: 'PRIMARY_SELECTED' as const,
        release: resolved.summary,
        policyRef: input.policy.policyRef,
      });
    }
  }

  if (!sawKnown) {
    return Object.freeze({
      decision: 'POLICY_RELEASE_MISSING' as const,
      policyRef: input.policy.policyRef,
    });
  }
  if (!sawCertified) {
    return Object.freeze({
      decision: 'NO_CERTIFIED_RELEASE' as const,
      policyRef: input.policy.policyRef,
    });
  }
  return Object.freeze({
    decision: 'NO_CAPABLE_RELEASE' as const,
    policyRef: input.policy.policyRef,
  });
}

export type CertifiedFallbackDecision =
  | {
      readonly decision: 'FALLBACK_READY';
      readonly primary: ModelCapabilityProfileSummary;
      readonly fallback: ModelCapabilityProfileSummary;
      readonly policyRef: string;
      readonly executionAuthorized: false;
    }
  | {
      readonly decision:
        | 'FALLBACK_DISABLED'
        | 'FALLBACK_NOT_REGISTERED'
        | 'FALLBACK_NOT_CERTIFIED'
        | 'FALLBACK_NOT_CAPABLE';
      readonly policyRef: string;
    };

export function planCertifiedProviderFallback(input: {
  readonly profiles: readonly ModelCapabilityProfile[];
  readonly requirement: ModelCapabilityRequirement;
  readonly primaryReleaseId: string;
  readonly policy: AdaptiveModelRoutingPolicy;
}): CertifiedFallbackDecision {
  if (!input.policy.fallbackEnabled) {
    return Object.freeze({
      decision: 'FALLBACK_DISABLED' as const,
      policyRef: input.policy.policyRef,
    });
  }
  const fallbackId = input.policy.certifiedFallbackByPrimary[input.primaryReleaseId];
  if (fallbackId === undefined) {
    return Object.freeze({
      decision: 'FALLBACK_NOT_REGISTERED' as const,
      policyRef: input.policy.policyRef,
    });
  }
  const registry = createModelCapabilityRegistry(input.profiles);
  const primary = registry.getByReleaseId(input.primaryReleaseId);
  const fallback = registry.getByReleaseId(fallbackId);
  if (primary === undefined || fallback === undefined) {
    return Object.freeze({
      decision: 'FALLBACK_NOT_REGISTERED' as const,
      policyRef: input.policy.policyRef,
    });
  }
  if (primary.evaluationApprovalRef === undefined || fallback.evaluationApprovalRef === undefined) {
    return Object.freeze({
      decision: 'FALLBACK_NOT_CERTIFIED' as const,
      policyRef: input.policy.policyRef,
    });
  }
  const p = registry.resolveRelease(primary.release, input.requirement);
  const f = registry.resolveRelease(fallback.release, input.requirement);
  if (!p.ok || !f.ok) {
    return Object.freeze({
      decision: 'FALLBACK_NOT_CAPABLE' as const,
      policyRef: input.policy.policyRef,
    });
  }
  return Object.freeze({
    decision: 'FALLBACK_READY' as const,
    primary: p.summary,
    fallback: f.summary,
    policyRef: input.policy.policyRef,
    executionAuthorized: false as const,
  });
}

export const ANSWER_POSTURES = [
  'ANSWER',
  'CLARIFY',
  'VERIFY_CORE',
  'HUMAN_HANDOFF',
  'REFUSE',
] as const;
export type AnswerPosture = (typeof ANSWER_POSTURES)[number];

export interface AnswerConfidenceInput {
  readonly groundingRequired: boolean;
  readonly retrievalHitCount: number;
  readonly citationCoverage: number;
  readonly groundingCoverage: number;
  readonly ambiguitySignals: number;
  readonly structuredOutputValid: boolean;
  readonly safetyBlocked: boolean;
  readonly requiresCoreAuthority: boolean;
  readonly coreAuthority: 'NOT_REQUIRED' | 'VERIFIED' | 'UNAVAILABLE' | 'CONFLICT';
}

export interface AnswerConfidenceDecision {
  readonly posture: AnswerPosture;
  readonly confidenceBand: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly evidenceScore: number;
  readonly reason:
    | 'SAFETY_BLOCKED'
    | 'CORE_CONFLICT'
    | 'CORE_VERIFICATION_REQUIRED'
    | 'STRUCTURED_OUTPUT_INVALID'
    | 'AMBIGUOUS'
    | 'GROUNDING_WEAK'
    | 'EVIDENCE_SUFFICIENT';
}

function unit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function decideAnswerPosture(input: AnswerConfidenceInput): AnswerConfidenceDecision {
  if (
    !Number.isInteger(input.retrievalHitCount) ||
    input.retrievalHitCount < 0 ||
    input.retrievalHitCount > 64 ||
    !Number.isInteger(input.ambiguitySignals) ||
    input.ambiguitySignals < 0 ||
    input.ambiguitySignals > 32 ||
    !unit(input.citationCoverage) ||
    !unit(input.groundingCoverage)
  ) {
    throw new TypeError('answer-confidence-input-invalid');
  }
  if (input.safetyBlocked) {
    return Object.freeze({
      posture: 'REFUSE',
      confidenceBand: 'LOW',
      evidenceScore: 0,
      reason: 'SAFETY_BLOCKED',
    });
  }
  if (input.coreAuthority === 'CONFLICT') {
    return Object.freeze({
      posture: 'HUMAN_HANDOFF',
      confidenceBand: 'LOW',
      evidenceScore: 0,
      reason: 'CORE_CONFLICT',
    });
  }
  if (input.requiresCoreAuthority && input.coreAuthority !== 'VERIFIED') {
    return Object.freeze({
      posture: 'VERIFY_CORE',
      confidenceBand: 'LOW',
      evidenceScore: 0,
      reason: 'CORE_VERIFICATION_REQUIRED',
    });
  }
  if (!input.structuredOutputValid) {
    return Object.freeze({
      posture: 'CLARIFY',
      confidenceBand: 'LOW',
      evidenceScore: 0.25,
      reason: 'STRUCTURED_OUTPUT_INVALID',
    });
  }

  const groundingScore = input.groundingRequired
    ? Math.min(
        1,
        (input.retrievalHitCount > 0 ? 0.2 : 0) +
          input.citationCoverage * 0.4 +
          input.groundingCoverage * 0.4,
      )
    : 1;
  const score = Math.max(0, Math.min(1, groundingScore - input.ambiguitySignals * 0.12));

  if (input.ambiguitySignals >= 2) {
    return Object.freeze({
      posture: 'CLARIFY',
      confidenceBand: score >= 0.55 ? 'MEDIUM' : 'LOW',
      evidenceScore: score,
      reason: 'AMBIGUOUS',
    });
  }
  if (input.groundingRequired && (input.retrievalHitCount === 0 || score < 0.7)) {
    return Object.freeze({
      posture: 'CLARIFY',
      confidenceBand: score >= 0.55 ? 'MEDIUM' : 'LOW',
      evidenceScore: score,
      reason: 'GROUNDING_WEAK',
    });
  }
  return Object.freeze({
    posture: 'ANSWER',
    confidenceBand: score >= 0.85 ? 'HIGH' : 'MEDIUM',
    evidenceScore: score,
    reason: 'EVIDENCE_SUFFICIENT',
  });
}

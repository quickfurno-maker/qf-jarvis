import type { AosModelRoute } from '@qf-jarvis/aos-intelligence';
import {
  createModelCapabilityRequirement,
  type EvaluationEvidenceVerifier,
  type ModelCapabilityProfile,
  type ModelCapabilityProfileSummary,
  type ModelCapabilityRequirement,
} from '@qf-jarvis/model-gateway';
import {
  classifyAdaptiveComplexity,
  selectAdaptiveModelRelease,
  type AdaptiveComplexity,
  type AdaptiveModelRoutingPolicy,
} from '@qf-jarvis/model-intelligence-control';

export interface AosCertifiedModelSignals {
  readonly route: Exclude<AosModelRoute, 'NO_MODEL'>;
  readonly factCount: number;
  readonly policyCount: number;
  readonly noveltyScore: number;
  readonly evidenceConflictCount: number;
  readonly highRisk: boolean;
}

export interface AosCertifiedModelSelection {
  readonly decision:
    | 'CERTIFIED_RELEASE_SELECTED'
    | 'NO_CERTIFIED_RELEASE'
    | 'NO_CAPABLE_RELEASE'
    | 'POLICY_RELEASE_MISSING';
  readonly complexity: AdaptiveComplexity;
  readonly release?: ModelCapabilityProfileSummary;
  readonly policyRef: string;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

export const AOS_MODEL_CAPABILITY_REQUIREMENT: ModelCapabilityRequirement =
  createModelCapabilityRequirement({
    taskClass: 'TOOL_INTENT_PROPOSAL',
    resultMode: 'STRUCTURED',
    structuredMode: 'strict-json-schema',
    minInputTokens: 2_048,
    minCompletionTokens: 900,
    requiresTimeout: true,
    requiresCancellation: false,
    requiresNonStreaming: true,
  });

function validUnit(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function classifyAosAdaptiveComplexity(input: AosCertifiedModelSignals): AdaptiveComplexity {
  if (
    !Number.isInteger(input.factCount) ||
    input.factCount < 0 ||
    input.factCount > 256 ||
    !Number.isInteger(input.policyCount) ||
    input.policyCount < 0 ||
    input.policyCount > 64 ||
    !validUnit(input.noveltyScore) ||
    !Number.isInteger(input.evidenceConflictCount) ||
    input.evidenceConflictCount < 0 ||
    input.evidenceConflictCount > 64
  ) {
    throw new TypeError('aos-certified-model-signals-invalid');
  }

  return classifyAdaptiveComplexity({
    normalizedTextChars: Math.min(4_096, input.factCount * 96 + input.policyCount * 48),
    conversationContextChars: 0,
    knowledgeHitCount: 0,
    ambiguitySignals: Math.min(
      8,
      input.evidenceConflictCount + (input.noveltyScore >= 0.8 ? 1 : 0),
    ),
    requiresCoreVerification: false,
    multiStepReasoning: input.route === 'DEEP',
    highRisk: input.highRisk,
  });
}

export function selectAosCertifiedModelRelease(input: {
  readonly signals: AosCertifiedModelSignals;
  readonly profiles: readonly ModelCapabilityProfile[];
  readonly policy: AdaptiveModelRoutingPolicy;
  readonly evidenceVerifier: EvaluationEvidenceVerifier;
  readonly requirement?: ModelCapabilityRequirement;
}): AosCertifiedModelSelection {
  const complexity = classifyAosAdaptiveComplexity(input.signals);
  const selected = selectAdaptiveModelRelease({
    profiles: input.profiles,
    requirement: input.requirement ?? AOS_MODEL_CAPABILITY_REQUIREMENT,
    complexity,
    policy: input.policy,
    evidenceVerifier: input.evidenceVerifier,
  });

  if (selected.decision === 'PRIMARY_SELECTED') {
    return Object.freeze({
      decision: 'CERTIFIED_RELEASE_SELECTED' as const,
      complexity,
      release: selected.release,
      policyRef: selected.policyRef,
      executionAuthority: 'NONE' as const,
      businessEffect: false as const,
    });
  }

  return Object.freeze({
    decision: selected.decision,
    complexity,
    policyRef: selected.policyRef,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

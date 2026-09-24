import {
  createModelCapabilityProfile,
  createModelCapabilityRequirement,
  createProviderReleaseRef,
  type ModelCapabilityProfile,
} from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  createAdaptiveModelRoutingPolicy,
  decideAnswerPosture,
  planCertifiedProviderFallback,
  selectAdaptiveModelRelease,
} from '../index.js';

function profile(
  releaseId: string,
  options: {
    approved?: boolean;
    task?: 'RESPONSE_GENERATION' | 'STRUCTURED_EXTRACTION';
    maxInput?: number;
  } = {},
): ModelCapabilityProfile {
  return createModelCapabilityProfile({
    release: createProviderReleaseRef({
      releaseId,
      providerId: `provider.${releaseId}`,
      modelId: `model-${releaseId}`,
      modelVersion: 'v1',
      executionClass: 'HOSTED',
      configDigest: `digest.${releaseId}`,
    }),
    taskClasses: [options.task ?? 'RESPONSE_GENERATION'],
    resultModes: ['TEXT'],
    structuredOutputMode: 'unsupported',
    maxInputTokens: options.maxInput ?? 32_000,
    maxCompletionTokens: 4_000,
    supportsTimeout: true,
    supportsCancellation: true,
    ...(options.approved === false ? {} : { evaluationApprovalRef: `evaluation.${releaseId}` }),
  });
}

const requirement = createModelCapabilityRequirement({
  taskClass: 'RESPONSE_GENERATION',
  resultMode: 'TEXT',
  minInputTokens: 8_000,
  requiresTimeout: true,
  requiresCancellation: true,
});

function policy(fallbackEnabled = false) {
  return createAdaptiveModelRoutingPolicy({
    policyRef: 'qfj.adaptive-routing.test.v1',
    releaseOrderByComplexity: {
      SIMPLE: ['fast', 'strong'],
      STANDARD: ['strong', 'fast'],
      COMPLEX: ['strong', 'fast'],
    },
    fallbackEnabled,
    certifiedFallbackByPrimary: { strong: 'fast' },
  });
}

describe('adaptive model intelligence control', () => {
  it('selects the first certified capable release for the requested complexity', () => {
    const result = selectAdaptiveModelRelease({
      profiles: [profile('fast'), profile('strong')],
      requirement,
      complexity: 'SIMPLE',
      policy: policy(),
    });
    expect(result).toMatchObject({ decision: 'PRIMARY_SELECTED', release: { releaseId: 'fast' } });
  });

  it('skips an uncertified release rather than treating policy order as approval', () => {
    const result = selectAdaptiveModelRelease({
      profiles: [profile('fast', { approved: false }), profile('strong')],
      requirement,
      complexity: 'SIMPLE',
      policy: policy(),
    });
    expect(result).toMatchObject({
      decision: 'PRIMARY_SELECTED',
      release: { releaseId: 'strong' },
    });
  });

  it('fails closed when every known release is uncertified', () => {
    expect(
      selectAdaptiveModelRelease({
        profiles: [profile('fast', { approved: false }), profile('strong', { approved: false })],
        requirement,
        complexity: 'COMPLEX',
        policy: policy(),
      }),
    ).toEqual({ decision: 'NO_CERTIFIED_RELEASE', policyRef: 'qfj.adaptive-routing.test.v1' });
  });

  it('prepares fallback only when both exact releases are certified and capable', () => {
    const result = planCertifiedProviderFallback({
      profiles: [profile('fast'), profile('strong')],
      requirement,
      primaryReleaseId: 'strong',
      policy: policy(true),
    });
    expect(result).toMatchObject({
      decision: 'FALLBACK_READY',
      primary: { releaseId: 'strong' },
      fallback: { releaseId: 'fast' },
      executionAuthorized: false,
    });
  });

  it('keeps certified fallback disabled unless policy explicitly enables it', () => {
    expect(
      planCertifiedProviderFallback({
        profiles: [profile('fast'), profile('strong')],
        requirement,
        primaryReleaseId: 'strong',
        policy: policy(false),
      }),
    ).toMatchObject({ decision: 'FALLBACK_DISABLED' });
  });

  it('does not use a certified fallback that fails the capability requirement', () => {
    expect(
      planCertifiedProviderFallback({
        profiles: [profile('fast', { task: 'STRUCTURED_EXTRACTION' }), profile('strong')],
        requirement,
        primaryReleaseId: 'strong',
        policy: policy(true),
      }),
    ).toMatchObject({ decision: 'FALLBACK_NOT_CAPABLE' });
  });

  it('answers only when evidence is sufficient', () => {
    expect(
      decideAnswerPosture({
        groundingRequired: true,
        retrievalHitCount: 3,
        citationCoverage: 1,
        groundingCoverage: 0.95,
        ambiguitySignals: 0,
        structuredOutputValid: true,
        safetyBlocked: false,
        requiresCoreAuthority: false,
        coreAuthority: 'NOT_REQUIRED',
      }),
    ).toMatchObject({ posture: 'ANSWER', confidenceBand: 'HIGH', reason: 'EVIDENCE_SUFFICIENT' });
  });

  it('routes uncertainty to verification, clarification, handoff or refusal instead of guessing', () => {
    expect(
      decideAnswerPosture({
        groundingRequired: false,
        retrievalHitCount: 0,
        citationCoverage: 0,
        groundingCoverage: 0,
        ambiguitySignals: 0,
        structuredOutputValid: true,
        safetyBlocked: false,
        requiresCoreAuthority: true,
        coreAuthority: 'UNAVAILABLE',
      }).posture,
    ).toBe('VERIFY_CORE');

    expect(
      decideAnswerPosture({
        groundingRequired: true,
        retrievalHitCount: 1,
        citationCoverage: 0.3,
        groundingCoverage: 0.3,
        ambiguitySignals: 2,
        structuredOutputValid: true,
        safetyBlocked: false,
        requiresCoreAuthority: false,
        coreAuthority: 'NOT_REQUIRED',
      }).posture,
    ).toBe('CLARIFY');

    expect(
      decideAnswerPosture({
        groundingRequired: false,
        retrievalHitCount: 0,
        citationCoverage: 0,
        groundingCoverage: 0,
        ambiguitySignals: 0,
        structuredOutputValid: true,
        safetyBlocked: false,
        requiresCoreAuthority: true,
        coreAuthority: 'CONFLICT',
      }).posture,
    ).toBe('HUMAN_HANDOFF');

    expect(
      decideAnswerPosture({
        groundingRequired: false,
        retrievalHitCount: 0,
        citationCoverage: 0,
        groundingCoverage: 0,
        ambiguitySignals: 0,
        structuredOutputValid: true,
        safetyBlocked: true,
        requiresCoreAuthority: false,
        coreAuthority: 'NOT_REQUIRED',
      }).posture,
    ).toBe('REFUSE');
  });
});

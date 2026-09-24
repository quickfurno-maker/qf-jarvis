import {
  createModelCapabilityProfile,
  createModelCapabilityRequirement,
  createProviderReleaseRef,
  type EvaluationEvidenceVerifier,
  type EvidenceVerificationRequest,
  type ModelCapabilityProfile,
} from '@qf-jarvis/model-gateway';
import { describe, expect, it, vi } from 'vitest';

import {
  createAdaptiveModelRoutingPolicy,
  decideAnswerPosture,
  planCertifiedProviderFallback,
  selectAdaptiveModelRelease,
} from '../index.js';

const FAST_DIGEST = 'a'.repeat(64);
const STRONG_DIGEST = 'b'.repeat(64);

function profile(
  releaseId: string,
  options: {
    approvedRef?: boolean;
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
      configDigest: releaseId === 'fast' ? FAST_DIGEST : STRONG_DIGEST,
    }),
    taskClasses: [options.task ?? 'RESPONSE_GENERATION'],
    resultModes: ['TEXT'],
    structuredOutputMode: 'unsupported',
    maxInputTokens: options.maxInput ?? 32_000,
    maxCompletionTokens: 4_000,
    supportsTimeout: true,
    supportsCancellation: true,
    ...(options.approvedRef === false ? {} : { evaluationApprovalRef: `evaluation.${releaseId}` }),
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
    activeCertificationByRelease: {
      fast: {
        evaluationRef: 'evaluation.fast',
        evidenceDigest: 'c'.repeat(64),
        capabilityProfileRef: 'cap.fast.v1',
      },
      strong: {
        evaluationRef: 'evaluation.strong',
        evidenceDigest: 'd'.repeat(64),
        capabilityProfileRef: 'cap.strong.v1',
      },
    },
    fallbackEnabled,
    certifiedFallbackByPrimary: { strong: 'fast' },
  });
}

function verifier(options: { refuse?: readonly string[] } = {}): EvaluationEvidenceVerifier {
  const refused = new Set(options.refuse ?? []);
  return Object.freeze({
    verify(request: EvidenceVerificationRequest) {
      const expected =
        request.release.releaseId === 'fast'
          ? {
              evaluationRef: 'evaluation.fast',
              evidenceDigest: 'c'.repeat(64),
              capabilityProfileRef: 'cap.fast.v1',
            }
          : request.release.releaseId === 'strong'
            ? {
                evaluationRef: 'evaluation.strong',
                evidenceDigest: 'd'.repeat(64),
                capabilityProfileRef: 'cap.strong.v1',
              }
            : undefined;
      if (
        expected === undefined ||
        refused.has(request.release.releaseId) ||
        request.mode !== 'ACTIVE' ||
        request.approvalTarget !== 'ACTIVE_MODEL_RELEASE' ||
        request.evaluationRef !== expected.evaluationRef ||
        request.evidenceDigest !== expected.evidenceDigest ||
        request.capabilityProfileRef !== expected.capabilityProfileRef
      ) {
        return Object.freeze({ ok: false as const, reason: 'evidence-missing' as const });
      }
      return Object.freeze({ ok: true as const });
    },
  });
}

describe('adaptive model intelligence control', () => {
  it('selects the first verifier-backed ACTIVE-certified capable release', () => {
    const result = selectAdaptiveModelRelease({
      profiles: [profile('fast'), profile('strong')],
      requirement,
      complexity: 'SIMPLE',
      policy: policy(),
      evidenceVerifier: verifier(),
    });
    expect(result).toMatchObject({ decision: 'PRIMARY_SELECTED', release: { releaseId: 'fast' } });
  });

  it('does not treat an opaque profile approval ref as certification when verification refuses', () => {
    const rejectingVerifier = verifier({ refuse: ['fast'] });
    const spy = vi.fn((request: EvidenceVerificationRequest) => rejectingVerifier.verify(request));
    const result = selectAdaptiveModelRelease({
      profiles: [profile('fast'), profile('strong')],
      requirement,
      complexity: 'SIMPLE',
      policy: policy(),
      evidenceVerifier: { verify: spy },
    });
    expect(result).toMatchObject({
      decision: 'PRIMARY_SELECTED',
      release: { releaseId: 'strong' },
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluationRef: 'evaluation.fast',
        approvalTarget: 'ACTIVE_MODEL_RELEASE',
        mode: 'ACTIVE',
      }),
    );
  });

  it('skips a release whose capability profile carries no approval reference', () => {
    const result = selectAdaptiveModelRelease({
      profiles: [profile('fast', { approvedRef: false }), profile('strong')],
      requirement,
      complexity: 'SIMPLE',
      policy: policy(),
      evidenceVerifier: verifier(),
    });
    expect(result).toMatchObject({
      decision: 'PRIMARY_SELECTED',
      release: { releaseId: 'strong' },
    });
  });

  it('fails closed when every known release lacks verified ACTIVE evidence', () => {
    expect(
      selectAdaptiveModelRelease({
        profiles: [profile('fast'), profile('strong')],
        requirement,
        complexity: 'COMPLEX',
        policy: policy(),
        evidenceVerifier: verifier({ refuse: ['fast', 'strong'] }),
      }),
    ).toEqual({
      decision: 'NO_CERTIFIED_RELEASE',
      policyRef: 'qfj.adaptive-routing.test.v1',
    });
  });

  it('prepares fallback only when both exact releases verify as ACTIVE and are capable', () => {
    const result = planCertifiedProviderFallback({
      profiles: [profile('fast'), profile('strong')],
      requirement,
      primaryReleaseId: 'strong',
      policy: policy(true),
      evidenceVerifier: verifier(),
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
        evidenceVerifier: verifier(),
      }),
    ).toMatchObject({ decision: 'FALLBACK_DISABLED' });
  });

  it('refuses fallback when either exact release fails evidence verification', () => {
    expect(
      planCertifiedProviderFallback({
        profiles: [profile('fast'), profile('strong')],
        requirement,
        primaryReleaseId: 'strong',
        policy: policy(true),
        evidenceVerifier: verifier({ refuse: ['fast'] }),
      }),
    ).toMatchObject({ decision: 'FALLBACK_NOT_CERTIFIED' });
  });

  it('does not use a verified fallback that fails the capability requirement', () => {
    expect(
      planCertifiedProviderFallback({
        profiles: [profile('fast', { task: 'STRUCTURED_EXTRACTION' }), profile('strong')],
        requirement,
        primaryReleaseId: 'strong',
        policy: policy(true),
        evidenceVerifier: verifier(),
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

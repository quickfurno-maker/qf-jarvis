import { describe, expect, it } from 'vitest';
import {
  assessAnswerConfidence,
  planAdaptiveModelRoute,
  type CertifiedModelCandidate,
} from '../index.js';

function candidate(
  releaseId: string,
  providerId: string,
  tier: 'FAST' | 'BALANCED' | 'STRONG',
  executionClass: 'HOSTED' | 'LOCAL' = 'HOSTED',
): CertifiedModelCandidate {
  return {
    releaseId,
    providerId,
    modelId: `model/${releaseId}`,
    modelVersion: 'v1',
    executionClass,
    certificationRef: `cert.${releaseId}`,
    evaluationRef: `eval.${releaseId}`,
    fallbackCertificationRef: `fallback-cert.${releaseId}`,
    certifiedTaskClasses: [
      'QUICK_REPLY',
      'GROUNDED_QA',
      'STRUCTURED_EXTRACTION',
      'COMPLEX_REASONING',
      'MULTIMODAL_REASONING',
    ],
    tier,
    maxContextTokens: 32768,
    supportsStructuredOutput: true,
    latencyRank: tier === 'FAST' ? 1 : tier === 'BALANCED' ? 2 : 3,
    costRank: tier === 'FAST' ? 1 : tier === 'BALANCED' ? 2 : 3,
  };
}

describe('model intelligence control', () => {
  it('chooses the fastest certified route and distinct provider fallback', () => {
    const result = planAdaptiveModelRoute({
      taskClass: 'QUICK_REPLY',
      dataClass: 'HOSTED_ALLOWED',
      risk: 'LOW',
      requiredContextTokens: 1000,
      requireStructuredOutput: false,
      optimization: 'LATENCY',
      allowCertifiedFallback: true,
      candidates: [
        candidate('strong', 'provider-b', 'STRONG'),
        candidate('fast', 'provider-a', 'FAST'),
      ],
    });
    expect(result).toMatchObject({
      decision: 'ROUTE_INTENT_READY',
      requiredTier: 'FAST',
      primaryReleaseId: 'fast',
      fallbackReleaseId: 'strong',
      actualRoutingAuthority: 'MODEL_GATEWAY',
    });
  });

  it('does not name an uncertified fallback even when another provider is otherwise eligible', () => {
    const uncertified = { ...candidate('strong', 'provider-b', 'STRONG') };
    delete (uncertified as { fallbackCertificationRef?: string }).fallbackCertificationRef;
    const result = planAdaptiveModelRoute({
      taskClass: 'QUICK_REPLY',
      dataClass: 'HOSTED_ALLOWED',
      risk: 'LOW',
      requiredContextTokens: 1000,
      requireStructuredOutput: false,
      optimization: 'LATENCY',
      allowCertifiedFallback: true,
      candidates: [candidate('fast', 'provider-a', 'FAST'), uncertified],
    });
    expect(result).toEqual({
      decision: 'ROUTE_INTENT_READY',
      requiredTier: 'FAST',
      primaryReleaseId: 'fast',
      actualRoutingAuthority: 'MODEL_GATEWAY',
    });
  });

  it('fails closed when strong work has no strong certified route', () => {
    const result = planAdaptiveModelRoute({
      taskClass: 'COMPLEX_REASONING',
      dataClass: 'HOSTED_ALLOWED',
      risk: 'HIGH',
      requiredContextTokens: 1000,
      requireStructuredOutput: true,
      optimization: 'COST',
      allowCertifiedFallback: false,
      candidates: [candidate('fast', 'provider-a', 'FAST')],
    });
    expect(result).toEqual({
      decision: 'HUMAN_REQUIRED',
      reason: 'NO_CERTIFIED_ROUTE',
      requiredTier: 'STRONG',
    });
  });

  it('never routes LOCAL_ONLY work to hosted inference', () => {
    const result = planAdaptiveModelRoute({
      taskClass: 'GROUNDED_QA',
      dataClass: 'LOCAL_ONLY',
      risk: 'LOW',
      requiredContextTokens: 1000,
      requireStructuredOutput: false,
      optimization: 'QUALITY',
      allowCertifiedFallback: true,
      candidates: [
        candidate('hosted', 'provider-a', 'STRONG'),
        candidate('local', 'provider-local', 'STRONG', 'LOCAL'),
      ],
    });
    expect(result).toMatchObject({ primaryReleaseId: 'local' });
  });

  it('requires Core verification even when other evidence is strong', () => {
    expect(
      assessAnswerConfidence({
        evidenceScore: 0.99,
        retrievalCoverage: 0.99,
        ambiguityScore: 0,
        groundingSourceCount: 5,
        coreFactStatus: 'UNVERIFIED',
        structuredOutputValid: true,
        contradictionCount: 0,
      }),
    ).toMatchObject({ band: 'LOW', action: 'VERIFY_CORE' });
  });

  it('answers only when evidence is well-supported and non-contradictory', () => {
    expect(
      assessAnswerConfidence({
        evidenceScore: 0.95,
        retrievalCoverage: 0.9,
        ambiguityScore: 0.1,
        groundingSourceCount: 3,
        coreFactStatus: 'VERIFIED',
        structuredOutputValid: true,
        contradictionCount: 0,
      }),
    ).toEqual({ band: 'HIGH', action: 'ANSWER', reason: 'SUPPORTED' });
    expect(
      assessAnswerConfidence({
        evidenceScore: 1,
        retrievalCoverage: 1,
        ambiguityScore: 0,
        groundingSourceCount: 3,
        coreFactStatus: 'VERIFIED',
        structuredOutputValid: true,
        contradictionCount: 1,
      }),
    ).toMatchObject({ action: 'ESCALATE_HUMAN' });
  });
});

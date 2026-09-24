import { describe, expect, it } from 'vitest';

import { planAdaptiveModelRoute } from '../index.js';

const c = (
  releaseId: string,
  providerId: string,
  tier: 'FAST' | 'BALANCED' | 'STRONG',
  extra: Record<string, unknown> = {},
) => ({
  releaseId,
  providerId,
  modelId: `model.${releaseId}`,
  modelVersion: 'v1',
  executionClass: 'HOSTED' as const,
  certificationRef: `cert.${releaseId}`,
  evaluationRef: `eval.${releaseId}`,
  certifiedTaskClasses: ['QUICK_REPLY', 'COMPLEX_REASONING'] as const,
  tier,
  maxContextTokens: 16_384,
  supportsStructuredOutput: true,
  latencyRank: tier === 'FAST' ? 0 : 2,
  costRank: tier === 'FAST' ? 0 : 2,
  ...extra,
});

describe('adaptive model route intent', () => {
  it('selects a fast certified route for low-risk work', () => {
    expect(
      planAdaptiveModelRoute({
        taskClass: 'QUICK_REPLY',
        dataClass: 'HOSTED_ALLOWED',
        risk: 'LOW',
        requiredContextTokens: 1000,
        requireStructuredOutput: false,
        optimization: 'LATENCY',
        allowCertifiedFallback: false,
        candidates: [c('strong', 'b', 'STRONG'), c('fast', 'a', 'FAST')],
      }),
    ).toMatchObject({
      decision: 'ROUTE_INTENT_READY',
      primaryReleaseId: 'fast',
      actualRoutingAuthority: 'MODEL_GATEWAY',
    });
  });

  it('never routes human-only data', () => {
    expect(
      planAdaptiveModelRoute({
        taskClass: 'QUICK_REPLY',
        dataClass: 'HUMAN_ONLY',
        risk: 'LOW',
        requiredContextTokens: 0,
        requireStructuredOutput: false,
        optimization: 'COST',
        allowCertifiedFallback: true,
        candidates: [c('fast', 'a', 'FAST')],
      }),
    ).toEqual({
      decision: 'HUMAN_REQUIRED',
      reason: 'HUMAN_ONLY',
      requiredTier: 'FAST',
    });
  });

  it('requires strong certification for high-risk complex work', () => {
    expect(
      planAdaptiveModelRoute({
        taskClass: 'COMPLEX_REASONING',
        dataClass: 'HOSTED_ALLOWED',
        risk: 'HIGH',
        requiredContextTokens: 1000,
        requireStructuredOutput: true,
        optimization: 'QUALITY',
        allowCertifiedFallback: false,
        candidates: [c('fast', 'a', 'FAST')],
      }),
    ).toEqual({
      decision: 'HUMAN_REQUIRED',
      reason: 'NO_CERTIFIED_ROUTE',
      requiredTier: 'STRONG',
    });
  });

  it('uses only a separately certified fallback on a different provider', () => {
    expect(
      planAdaptiveModelRoute({
        taskClass: 'QUICK_REPLY',
        dataClass: 'HOSTED_ALLOWED',
        risk: 'LOW',
        requiredContextTokens: 10,
        requireStructuredOutput: false,
        optimization: 'LATENCY',
        allowCertifiedFallback: true,
        candidates: [
          c('primary', 'a', 'FAST'),
          c('same', 'a', 'BALANCED', { fallbackCertificationRef: 'fb.same' }),
          c('backup', 'b', 'BALANCED', { fallbackCertificationRef: 'fb.backup' }),
        ],
      }),
    ).toMatchObject({
      decision: 'ROUTE_INTENT_READY',
      primaryReleaseId: 'primary',
      fallbackReleaseId: 'backup',
    });
  });
});

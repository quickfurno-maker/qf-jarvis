import {
  buildAosEvidencePacket,
  createAosCase,
  createAosRecommendation,
  createAosSignal,
  type AosRecommendationAction,
} from '@qf-jarvis/aos-intelligence';
import { createRecommendationRuntime } from '@qf-jarvis/recommendation-runtime';
import { describe, expect, it } from 'vitest';

import { createAosRecommendationAdapter } from '../index.js';

const createdAt = '2026-10-01T08:00:00.000Z';
const expiresAt = '2026-10-01T08:30:00.000Z';
const correlationId = '11111111-1111-4111-8111-111111111111';

function runtime() {
  let action = 0;
  return createRecommendationRuntime({
    identity: {
      nextRecommendationId: () => '22222222-2222-4222-8222-222222222222',
      nextActionId: () => {
        action += 1;
        return action === 1
          ? '33333333-3333-4333-8333-333333333333'
          : '44444444-4444-4444-8444-444444444444';
      },
    },
  });
}

function aosRecommendation(action: AosRecommendationAction, requiresOwnerReview: boolean) {
  const oneCase = createAosCase('case.adapter', [
    createAosSignal({
      signalId: 'signal.adapter',
      detectorId: 'detector.adapter',
      detectorType: 'SLA',
      caseKey: 'lead-adapter.first-contact',
      subjectRef: 'lead:opaque-adapter',
      priority: 'P1',
      score: 0.9,
      observedAt: createdAt,
      evidenceRefs: ['core:event:adapter'],
      reasonCode: 'AOS_ADAPTER_TEST',
    }),
  ]);
  const packet = buildAosEvidencePacket({
    case: oneCase,
    generatedAt: createdAt,
    policyRefs: ['policy:adapter'],
    facts: [
      {
        factId: 'fact:adapter',
        kind: 'METRIC',
        dataClass: 'OPERATIONAL',
        sourceRef: 'metric:adapter',
        observedAt: createdAt,
        value: 35,
      },
    ],
  });
  return createAosRecommendation(packet, {
    recommendationId: 'recommendation.adapter',
    action,
    confidence: 0.93,
    rationale: 'The governed AOS case passed evidence binding and critic validation.',
    evidenceRefs: ['fact:adapter'],
    policyRefs: ['policy:adapter'],
    requiresOwnerReview,
  });
}

function submit(
  action: AosRecommendationAction,
  requiresOwnerReview: boolean,
  casePriority: 'P0' | 'P1' | 'P2' | 'P3' = 'P1',
) {
  return createAosRecommendationAdapter(runtime()).create({
    recommendation: aosRecommendation(action, requiresOwnerReview),
    casePriority,
    subject: { entityType: 'lead', entityId: 'lead-opaque-adapter' },
    createdAt,
    expiresAt,
    correlationId,
  });
}

describe('AOS -> governed RecommendationV1 adapter', () => {
  it('routes replacement-vendor proposals into founder approval with no direct execution authority', () => {
    const result = submit('REQUEST_REPLACEMENT_BATCH', true);

    expect(result.recommendation).toMatchObject({
      producingSystem: 'qf-jarvis',
      producingAgent: 'jarvis',
      priority: 'high',
      risk: 'high-risk-or-novel',
      requiredApproval: 'founder',
      confidence: 0.93,
    });
    expect(result.recommendation.proposedActions).toEqual([
      {
        actionId: '33333333-3333-4333-8333-333333333333',
        actionType: 'request-replacement-vendor',
        actionContractVersion: 1,
        summary: 'Request review of one additional eligible vendor.',
        parameters: { additionalVendorCount: 1 },
      },
    ]);
    expect(result.actionBindings).toHaveLength(1);
    expect(result.actionBindings[0]?.actionFingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('keeps routine vendor follow-up on the existing human approval path rather than self-authorizing', () => {
    const result = submit('REQUEST_VENDOR_REMINDER', false, 'P2');
    expect(result.recommendation).toMatchObject({
      priority: 'medium',
      risk: 'client-or-vendor-facing-communication',
      requiredApproval: 'authorized-team-human',
    });
    expect(result.recommendation.proposedActions[0]?.parameters).toEqual({});
  });

  it('turns internal review findings into informational recommendations with no executable action', () => {
    const result = submit('REQUEST_SUPPLY_REVIEW', true, 'P1');
    expect(result.recommendation).toMatchObject({
      risk: 'informational',
      requiredApproval: 'none',
    });
    expect(result.recommendation.proposedActions).toEqual([]);
    expect(result.actionBindings).toEqual([]);
  });

  it('never embeds client or vendor contact details in proposed action parameters', () => {
    for (const action of [
      'REQUEST_CLIENT_FOLLOW_UP',
      'REQUEST_SATISFACTION_CHECK',
      'REQUEST_RELATED_SERVICE_SUGGESTION',
      'REQUEST_RECHARGE_NUDGE',
      'REQUEST_VENDOR_REACTIVATION',
    ] as const) {
      const result = submit(action, false, 'P2');
      const serialized = JSON.stringify(result.recommendation.proposedActions);
      expect(serialized).not.toMatch(/phone|mobile|whatsapp|email|recipient/iu);
    }
  });

  it('maps business priority from the AOS case, never from confidence', () => {
    expect(submit('REQUEST_VENDOR_REMINDER', false, 'P0').recommendation.priority).toBe('critical');
    expect(submit('REQUEST_VENDOR_REMINDER', false, 'P3').recommendation.priority).toBe('low');
  });
});

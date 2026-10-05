import {
  AOS_BEHAVIOUR_REGISTRY_V1,
  buildAosEvidencePacket,
  createAosCase,
  createAosRecommendation,
  createAosSignal,
} from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';
import type {
  DecisionProvider,
  DecisionRequest,
  DecisionResult,
} from '@qf-jarvis/decision-intelligence';
import {
  createModelCapabilityProfile,
  createProviderReleaseRef,
  type EvaluationEvidenceVerifier,
  type EvidenceVerificationRequest,
  type ModelCapabilityProfile,
  type ModelRequest,
  type ModelResponse,
} from '@qf-jarvis/model-gateway';
import { createAdaptiveModelRoutingPolicy } from '@qf-jarvis/model-intelligence-control';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { describe, expect, it, vi } from 'vitest';

import {
  classifyAosAdaptiveComplexity,
  compareAosPoliciesInDigitalTwin,
  createAosCanonicalRecommendationProjector,
  createAosDecisionAdjudicator,
  createCertifiedAosModelReasoner,
  selectAosCertifiedModelRelease,
} from '../index.js';

const at = '2026-10-01T10:30:00.000Z';

function aosCaseAndRecommendation() {
  const signal = createAosSignal({
    signalId: 'signal.governance.vendor',
    detectorId: 'detector.governance',
    detectorType: 'BUSINESS_EVENT',
    caseKey: 'vendor:test:follow-up',
    subjectRef: 'vendor:test',
    priority: 'P1',
    score: 1,
    observedAt: at,
    evidenceRefs: ['core:event:test'],
    reasonCode: 'TEST',
  });
  const oneCase = createAosCase('case.aos.governance-test', [signal]);
  const packet = buildAosEvidencePacket({
    case: oneCase,
    generatedAt: at,
    policyRefs: ['policy:test'],
    facts: [
      {
        factId: 'fact:test',
        kind: 'CORE_FACT',
        dataClass: 'OPERATIONAL',
        sourceRef: 'core:event:test',
        observedAt: at,
        value: true,
      },
    ],
  });
  const recommendation = createAosRecommendation(packet, {
    recommendationId: 'recommendation.governance-test',
    action: 'REQUEST_VENDOR_REMINDER',
    confidence: 0.92,
    rationale: 'A governed vendor follow-up is supported by the evidence.',
    alternatives: ['REQUEST_HUMAN_REVIEW'],
    evidenceRefs: ['fact:test'],
    policyRefs: ['policy:test'],
    requiresOwnerReview: false,
  });
  return { oneCase, recommendation };
}

const FAST_DIGEST = 'a'.repeat(64);
const STRONG_DIGEST = 'b'.repeat(64);

function profile(releaseId: 'fast' | 'strong'): ModelCapabilityProfile {
  return createModelCapabilityProfile({
    release: createProviderReleaseRef({
      releaseId,
      providerId: 'openai',
      modelId: releaseId === 'fast' ? 'gpt-5.6-luna' : 'gpt-5.6-sol',
      modelVersion: 'v1',
      executionClass: 'HOSTED',
      configDigest: releaseId === 'fast' ? FAST_DIGEST : STRONG_DIGEST,
    }),
    taskClasses: ['TOOL_INTENT_PROPOSAL'],
    resultModes: ['STRUCTURED'],
    structuredOutputMode: 'strict-json-schema',
    maxInputTokens: 32_000,
    maxCompletionTokens: 4_000,
    supportsTimeout: true,
    supportsCancellation: true,
    evaluationApprovalRef: 'evaluation.' + releaseId,
  });
}

function routingPolicy() {
  return createAdaptiveModelRoutingPolicy({
    policyRef: 'qfj.aos.model-routing.test.v1',
    releaseOrderByComplexity: {
      SIMPLE: ['fast', 'strong'],
      STANDARD: ['fast', 'strong'],
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
    fallbackEnabled: false,
    certifiedFallbackByPrimary: {},
  });
}

function verifier(): EvaluationEvidenceVerifier {
  return Object.freeze({
    verify(request: EvidenceVerificationRequest) {
      const release = request.release.releaseId;
      const expectedDigest = release === 'fast' ? 'c'.repeat(64) : 'd'.repeat(64);
      const expectedEvaluation = 'evaluation.' + release;
      const expectedProfile = 'cap.' + release + '.v1';
      if (
        request.evaluationRef === expectedEvaluation &&
        request.evidenceDigest === expectedDigest &&
        request.capabilityProfileRef === expectedProfile &&
        request.approvalTarget === 'ACTIVE_MODEL_RELEASE' &&
        request.mode === 'ACTIVE'
      ) {
        return Object.freeze({ ok: true as const });
      }
      return Object.freeze({ ok: false as const, reason: 'evidence-missing' as const });
    },
  });
}

function modelResponse(request: ModelRequest): ModelResponse {
  return {
    runId: request.runId,
    resultMode: 'STRUCTURED',
    structuredResult: {
      action: 'REQUEST_VENDOR_REMINDER',
      confidence: 0.9,
      rootCause: 'Vendor first contact is overdue.',
      rationale: 'Use the reviewed vendor-reminder candidate.',
      alternatives: [],
      needsHumanReview: false,
    },
    provenance: {
      runId: request.runId,
      purpose: request.purpose,
      providerId: 'openai',
      modelId: 'test',
      modelVersion: 'v1',
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      promptDigest: request.promptDigest,
      mode: 'SHADOW',
      usedFallback: false,
      attempts: 1,
    },
    usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    latencyMs: 25,
    finishStatus: 'completed',
  };
}

function decisionResult(
  request: DecisionRequest,
  candidateAction: string,
  humanProbability = 0.05,
): DecisionResult {
  return {
    providerId: 'typesafe-jev',
    model: 'jev-test',
    answers: {
      task_shape: {
        type: 'CHOICE',
        choice: 'ACTION_REVIEW',
        confidence: 0.95,
        probabilities: { ACTION_REVIEW: 0.95 },
      },
      ambiguity: {
        type: 'SCORE',
        score: 0.1,
        confidence: 0.95,
        probabilities: { clear: 0.95 },
      },
      human_review: {
        type: 'BOOLEAN',
        probability: humanProbability,
      },
      candidate_action: {
        type: 'CHOICE',
        choice: candidateAction,
        confidence: 0.95,
        probabilities: { [candidateAction]: 0.95 },
      },
    },
    usage: { inputTokens: JSON.stringify(request.state).length, outputTokens: 20 },
  };
}

describe('AOS governed extension integration', () => {
  it('uses existing Model Intelligence Control to keep routine work on a certified fast release', () => {
    expect(
      classifyAosAdaptiveComplexity({
        route: 'ROUTINE',
        factCount: 3,
        policyCount: 1,
        noveltyScore: 0.1,
        evidenceConflictCount: 0,
        highRisk: false,
      }),
    ).toBe('SIMPLE');

    const selected = selectAosCertifiedModelRelease({
      signals: {
        route: 'ROUTINE',
        factCount: 3,
        policyCount: 1,
        noveltyScore: 0.1,
        evidenceConflictCount: 0,
        highRisk: false,
      },
      profiles: [profile('fast'), profile('strong')],
      policy: routingPolicy(),
      evidenceVerifier: verifier(),
    });
    expect(selected).toMatchObject({
      decision: 'CERTIFIED_RELEASE_SELECTED',
      release: { releaseId: 'fast' },
      executionAuthority: 'NONE',
      businessEffect: false,
    });
  });

  it('uses the exact certified release invoker instead of an ungoverned model choice', async () => {
    const fast = vi.fn((request: ModelRequest) =>
      Promise.resolve({
        ok: true as const,
        response: modelResponse(request),
      }),
    );
    const strong = vi.fn((request: ModelRequest) =>
      Promise.resolve({
        ok: true as const,
        response: modelResponse(request),
      }),
    );
    const invokers: Readonly<Record<string, ModelGatewayInvoker>> = {
      fast: { invoke: fast },
      strong: { invoke: strong },
    };
    const selections: string[] = [];
    const reasoner: AosModelReasoner = createCertifiedAosModelReasoner({
      profiles: [profile('fast'), profile('strong')],
      policy: routingPolicy(),
      evidenceVerifier: verifier(),
      invokersByReleaseId: invokers,
      onSelection: (event) => {
        if (event.releaseId !== undefined) selections.push(event.releaseId);
      },
    });
    const { oneCase } = aosCaseAndRecommendation();
    const packet = buildAosEvidencePacket({
      case: oneCase,
      generatedAt: at,
      policyRefs: ['policy:test'],
      facts: [
        {
          factId: 'fact:model-test',
          kind: 'METRIC',
          dataClass: 'OPERATIONAL',
          sourceRef: 'metric:test',
          observedAt: at,
          value: 1,
        },
      ],
    });

    const result = await reasoner.reason({
      runId: 'aos.model.test',
      packet,
      route: 'ROUTINE',
      allowedActions: ['REQUEST_VENDOR_REMINDER'],
      routingSignals: {
        priority: 'P2',
        noveltyScore: 0.1,
        evidenceConflictCount: 0,
        highRisk: false,
      },
    });

    expect(result.ok).toBe(true);
    expect(selections).toEqual(['fast']);
    expect(fast).toHaveBeenCalledTimes(1);
    expect(strong).not.toHaveBeenCalled();
  });

  it('uses decision intelligence / Jev-compatible adjudication only for non-routine cases', async () => {
    const provider: DecisionProvider = {
      providerId: 'typesafe-jev',
      decide(request) {
        return Promise.resolve(decisionResult(request, 'aos.action.vendor-reminder'));
      },
    };
    const adjudicator = createAosDecisionAdjudicator({ provider });
    const { recommendation } = aosCaseAndRecommendation();

    await expect(
      adjudicator.adjudicate({
        caseRef: 'case.aos.routine',
        recommendation,
        signals: {
          priority: 'P2',
          noveltyScore: 0.1,
          evidenceConflictCount: 0,
          recommendationConfidence: 0.92,
          ownerReviewAlreadyRequired: false,
        },
      }),
    ).resolves.toMatchObject({ outcome: 'SKIPPED' });

    await expect(
      adjudicator.adjudicate({
        caseRef: 'case.aos.conflict',
        recommendation,
        signals: {
          priority: 'P1',
          noveltyScore: 0.2,
          evidenceConflictCount: 1,
          recommendationConfidence: 0.92,
          ownerReviewAlreadyRequired: false,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'ADVISORY_AGREES',
      providerId: 'typesafe-jev',
      recommendedAction: 'REQUEST_VENDOR_REMINDER',
      executionAuthority: 'NONE',
    });
  });

  it('turns a Jev-compatible disagreement into a human-review hold, never an alternate execution', async () => {
    const provider: DecisionProvider = {
      providerId: 'typesafe-jev',
      decide(request) {
        return Promise.resolve(decisionResult(request, 'aos.action.human-review'));
      },
    };
    const adjudicator = createAosDecisionAdjudicator({ provider });
    const { recommendation } = aosCaseAndRecommendation();
    await expect(
      adjudicator.adjudicate({
        caseRef: 'case.aos.disagreement',
        recommendation,
        signals: {
          priority: 'P1',
          noveltyScore: 0.9,
          evidenceConflictCount: 0,
          recommendationConfidence: 0.92,
          ownerReviewAlreadyRequired: false,
        },
      }),
    ).resolves.toMatchObject({
      outcome: 'HOLD_FOR_HUMAN_REVIEW',
      reason: 'ADVISORY_DISAGREES',
      executionAuthority: 'NONE',
      businessEffect: false,
    });
  });

  it('requires zero-effect Digital Twin rehearsal for a policy revision and surfaces regressions', async () => {
    const baseline = AOS_BEHAVIOUR_REGISTRY_V1.policies.find(
      (policy) => policy.policyId === 'lead.vendor-first-contact-recovery',
    );
    if (baseline === undefined) throw new Error('fixture-missing');
    const candidate = {
      ...baseline,
      version: baseline.version + 1,
      conditions: [{ field: 'elapsedMinutes' as const, operator: 'GTE' as const, value: 60 }],
    };
    const result = await compareAosPoliciesInDigitalTwin({
      baseline,
      candidate,
      scenarios: [
        {
          scenarioId: 'first-contact-25m',
          trigger: 'VENDOR_FIRST_CONTACT_MISSING',
          context: { metrics: { elapsedMinutes: 25 } },
          expectedAction: 'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP',
        },
      ],
    });
    expect(result.baseline.suite.failed).toBe(0);
    expect(result.candidate.suite.failed).toBe(1);
    expect(result.comparison.regressions).toEqual(['first-contact-25m']);
    expect(result.safeForOwnerReview).toBe(false);
    expect(result.activationAuthorized).toBe(false);
  });

  it('projects accepted AOS advice through the canonical recommendation runtime without authorization', () => {
    const { oneCase, recommendation } = aosCaseAndRecommendation();
    const projected = createAosCanonicalRecommendationProjector().project({
      case: oneCase,
      recommendation,
      createdAt: at,
    });
    expect(projected).toMatchObject({
      protocol: 'qfj.aos.canonical-recommendation.v1',
      executionAuthority: 'NONE',
      businessEffect: false,
      canonical: {
        recommendation: {
          producingAgent: 'jarvis',
          producingAgentVersion: 'aos-v2',
          subject: { entityType: 'vendor', entityId: 'test' },
          requiredApproval: 'authorized-team-human',
        },
      },
    });
  });
});

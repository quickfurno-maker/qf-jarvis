import { describe, expect, it } from 'vitest';

import {
  AOS_BEHAVIOUR_REGISTRY_V1,
  AOS_PIPELINE_V1,
  assessAosCapabilityMaturity,
  buildAosEvidencePacket,
  buildAosOwnerAttentionItem,
  chooseAosModelRoute,
  chooseAosGoal,
  createAosBehaviourManifest,
  createAosBehaviourRuntimeBinding,
  createAosCase,
  createAosPolicyRevision,
  createAosRecommendation,
  createAosSignal,
  critiqueAosRecommendation,
  detectRelativeAnomaly,
  detectSlaBreach,
  detectSupplyDemandPressure,
  evaluateAosAiBudget,
  evaluateAosBehaviourPolicy,
  planAosClientNextBestAction,
  planAosVendorNextBestAction,
  policyVersionRefsForRegistry,
  proposeAosPolicyReview,
  simulateAosPolicyChange,
  summarizeAosCapabilityLearning,
  transitionAosCase,
} from '../index.js';

const now = '2026-10-01T04:30:00.000Z';

describe('AOS v2 sentry and case engine', () => {
  it('detects a first-contact SLA breach without business authority', () => {
    const signal = detectSlaBreach({
      signalId: 'signal.lead-1.vendor-1.sla',
      detectorId: 'detector.vendor-first-contact',
      caseKey: 'lead-1.first-contact',
      subjectRef: 'lead:1',
      elapsedMs: 25 * 60 * 1000,
      thresholdMs: 20 * 60 * 1000,
      priority: 'P1',
      observedAt: now,
      evidenceRefs: ['core:event:1'],
      reasonCode: 'VENDOR_FIRST_CONTACT_SLA',
    });
    expect(signal).toMatchObject({
      detectorType: 'SLA',
      priority: 'P1',
      executionAuthority: 'NONE',
      businessEffect: false,
    });
  });

  it('correlates multiple detector signals into one case and preserves strongest priority', () => {
    const first = createAosSignal({
      signalId: 'signal.one',
      detectorId: 'detector.sla',
      detectorType: 'SLA',
      caseKey: 'lead-2.delivery',
      subjectRef: 'lead:2',
      priority: 'P2',
      score: 0.7,
      observedAt: now,
      evidenceRefs: ['core:event:2'],
      reasonCode: 'SLA_BREACH',
    });
    const second = createAosSignal({
      signalId: 'signal.two',
      detectorId: 'detector.supply',
      detectorType: 'SUPPLY_DEMAND',
      caseKey: 'lead-2.delivery',
      subjectRef: 'lead:2',
      priority: 'P1',
      score: 0.9,
      observedAt: '2026-10-01T04:31:00.000Z',
      evidenceRefs: ['core:event:3'],
      reasonCode: 'SUPPLY_PRESSURE',
    });
    const current = createAosCase('case.lead-2.delivery', [first, second]);
    expect(current.priority).toBe('P1');
    expect(current.signalIds).toEqual(['signal.one', 'signal.two']);
    expect(current.executionAuthority).toBe('NONE');
    expect(transitionAosCase(current, 'ANALYZING').state).toBe('ANALYZING');
    expect(() => transitionAosCase(current, 'ACTIONED')).toThrow('aos-case-transition-invalid');
  });

  it('detects anomalies and supply pressure deterministically before any model call', () => {
    expect(
      detectRelativeAnomaly({
        signalId: 'signal.response-rate',
        detectorId: 'detector.response-rate',
        caseKey: 'market.pune.sofa',
        subjectRef: 'market:pune:sofa',
        current: 0.45,
        baseline: 0.8,
        minimumRelativeDelta: 0.2,
        direction: 'LOW_IS_BAD',
        warningPriority: 'P2',
        criticalPriority: 'P1',
        observedAt: now,
        evidenceRefs: ['metric:vendor-response'],
        reasonCode: 'VENDOR_RESPONSE_DROP',
      }),
    ).toMatchObject({ detectorType: 'RELATIVE_ANOMALY', priority: 'P1' });
    expect(
      detectSupplyDemandPressure({
        signalId: 'signal.supply',
        detectorId: 'detector.supply-demand',
        caseKey: 'market.baner.interior',
        subjectRef: 'market:baner:interior',
        openDemand: 20,
        eligibleSupply: 2,
        maximumDemandPerSupply: 3,
        observedAt: now,
        evidenceRefs: ['metric:demand', 'metric:supply'],
        reasonCode: 'SUPPLY_SHORTAGE',
      }),
    ).toMatchObject({ detectorType: 'SUPPLY_DEMAND', priority: 'P1' });
  });
});

describe('AOS evidence, reasoning and critic', () => {
  const signal = createAosSignal({
    signalId: 'signal.case-1',
    detectorId: 'detector.sla',
    detectorType: 'SLA',
    caseKey: 'lead-3.first-contact',
    subjectRef: 'lead:3',
    priority: 'P1',
    score: 0.8,
    observedAt: now,
    evidenceRefs: ['core:event:4'],
    reasonCode: 'VENDOR_FIRST_CONTACT_SLA',
  });
  const currentCase = createAosCase('case.lead-3', [signal]);
  const packet = buildAosEvidencePacket({
    case: currentCase,
    generatedAt: now,
    policyRefs: ['policy:lead:first-contact'],
    facts: [
      {
        factId: 'fact:elapsed-minutes',
        kind: 'METRIC',
        dataClass: 'OPERATIONAL',
        sourceRef: 'metric:elapsed',
        observedAt: now,
        value: 25,
      },
    ],
  });
  it('builds compact direct-PII-free evidence and rejects phone-like free text', () => {
    expect(packet.containsDirectPii).toBe(false);
    expect(packet.facts).toHaveLength(1);
    expect(() =>
      buildAosEvidencePacket({
        case: currentCase,
        generatedAt: now,
        policyRefs: [],
        facts: [
          {
            factId: 'fact:unsafe',
            kind: 'CORE_FACT',
            dataClass: 'OPERATIONAL',
            sourceRef: 'core:unsafe',
            observedAt: now,
            value: 'call 9876543210',
          },
        ],
      }),
    ).toThrow('aos-evidence-fact-invalid');
  });

  it('routes cheap deterministic cases away from models and escalates novel/high-risk cases', () => {
    expect(
      chooseAosModelRoute({
        priority: 'P3',
        noveltyScore: 0.1,
        evidenceConflictCount: 0,
        similarResolvedCaseCount: 20,
        routineBudgetAvailable: true,
        deepBudgetAvailable: true,
      }),
    ).toBe('NO_MODEL');
    expect(
      chooseAosModelRoute({
        priority: 'P0',
        noveltyScore: 0.9,
        evidenceConflictCount: 1,
        similarResolvedCaseCount: 0,
        routineBudgetAvailable: true,
        deepBudgetAvailable: true,
      }),
    ).toBe('DEEP');
  });
  it('creates evidence-bound recommendations that never authorize execution', () => {
    const recommendation = createAosRecommendation(packet, {
      recommendationId: 'recommendation.lead-3.follow-up',
      action: 'REQUEST_VENDOR_REMINDER',
      confidence: 0.9,
      rationale: 'The assigned vendor has exceeded the configured first-contact SLA.',
      evidenceRefs: ['fact:elapsed-minutes'],
      policyRefs: ['policy:lead:first-contact'],
      alternatives: ['REQUEST_REPLACEMENT_BATCH'],
    });
    expect(recommendation).toMatchObject({
      requiresCoreDecision: true,
      requiresOwnerReview: true,
      executionAuthorized: false,
      businessEffect: false,
    });
    expect(critiqueAosRecommendation(currentCase, packet, recommendation)).toEqual({
      result: 'PASS',
      reasonCodes: [],
      executionAuthorized: false,
    });
  });
});

describe('AOS behaviour control and journeys', () => {
  it('ships suggestion-only policies with three-vendor exposure guardrail', () => {
    expect(AOS_BEHAVIOUR_REGISTRY_V1.policies.length).toBeGreaterThanOrEqual(7);
    for (const policy of AOS_BEHAVIOUR_REGISTRY_V1.policies) {
      expect(policy.executionAuthority).toBe('NONE');
      expect(policy.businessEffect).toBe(false);
      expect(policy.maximumVendorExposureWithoutOwnerApproval).toBe(3);
      expect(policy.communication.directPhoneAllowed).toBe(false);
    }
    const replacement = AOS_BEHAVIOUR_REGISTRY_V1.policies.find(
      (policy) => policy.policyId === 'lead.replacement-vendor',
    );
    expect(replacement?.ownerApprovalRequired).toBe(true);
  });
  it('consumes Core-derived money bands without copying vendor balances into AOS', () => {
    const policy = AOS_BEHAVIOUR_REGISTRY_V1.policies.find(
      (candidate) => candidate.policyId === 'vendor.low-balance',
    );
    expect(policy).toBeDefined();
    if (policy === undefined) throw new Error('fixture-missing');
    expect(policy.conditions).toEqual([]);
    expect(
      evaluateAosBehaviourPolicy(policy, 'VENDOR_LOW_BALANCE', {
        metrics: {},
      }),
    ).toEqual({
      matched: true,
      action: 'RECOMMEND_ANISHA_LOW_BALANCE_ALERT',
    });
    expect(
      evaluateAosBehaviourPolicy(policy, 'MATCHING_DEMAND_DETECTED', {
        metrics: {},
      }),
    ).toEqual({ matched: false, action: 'NONE' });
  });

  it('keeps no-contact as a first-class client and vendor decision', () => {
    expect(
      planAosClientNextBestAction({
        handoffComplete: true,
        successfulVendorContacts: 3,
        satisfactionKnown: true,
        satisfied: true,
        unresolvedIssue: false,
        relatedServiceEligible: true,
        communicationCooldownActive: true,
      }),
    ).toBe('NO_CONTACT');
    expect(
      planAosVendorNextBestAction({
        assignedLeadAwaitingFirstContact: false,
        firstContactSlaBreached: false,
        vendorInactiveDays: 10,
        matchingDemandAvailable: false,
        lowBalance: false,
        depletionPredicted: false,
        communicationCooldownActive: false,
        unresolvedSupportIssue: false,
      }),
    ).toBe('NO_CONTACT');
  });
  it('prioritizes trust and delivery ahead of revenue', () => {
    expect(
      chooseAosGoal([
        { goal: 'REVENUE', score: 1, trustRisk: false, relevant: true },
        {
          goal: 'SUCCESSFUL_LEAD_DELIVERY',
          score: 0.7,
          trustRisk: false,
          relevant: true,
        },
      ]),
    ).toBe('SUCCESSFUL_LEAD_DELIVERY');
    expect(chooseAosGoal([{ goal: 'REVENUE', score: 1, trustRisk: true, relevant: true }])).toBe(
      'NONE',
    );
  });
});

describe('AOS policy governance and maturity', () => {
  it('requires versioned, simulated, owner-activated policy changes', () => {
    const previous = AOS_BEHAVIOUR_REGISTRY_V1.policies[0];
    if (previous === undefined) throw new Error('fixture-missing');
    const next = { ...previous, version: previous.version + 1, priority: 'P2' as const };
    const revision = createAosPolicyRevision({
      previous,
      next,
      changedByRef: 'owner:keshav',
      changedAt: now,
      reason: 'Test lower operational priority before activation.',
    });
    expect(revision).toMatchObject({
      simulationRequired: true,
      digitalTwinRequired: true,
      ownerActivationRequired: true,
    });
    const simulation = simulateAosPolicyChange({
      previous,
      candidate: next,
      scenarios: [
        {
          scenarioId: 'scenario:1',
          trigger: 'VENDOR_FIRST_CONTACT_MISSING',
          context: { metrics: { elapsedMinutes: 25 } },
        },
      ],
    });
    expect(simulation.activationAuthorized).toBe(false);
    expect(simulation.businessEffect).toBe(false);
  });

  it('can earn eligibility for an approval pilot but never production approval', () => {
    expect(
      assessAosCapabilityMaturity({
        sampleCount: 2_000,
        ownerDecisionCount: 1_500,
        ownerAcceptedCount: 1_425,
        resolvedCount: 1_400,
        successfulOutcomeCount: 1_260,
        falsePositiveCount: 10,
        policyViolationCount: 0,
        unsupportedReasoningCount: 2,
      }),
    ).toMatchObject({
      maturity: 'ELIGIBLE_FOR_APPROVAL_PILOT',
      productionApproval: false,
    });
  });

  it('describes the full governed AOS coordination pipeline without granting AOS authority', () => {
    expect(AOS_PIPELINE_V1.mode).toBe('SUGGEST');
    expect(AOS_PIPELINE_V1.executionAuthority).toBe('NONE');
    for (const nodeId of [
      'aos.policy-route',
      'jarvis.model-control',
      'jarvis.jev-adjudication',
      'jarvis.simulation',
      'aos.canonical-recommendation',
      'core.authorization',
    ]) {
      expect(AOS_PIPELINE_V1.nodes.some((node) => node.nodeId === nodeId)).toBe(true);
    }
    expect(
      AOS_PIPELINE_V1.edges.some(
        (edge) =>
          edge.sourceNodeId === 'aos.policy-route' &&
          edge.targetNodeId === 'aos.critic' &&
          edge.label === 'deterministic NO_MODEL',
      ),
    ).toBe(true);
    expect(
      AOS_PIPELINE_V1.edges.some(
        (edge) =>
          edge.sourceNodeId === 'core.authorization' &&
          edge.targetNodeId === 'automation.worker' &&
          edge.kind === 'AUTHORIZED_ACTION',
      ),
    ).toBe(true);
    expect(
      AOS_PIPELINE_V1.edges.some(
        (edge) =>
          (edge.sourceNodeId === 'aos.critic' ||
            edge.sourceNodeId === 'jarvis.jev-adjudication' ||
            edge.sourceNodeId === 'aos.canonical-recommendation') &&
          edge.targetNodeId === 'automation.worker',
      ),
    ).toBe(false);
  });
});

describe('AOS behaviour manifest governance', () => {
  const digest = 'sha256:' + 'b'.repeat(64);
  const manifestInput = {
    manifestId: 'aos.behaviour.registry.v1',
    manifestVersion: 1,
    registryRef: AOS_BEHAVIOUR_REGISTRY_V1.registryRef,
    policyVersionRefs: policyVersionRefsForRegistry(AOS_BEHAVIOUR_REGISTRY_V1),
    configurationDigest: digest,
    createdAt: now,
  } as const;

  it('refuses suggestion-shadow activation without exact simulation and owner approval evidence', () => {
    expect(() =>
      createAosBehaviourManifest({
        ...manifestInput,
        lifecycle: 'SUGGEST_SHADOW',
      }),
    ).toThrow('aos-behaviour-simulation-evidence-invalid');
  });

  it('refuses a simulated manifest that has no zero-effect Digital Twin evidence', () => {
    expect(() =>
      createAosBehaviourManifest({
        ...manifestInput,
        lifecycle: 'SIMULATED',
        simulation: {
          manifestId: manifestInput.manifestId,
          configurationDigest: digest,
          scenarioCount: 2_000,
          reportRef: 'simulation:aos:registry-v1',
          generatedAt: now,
        },
      }),
    ).toThrow('aos-behaviour-digital-twin-evidence-invalid');
  });

  it('binds only an exactly approved and simulated registry to the shadow runtime', () => {
    const manifest = createAosBehaviourManifest({
      ...manifestInput,
      lifecycle: 'SUGGEST_SHADOW',
      simulation: {
        manifestId: manifestInput.manifestId,
        configurationDigest: digest,
        scenarioCount: 2_000,
        reportRef: 'simulation:aos:registry-v1',
        generatedAt: now,
      },
      digitalTwin: {
        manifestId: manifestInput.manifestId,
        configurationDigest: digest,
        scenarioCount: 2_000,
        regressionCount: 0,
        reportRef: 'digital-twin:aos:registry-v1',
        generatedAt: now,
        zeroEffectVerified: true,
      },
      ownerApproval: {
        manifestId: manifestInput.manifestId,
        configurationDigest: digest,
        approvalRef: 'owner-approval:aos:registry-v1',
        approvedAt: now,
      },
    });
    expect(
      createAosBehaviourRuntimeBinding({
        manifest,
        registry: AOS_BEHAVIOUR_REGISTRY_V1,
      }),
    ).toMatchObject({
      mode: 'SUGGEST_SHADOW',
      executionAuthority: 'NONE',
      businessEffect: false,
    });
  });
});

describe('AOS scale controls', () => {
  it('degrades model spend by priority before the monthly circuit breaker is exhausted', () => {
    expect(
      evaluateAosAiBudget({
        monthlyBudget: 100,
        spent: 72,
        priority: 'P3',
      }),
    ).toMatchObject({
      level: 'CONSERVE',
      routineAllowed: false,
      deepAllowed: false,
      asynchronousBatchPreferred: true,
      executionAuthority: 'NONE',
    });

    expect(
      evaluateAosAiBudget({
        monthlyBudget: 100,
        spent: 90,
        priority: 'P1',
      }),
    ).toMatchObject({
      level: 'CRITICAL',
      routineAllowed: true,
      deepAllowed: false,
    });

    expect(
      evaluateAosAiBudget({
        monthlyBudget: 100,
        spent: 100,
        priority: 'P0',
      }),
    ).toMatchObject({
      level: 'EXHAUSTED',
      routineAllowed: false,
      deepAllowed: false,
    });
  });

  it('ranks urgent owner attention deterministically without creating authority', () => {
    const signal = createAosSignal({
      signalId: 'signal.attention',
      detectorId: 'detector.attention',
      detectorType: 'SLA',
      caseKey: 'lead-attention.first-contact',
      subjectRef: 'lead:attention',
      priority: 'P1',
      score: 0.9,
      observedAt: now,
      evidenceRefs: ['core:event:attention'],
      reasonCode: 'FIRST_CONTACT_AT_RISK',
    });
    const currentCase = createAosCase('case.attention', [signal]);
    const packet = buildAosEvidencePacket({
      case: currentCase,
      generatedAt: now,
      policyRefs: ['policy:replacement'],
      facts: [
        {
          factId: 'fact:contact-gap',
          kind: 'METRIC',
          dataClass: 'OPERATIONAL',
          sourceRef: 'metric:contact-gap',
          observedAt: now,
          value: 35,
        },
      ],
    });
    const recommendation = createAosRecommendation(packet, {
      recommendationId: 'recommendation.attention',
      action: 'REQUEST_REPLACEMENT_BATCH',
      confidence: 0.95,
      rationale: 'A replacement review is warranted after the governed contact window.',
      evidenceRefs: ['fact:contact-gap'],
      policyRefs: ['policy:replacement'],
      requiresOwnerReview: true,
    });

    expect(
      buildAosOwnerAttentionItem({
        case: currentCase,
        recommendation,
        ageMinutes: 70,
        repeatedSignalCount: 4,
      }),
    ).toMatchObject({
      lane: 'NOW',
      requiresOwnerReview: true,
      executionAuthority: 'NONE',
      businessEffect: false,
    });
  });
});

describe('AOS outcome learning', () => {
  it('turns real outcomes into evidence without granting self-modification authority', () => {
    const observations = Array.from({ length: 1_200 }, (_, index) => ({
      record: {
        caseId: 'case.learning.' + String(index),
        recommendationId: 'recommendation.learning.' + String(index),
        ownerDecision: index < 1_100 ? ('APPROVE' as const) : ('REJECT' as const),
        outcome: index < 1_020 ? ('RECOVERED' as const) : ('FAILED' as const),
        policyViolation: false,
        unsupportedReasoning: false,
      },
      falsePositive: index >= 1_190,
    }));

    const summary = summarizeAosCapabilityLearning({
      capabilityRef: 'lead.vendor-first-contact-recovery',
      observations,
    });
    const proposal = proposeAosPolicyReview(summary);

    expect(summary.executionAuthority).toBe('NONE');
    expect(summary.businessEffect).toBe(false);
    expect(proposal).toMatchObject({
      protocol: 'qfj.aos.policy-review-proposal.v1',
      simulationRequired: true,
      digitalTwinRequired: true,
      ownerApprovalRequired: true,
      autoApplyAllowed: false,
      executionAuthority: 'NONE',
      businessEffect: false,
    });
  });

  it('holds a capability after any observed policy violation', () => {
    const summary = summarizeAosCapabilityLearning({
      capabilityRef: 'vendor.reactivation',
      observations: [
        {
          record: {
            caseId: 'case.violation',
            recommendationId: 'recommendation.violation',
            ownerDecision: 'APPROVE',
            outcome: 'RECOVERED',
            policyViolation: true,
            unsupportedReasoning: false,
          },
          falsePositive: false,
        },
      ],
    });

    expect(proposeAosPolicyReview(summary)).toMatchObject({
      direction: 'HOLD_CAPABILITY',
      autoApplyAllowed: false,
    });
  });

  it('proposes threshold review for excessive false positives rather than changing it itself', () => {
    const observations = Array.from({ length: 100 }, (_, index) => ({
      record: {
        caseId: 'case.false-positive.' + String(index),
        recommendationId: 'recommendation.false-positive.' + String(index),
        ownerDecision: 'REJECT' as const,
        outcome: 'NO_CHANGE' as const,
        policyViolation: false,
        unsupportedReasoning: false,
      },
      falsePositive: index < 10,
    }));

    const summary = summarizeAosCapabilityLearning({
      capabilityRef: 'marketplace.response-degradation',
      observations,
    });

    expect(proposeAosPolicyReview(summary)).toMatchObject({
      direction: 'REVIEW_DETECTION_THRESHOLD',
      simulationRequired: true,
      digitalTwinRequired: true,
      ownerApprovalRequired: true,
      autoApplyAllowed: false,
    });
  });
});

describe('AOS cost-aware model routing', () => {
  it('keeps known deterministic business cases off the model path even when budget is available', () => {
    expect(
      chooseAosModelRoute({
        priority: 'P1',
        noveltyScore: 0.1,
        evidenceConflictCount: 0,
        similarResolvedCaseCount: 500,
        deterministicRecommendationAvailable: true,
        routineBudgetAvailable: true,
        deepBudgetAvailable: true,
      }),
    ).toBe('NO_MODEL');
  });

  it('still escalates a deterministic case when evidence conflicts', () => {
    expect(
      chooseAosModelRoute({
        priority: 'P1',
        noveltyScore: 0.1,
        evidenceConflictCount: 1,
        similarResolvedCaseCount: 500,
        deterministicRecommendationAvailable: true,
        routineBudgetAvailable: true,
        deepBudgetAvailable: true,
      }),
    ).toBe('DEEP');
  });
});

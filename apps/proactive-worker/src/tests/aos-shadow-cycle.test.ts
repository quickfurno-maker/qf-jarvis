import { describe, expect, it } from 'vitest';
import { digestAosBehaviourRegistry } from '@qf-jarvis/aos-behaviour-control';
import {
  AOS_BEHAVIOUR_REGISTRY_V1,
  createAosBehaviourManifest,
  createAosBehaviourPolicy,
  createAosBehaviourRegistry,
  createAosBehaviourRuntimeBinding,
  policyVersionRefsForRegistry,
} from '@qf-jarvis/aos-intelligence';
import type { AosModelReasoner } from '@qf-jarvis/aos-model-reasoning';

import {
  runAosShadowCycle,
  type AosShadowCycleInput,
  type AosShadowPersistencePort,
} from '../index.js';

const at = '2026-10-01T05:00:00.000Z';

function cycle(elapsedMinutes: number): AosShadowCycleInput {
  return {
    cycleId: 'aos.shadow.test-1',
    batch: {
      batchId: 'batch.test-1',
      generatedAt: at,
      executionAuthority: 'NONE',
      businessEffect: false,
      observations: [
        {
          kind: 'SLA',
          input: {
            signalId: 'signal.vendor-contact',
            detectorId: 'detector.vendor-contact',
            caseKey: 'lead-100.first-contact',
            subjectRef: 'lead:100',
            elapsedMs: elapsedMinutes * 60 * 1000,
            thresholdMs: 20 * 60 * 1000,
            priority: 'P1',
            observedAt: at,
            evidenceRefs: ['core:event:100'],
            reasonCode: 'VENDOR_FIRST_CONTACT_SLA',
          },
        },
      ],
    },
    caseMaterial: [
      {
        caseKey: 'lead-100.first-contact',
        facts: [
          {
            factId: 'fact:elapsed-minutes',
            kind: 'METRIC',
            dataClass: 'OPERATIONAL',
            sourceRef: 'metric:first-contact',
            observedAt: at,
            value: elapsedMinutes,
          },
          {
            factId: 'fact:successful-contacts',
            kind: 'CORE_FACT',
            dataClass: 'OPERATIONAL',
            sourceRef: 'core:lead-handoff',
            observedAt: at,
            value: 1,
          },
        ],
        policyRefs: ['policy:lead-delivery'],
        behaviours: [
          {
            trigger: 'VENDOR_FIRST_CONTACT_MISSING',
            context: {
              metrics: {
                elapsedMinutes,
                successfulVendorContacts: 1,
                vendorExposureCount: 3,
              },
            },
          },
        ],
        routing: {
          noveltyScore: 0.1,
          evidenceConflictCount: 0,
          similarResolvedCaseCount: 20,
          routineBudgetAvailable: false,
          deepBudgetAvailable: false,
        },
      },
    ],
  };
}

describe('AOS shadow runtime cycle', () => {
  it('turns a deterministic first-contact breach into a suggestion only', async () => {
    const result = await runAosShadowCycle(cycle(25));
    expect(result).toMatchObject({
      protocol: 'qfj.aos.shadow-cycle.v1',
      observations: 1,
      signals: 1,
      recommendations: 1,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.cases[0]).toMatchObject({
      route: 'NO_MODEL',
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_VENDOR_REMINDER',
        executionAuthorized: false,
        businessEffect: false,
      },
    });
  });

  it('recommends replacement review only from the lead-level contact gap after the longer threshold', async () => {
    const input = cycle(35);
    const material = input.caseMaterial[0];
    if (material === undefined) throw new Error('fixture-missing');
    const result = await runAosShadowCycle({
      ...input,
      caseMaterial: [
        {
          ...material,
          behaviours: [
            {
              trigger: 'LEAD_FIRST_CONTACT_GAP',
              context: material.behaviours[0]?.context ?? {
                metrics: {
                  elapsedMinutes: 35,
                  successfulVendorContacts: 1,
                  vendorExposureCount: 3,
                },
              },
            },
          ],
        },
      ],
    });
    expect(result.cases[0]?.recommendation).toMatchObject({
      action: 'REQUEST_REPLACEMENT_BATCH',
      requiresCoreDecision: true,
      requiresOwnerReview: true,
      executionAuthorized: false,
    });
  });

  it('fails closed when model reasoning is required but unavailable', async () => {
    const input = cycle(25);
    const material = input.caseMaterial[0];
    if (material === undefined) throw new Error('fixture-missing');
    const result = await runAosShadowCycle({
      ...input,
      caseMaterial: [
        {
          ...material,
          routing: {
            ...material.routing,
            evidenceConflictCount: 1,
            routineBudgetAvailable: true,
          },
        },
      ],
    });
    expect(result.cases[0]).toMatchObject({
      route: 'ROUTINE',
      reason: 'MODEL_REQUIRED_BUT_UNAVAILABLE',
    });
    expect(result.recommendations).toBe(0);
  });

  it('accepts a governed model candidate only through critic and evidence binding', async () => {
    const input = cycle(25);
    const material = input.caseMaterial[0];
    if (material === undefined) throw new Error('fixture-missing');
    const reasoner: AosModelReasoner = {
      reason(reasonInput) {
        expect(reasonInput.allowedActions).toContain('REQUEST_VENDOR_REMINDER');
        return Promise.resolve({
          ok: true,
          route: reasonInput.route,
          candidate: {
            recommendationId: 'recommendation.model-test',
            action: 'REQUEST_VENDOR_REMINDER',
            confidence: 0.93,
            rationale: 'First-contact SLA is breached and the configured follow-up policy applies.',
            alternatives: [],
            evidenceRefs: ['fact:elapsed-minutes'],
            policyRefs: [...reasonInput.packet.policyRefs],
          },
          latencyMs: 10,
          executionAuthority: 'NONE',
          businessEffect: false,
        });
      },
    };

    const result = await runAosShadowCycle(
      {
        ...input,
        caseMaterial: [
          {
            ...material,
            routing: {
              ...material.routing,
              evidenceConflictCount: 1,
              routineBudgetAvailable: true,
            },
          },
        ],
      },
      reasoner,
    );
    expect(result.cases[0]).toMatchObject({
      route: 'ROUTINE',
      reason: 'MODEL_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_VENDOR_REMINDER',
        executionAuthorized: false,
      },
      critique: { result: 'PASS' },
    });
  });

  it('accepts a validated injected behaviour registry so thresholds can change without runtime code changes', async () => {
    const policy = createAosBehaviourPolicy({
      policyId: 'custom.vendor-first-contact',
      version: 1,
      lifecycle: 'SUGGESTING',
      title: 'Custom first-contact threshold',
      trigger: 'VENDOR_FIRST_CONTACT_MISSING',
      priority: 'P1',
      scope: { cityRefs: [], localityRefs: [], categoryRefs: [] },
      conditions: [{ field: 'elapsedMinutes', operator: 'GTE', value: 10 }],
      action: 'RECOMMEND_ANISHA_VENDOR_FOLLOW_UP',
      ownerApprovalRequired: false,
      coreDecisionRequired: true,
      maximumVendorExposureWithoutOwnerApproval: 3,
      communication: {
        cooldownMinutes: 10,
        maxMessagesPer30Days: 8,
        directPhoneAllowed: false,
        maskedOpportunityOnly: true,
      },
    });
    const baseInput = cycle(15);
    const firstObservation = baseInput.batch.observations[0];
    if (firstObservation?.kind !== 'SLA') {
      throw new Error('fixture-missing');
    }
    const input: AosShadowCycleInput = {
      ...baseInput,
      batch: {
        ...baseInput.batch,
        observations: [
          {
            ...firstObservation,
            input: { ...firstObservation.input, thresholdMs: 60_000 },
          },
        ],
      },
    };
    const registry = createAosBehaviourRegistry({
      registryRef: 'qfj.aos.behaviour-registry.test',
      policies: [policy],
    });
    const digest = digestAosBehaviourRegistry(registry);
    const manifest = createAosBehaviourManifest({
      manifestId: 'aos.behaviour.test.v1',
      manifestVersion: 1,
      lifecycle: 'SUGGEST_SHADOW',
      registryRef: registry.registryRef,
      policyVersionRefs: policyVersionRefsForRegistry(registry),
      configurationDigest: digest,
      createdAt: at,
      simulation: {
        manifestId: 'aos.behaviour.test.v1',
        configurationDigest: digest,
        scenarioCount: 100,
        reportRef: 'simulation:aos:test-v1',
        generatedAt: at,
      },
      digitalTwin: {
        manifestId: 'aos.behaviour.test.v1',
        configurationDigest: digest,
        scenarioCount: 100,
        regressionCount: 0,
        reportRef: 'digital-twin:aos:test-v1',
        generatedAt: at,
        zeroEffectVerified: true,
      },
      ownerApproval: {
        manifestId: 'aos.behaviour.test.v1',
        configurationDigest: digest,
        approvalRef: 'owner-approval:aos:test-v1',
        approvedAt: at,
      },
    });
    const result = await runAosShadowCycle({
      ...input,
      behaviourBinding: createAosBehaviourRuntimeBinding({ manifest, registry }),
    });
    expect(result.recommendations).toBe(1);
    expect(result.cases[0]?.matchedPolicyRefs).toEqual(['custom.vendor-first-contact.v1']);
    expect(result.cases[0]?.recommendation?.action).toBe('REQUEST_VENDOR_REMINDER');
  });
});

describe('AOS runtime behaviour binding integrity', () => {
  it('rejects a behaviour binding whose approved digest does not match its registry bytes', async () => {
    await expect(
      runAosShadowCycle({
        ...cycle(25),
        behaviourBinding: {
          protocol: 'qfj.aos.behaviour-binding.v1',
          manifestId: 'aos.behaviour.tampered',
          manifestVersion: 1,
          configurationDigest: 'sha256:' + '0'.repeat(64),
          registry: AOS_BEHAVIOUR_REGISTRY_V1,
          mode: 'SUGGEST_SHADOW',
          executionAuthority: 'NONE',
          businessEffect: false,
        },
      }),
    ).rejects.toThrow('aos-shadow-cycle-input-invalid');
  });
});

describe('AOS shadow persistence', () => {
  it('persists every final case snapshot and recommendation when a durability port is connected', async () => {
    const cases: string[] = [];
    const recommendations: string[] = [];
    const persistence: AosShadowPersistencePort = {
      appendCaseSnapshot(input) {
        cases.push(input.case.caseId);
        return Promise.resolve(undefined);
      },
      appendRecommendation(input) {
        recommendations.push(input.recommendation.recommendationId);
        return Promise.resolve(undefined);
      },
    };

    const result = await runAosShadowCycle(cycle(25), undefined, persistence);
    expect(result.recommendations).toBe(1);
    expect(cases).toEqual([result.cases[0]?.case.caseId]);
    expect(recommendations).toEqual([result.cases[0]?.recommendation?.recommendationId]);
  });

  it('fails the cycle if connected durability fails rather than pretending the case was persisted', async () => {
    const persistence: AosShadowPersistencePort = {
      appendCaseSnapshot() {
        return Promise.reject(new Error('store-unavailable'));
      },
      appendRecommendation() {
        return Promise.resolve(undefined);
      },
    };
    await expect(runAosShadowCycle(cycle(25), undefined, persistence)).rejects.toThrow(
      'store-unavailable',
    );
  });
});

describe('AOS cross-signal client growth correlation', () => {
  it('requires both explicit client satisfaction and a related-service opportunity before cross-sell', async () => {
    const result = await runAosShadowCycle({
      cycleId: 'aos.shadow.client-growth',
      batch: {
        batchId: 'batch.client-growth',
        generatedAt: at,
        executionAuthority: 'NONE',
        businessEffect: false,
        observations: [
          {
            kind: 'BUSINESS_EVENT',
            input: {
              signalId: 'signal.client-growth',
              detectorId: 'core.canonical-event',
              detectorType: 'OPPORTUNITY',
              caseKey: 'client:opaque-1:client-growth',
              subjectRef: 'client:opaque-1',
              priority: 'P2',
              observedAt: at,
              evidenceRefs: ['core:event:client-growth'],
              reasonCode: 'CORE_ADDITIONAL_SERVICE_IDENTIFIED',
              score: 1,
            },
          },
        ],
      },
      caseMaterial: [
        {
          caseKey: 'client:opaque-1:client-growth',
          facts: [
            {
              factId: 'fact:client-satisfied',
              kind: 'CORE_FACT',
              dataClass: 'OPERATIONAL',
              sourceRef: 'core:event:satisfaction',
              observedAt: at,
              value: true,
            },
            {
              factId: 'fact:related-service',
              kind: 'CORE_FACT',
              dataClass: 'OPERATIONAL',
              sourceRef: 'core:event:related-service',
              observedAt: at,
              value: true,
            },
          ],
          policyRefs: ['policy:client-growth'],
          behaviours: [
            {
              trigger: 'CLIENT_SATISFACTION_POSITIVE',
              context: { metrics: { clientSatisfactionScore: 1 } },
            },
            {
              trigger: 'CLIENT_RELATED_SERVICE_ELIGIBLE',
              context: { metrics: { relatedServiceScore: 1 } },
            },
          ],
          routing: {
            noveltyScore: 0.1,
            evidenceConflictCount: 0,
            similarResolvedCaseCount: 20,
            routineBudgetAvailable: false,
            deepBudgetAvailable: false,
          },
        },
      ],
    });

    expect(result.cases[0]).toMatchObject({
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_RELATED_SERVICE_SUGGESTION',
        requiresOwnerReview: true,
        executionAuthorized: false,
      },
    });
  });

  it('does not cross-sell from a related-service signal without the satisfaction gate', async () => {
    const result = await runAosShadowCycle({
      cycleId: 'aos.shadow.client-growth-no-satisfaction',
      batch: {
        batchId: 'batch.client-growth-no-satisfaction',
        generatedAt: at,
        executionAuthority: 'NONE',
        businessEffect: false,
        observations: [
          {
            kind: 'BUSINESS_EVENT',
            input: {
              signalId: 'signal.client-growth-no-satisfaction',
              detectorId: 'core.canonical-event',
              detectorType: 'OPPORTUNITY',
              caseKey: 'client:opaque-2:client-growth',
              subjectRef: 'client:opaque-2',
              priority: 'P2',
              observedAt: at,
              evidenceRefs: ['core:event:client-growth-no-satisfaction'],
              reasonCode: 'CORE_ADDITIONAL_SERVICE_IDENTIFIED',
              score: 1,
            },
          },
        ],
      },
      caseMaterial: [
        {
          caseKey: 'client:opaque-2:client-growth',
          facts: [
            {
              factId: 'fact:related-service-only',
              kind: 'CORE_FACT',
              dataClass: 'OPERATIONAL',
              sourceRef: 'core:event:related-service-only',
              observedAt: at,
              value: true,
            },
          ],
          policyRefs: ['policy:client-growth'],
          behaviours: [
            {
              trigger: 'CLIENT_RELATED_SERVICE_ELIGIBLE',
              context: { metrics: { relatedServiceScore: 1 } },
            },
          ],
          routing: {
            noveltyScore: 0.1,
            evidenceConflictCount: 0,
            similarResolvedCaseCount: 20,
            routineBudgetAvailable: false,
            deepBudgetAvailable: false,
          },
        },
      ],
    });

    expect(result.recommendations).toBe(0);
    expect(result.cases[0]?.reason).toBe('NO_POLICY_MATCH');
  });
});

describe('AOS cross-cycle case context', () => {
  it('remembers positive satisfaction and can correlate a later related-service opportunity', async () => {
    const caseKey = 'client:opaque-9:client-growth:lead:opaque-9';
    const first = await runAosShadowCycle({
      cycleId: 'aos.shadow.client-growth-memory-1',
      batch: {
        batchId: 'batch.client-growth-memory-1',
        generatedAt: at,
        executionAuthority: 'NONE',
        businessEffect: false,
        observations: [
          {
            kind: 'BUSINESS_EVENT',
            input: {
              signalId: 'signal.client-satisfied-memory',
              detectorId: 'core.canonical-event',
              detectorType: 'BUSINESS_EVENT',
              caseKey,
              subjectRef: 'client:opaque-9',
              priority: 'P3',
              observedAt: at,
              evidenceRefs: ['core:event:satisfaction-memory'],
              reasonCode: 'CORE_CLIENT_SATISFIED',
              score: 1,
            },
          },
        ],
      },
      caseMaterial: [
        {
          caseKey,
          facts: [
            {
              factId: 'fact:client-satisfied-memory',
              kind: 'CORE_FACT',
              dataClass: 'OPERATIONAL',
              sourceRef: 'core:event:satisfaction-memory',
              observedAt: at,
              value: true,
            },
          ],
          policyRefs: ['policy:client-growth'],
          behaviours: [
            {
              trigger: 'CLIENT_SATISFACTION_POSITIVE',
              context: { metrics: { clientSatisfactionScore: 1 } },
            },
          ],
          routing: {
            noveltyScore: 0.1,
            evidenceConflictCount: 0,
            similarResolvedCaseCount: 20,
            routineBudgetAvailable: false,
            deepBudgetAvailable: false,
          },
        },
      ],
    });

    expect(first.recommendations).toBe(0);
    expect(first.caseContextMemory).toHaveLength(1);

    const later = '2026-10-01T06:00:00.000Z';
    const second = await runAosShadowCycle({
      cycleId: 'aos.shadow.client-growth-memory-2',
      batch: {
        batchId: 'batch.client-growth-memory-2',
        generatedAt: later,
        executionAuthority: 'NONE',
        businessEffect: false,
        observations: [
          {
            kind: 'BUSINESS_EVENT',
            input: {
              signalId: 'signal.related-service-memory',
              detectorId: 'core.canonical-event',
              detectorType: 'OPPORTUNITY',
              caseKey,
              subjectRef: 'client:opaque-9',
              priority: 'P3',
              observedAt: later,
              evidenceRefs: ['core:event:related-service-memory'],
              reasonCode: 'CORE_ADDITIONAL_SERVICE_IDENTIFIED',
              score: 1,
            },
          },
        ],
      },
      caseMaterial: [
        {
          caseKey,
          facts: [
            {
              factId: 'fact:related-service-memory',
              kind: 'CORE_FACT',
              dataClass: 'OPERATIONAL',
              sourceRef: 'core:event:related-service-memory',
              observedAt: later,
              value: true,
            },
          ],
          policyRefs: ['policy:client-growth'],
          behaviours: [
            {
              trigger: 'CLIENT_RELATED_SERVICE_ELIGIBLE',
              context: { metrics: { relatedServiceScore: 1 } },
            },
          ],
          routing: {
            noveltyScore: 0.1,
            evidenceConflictCount: 0,
            similarResolvedCaseCount: 20,
            routineBudgetAvailable: false,
            deepBudgetAvailable: false,
          },
        },
      ],
      caseContextMemory: first.caseContextMemory,
    });

    expect(second.cases[0]).toMatchObject({
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_RELATED_SERVICE_SUGGESTION',
        requiresOwnerReview: true,
        executionAuthorized: false,
      },
    });
    expect(second.caseContextMemory[0]?.revision).toBe(2);
  });

  it('rejects cross-cycle memory when the subject identity changes', async () => {
    const caseKey = 'client:opaque-memory:client-growth:lead:opaque-memory';
    const first = await runAosShadowCycle({
      cycleId: 'aos.shadow.identity-memory-1',
      batch: {
        batchId: 'batch.identity-memory-1',
        generatedAt: at,
        executionAuthority: 'NONE',
        businessEffect: false,
        observations: [
          {
            kind: 'BUSINESS_EVENT',
            input: {
              signalId: 'signal.identity-memory-1',
              detectorId: 'core.canonical-event',
              detectorType: 'BUSINESS_EVENT',
              caseKey,
              subjectRef: 'client:opaque-memory',
              priority: 'P3',
              observedAt: at,
              evidenceRefs: ['core:event:identity-memory-1'],
              reasonCode: 'CORE_CLIENT_SATISFIED',
              score: 1,
            },
          },
        ],
      },
      caseMaterial: [
        {
          caseKey,
          facts: [
            {
              factId: 'fact:identity-memory-1',
              kind: 'CORE_FACT',
              dataClass: 'OPERATIONAL',
              sourceRef: 'core:event:identity-memory-1',
              observedAt: at,
              value: true,
            },
          ],
          policyRefs: [],
          behaviours: [
            {
              trigger: 'CLIENT_SATISFACTION_POSITIVE',
              context: { metrics: { clientSatisfactionScore: 1 } },
            },
          ],
          routing: {
            noveltyScore: 0,
            evidenceConflictCount: 0,
            similarResolvedCaseCount: 10,
            routineBudgetAvailable: false,
            deepBudgetAvailable: false,
          },
        },
      ],
    });

    const later = '2026-10-01T06:30:00.000Z';
    await expect(
      runAosShadowCycle({
        cycleId: 'aos.shadow.identity-memory-2',
        batch: {
          batchId: 'batch.identity-memory-2',
          generatedAt: later,
          executionAuthority: 'NONE',
          businessEffect: false,
          observations: [
            {
              kind: 'BUSINESS_EVENT',
              input: {
                signalId: 'signal.identity-memory-2',
                detectorId: 'core.canonical-event',
                detectorType: 'OPPORTUNITY',
                caseKey,
                subjectRef: 'client:different',
                priority: 'P3',
                observedAt: later,
                evidenceRefs: ['core:event:identity-memory-2'],
                reasonCode: 'CORE_ADDITIONAL_SERVICE_IDENTIFIED',
                score: 1,
              },
            },
          ],
        },
        caseMaterial: [
          {
            caseKey,
            facts: [
              {
                factId: 'fact:identity-memory-2',
                kind: 'CORE_FACT',
                dataClass: 'OPERATIONAL',
                sourceRef: 'core:event:identity-memory-2',
                observedAt: later,
                value: true,
              },
            ],
            policyRefs: [],
            behaviours: [
              {
                trigger: 'CLIENT_RELATED_SERVICE_ELIGIBLE',
                context: { metrics: { relatedServiceScore: 1 } },
              },
            ],
            routing: {
              noveltyScore: 0,
              evidenceConflictCount: 0,
              similarResolvedCaseCount: 10,
              routineBudgetAvailable: false,
              deepBudgetAvailable: false,
            },
          },
        ],
        caseContextMemory: first.caseContextMemory,
      }),
    ).rejects.toThrow('aos-case-context-merge-invalid');
  });
});

describe('AOS AI spend circuit breaker', () => {
  it('keeps a known deterministic case off the model path even when model budget is available', async () => {
    const input = cycle(25);
    const material = input.caseMaterial[0];
    if (material === undefined) throw new Error('fixture-missing');
    const result = await runAosShadowCycle({
      ...input,
      aiBudget: { monthlyBudget: 10_000, spent: 100 },
      caseMaterial: [
        {
          ...material,
          routing: {
            ...material.routing,
            routineBudgetAvailable: true,
            deepBudgetAvailable: true,
          },
        },
      ],
    });
    expect(result.cases[0]).toMatchObject({
      route: 'NO_MODEL',
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: { action: 'REQUEST_VENDOR_REMINDER' },
    });
  });

  it('fails closed on conflicting evidence when the external AI spend budget is exhausted', async () => {
    const input = cycle(25);
    const material = input.caseMaterial[0];
    if (material === undefined) throw new Error('fixture-missing');
    const result = await runAosShadowCycle({
      ...input,
      aiBudget: { monthlyBudget: 1_000, spent: 1_000 },
      caseMaterial: [
        {
          ...material,
          routing: {
            ...material.routing,
            evidenceConflictCount: 1,
            routineBudgetAvailable: true,
            deepBudgetAvailable: true,
          },
        },
      ],
    });
    expect(result.cases[0]).toMatchObject({
      route: 'NO_MODEL',
      reason: 'MODEL_REQUIRED_BUT_UNAVAILABLE',
    });
    expect(result.recommendations).toBe(0);
  });
});

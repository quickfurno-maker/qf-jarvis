import {
  createAosCanonicalRecommendationProjector,
  type AosDecisionAdjudicator,
} from '@qf-jarvis/aos-governance-integration';
import { describe, expect, it } from 'vitest';

import { runAosSupervisorShadowCycle, type AosSupervisorClientInput } from '../index.js';

const at = '2026-10-01T09:00:00.000Z';

function clientSnapshot(): AosSupervisorClientInput['snapshot'] {
  return {
    version: 1,
    behaviour: [],
    journey: {
      followUpDue: false,
      satisfactionState: 'SATISFIED',
      serviceRecoveryNeeded: false,
      reassignmentState: 'NONE',
      lifecycleState: 'OPEN',
      vendorsReleased: 3,
      vendorNoContactCount: 0,
      allReleasedVendorsContacted: true,
    },
    opportunities: [
      {
        serviceRef: 'sofa',
        score: 92,
        relevance: 'HIGH',
        explicitInterest: false,
      },
    ],
    nextBestAction: {
      action: 'SURFACE_ADDITIONAL_SERVICE',
      reasonCode: 'NURTURE_OPPORTUNITY_READY',
      serviceRef: 'sofa',
      requiresCoreDecision: false,
      businessEffect: false,
      executionAuthorized: false,
    },
  };
}

function rechargeEvent(): unknown {
  return {
    eventId: '88888888-8888-4888-8888-888888888888',
    eventType: 'qf.vendor.recharge-opportunity-detected',
    eventVersion: 2,
    occurredAt: '2026-10-01T08:59:00.000Z',
    emittedAt: '2026-10-01T08:59:01.000Z',
    source: 'quickfurno-core',
    correlationId: '99999999-9999-4999-8999-999999999999',
    subject: { entityType: 'vendor', entityId: 'vendor-opaque-supervisor' },
    payload: {
      reasonCode: 'recharge-opportunity',
      opportunityBand: 'high',
    },
  };
}

describe('AOS v2 unified shadow supervisor', () => {
  it('coordinates vendor, client and marketplace intelligence in one zero-authority cycle', async () => {
    const result = await runAosSupervisorShadowCycle({
      cycleId: 'aos.supervisor.test-1',
      generatedAt: at,
      canonicalEvents: [rechargeEvent()],
      leadDeliveries: [
        {
          leadRef: 'lead:opaque-supervisor',
          requirementRef: 'requirement:opaque-supervisor',
          evidenceRef: 'core:lead-delivery:supervisor',
          observedAt: at,
          vendorAssignments: [
            {
              assignmentRef: 'assignment:supervisor-1',
              vendorRef: 'vendor:supervisor-1',
              assignedAt: '2026-10-01T08:00:00.000Z',
              firstContactConfirmed: true,
              firstContactConfirmedAt: '2026-10-01T08:05:00.000Z',
            },
            {
              assignmentRef: 'assignment:supervisor-2',
              vendorRef: 'vendor:supervisor-2',
              assignedAt: '2026-10-01T08:00:00.000Z',
              firstContactConfirmed: true,
              firstContactConfirmedAt: '2026-10-01T08:06:00.000Z',
            },
            {
              assignmentRef: 'assignment:supervisor-3',
              vendorRef: 'vendor:supervisor-3',
              assignedAt: '2026-10-01T08:20:00.000Z',
              firstContactConfirmed: false,
            },
          ],
        },
      ],
      clients: [
        {
          subjectRef: 'client:opaque-supervisor',
          requirementRef: 'req-supervisor-1',
          evidenceRef: 'core:client-intelligence:supervisor-1',
          snapshot: clientSnapshot(),
        },
      ],
      vendors: [
        {
          subjectRef: 'vendor:opaque-reactivation-supervisor',
          evidenceRef: 'core:vendor-success:supervisor',
          observedAt: at,
          inactiveDays: 45,
          matchingDemandCount: 2,
          packageReadinessBand: 'high',
          rechargeOpportunity: false,
          retentionRisk: false,
          winbackCandidate: false,
          complaintOpen: false,
        },
      ],
      marketplaceSlices: [
        {
          sliceRef: 'pune.baner.interior.supervisor',
          cityRef: 'pune',
          localityRef: 'baner',
          categoryRef: 'interior',
          observedAt: at,
          evidenceRef: 'metric:pune:baner:interior:supervisor',
          openDemand: 18,
          eligibleSupply: 2,
          maximumDemandPerSupply: 3,
        },
      ],
      aiBudget: { monthlyBudget: 10_000, spent: 100 },
    });

    expect(result).toMatchObject({
      protocol: 'qfj.aos.supervisor-cycle.v1',
      sourceSummary: {
        canonicalEvents: 1,
        leadDeliveryProjections: 1,
        clientSnapshots: 1,
        vendorProjections: 1,
        marketplaceSlices: 1,
      },
      modelCalls: 0,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.recommendations.map((one) => one.action)).toEqual(
      expect.arrayContaining([
        'REQUEST_RECHARGE_NUDGE',
        'REQUEST_VENDOR_REMINDER',
        'REQUEST_REPLACEMENT_BATCH',
        'REQUEST_RELATED_SERVICE_SUGGESTION',
        'REQUEST_VENDOR_REACTIVATION',
        'REQUEST_VENDOR_ACQUISITION_REVIEW',
      ]),
    );
    expect(result.caseContextMemory.length).toBeGreaterThanOrEqual(3);
    expect(result.ownerAttention.length).toBe(result.cases.length);
    for (const recommendation of result.recommendations) {
      expect(recommendation).toMatchObject({
        executionAuthorized: false,
        businessEffect: false,
      });
    }
  });

  it('carries case context from one supervisor cycle into the next without granting authority', async () => {
    const first = await runAosSupervisorShadowCycle({
      cycleId: 'aos.supervisor.memory-1',
      generatedAt: at,
      clients: [
        {
          subjectRef: 'client:opaque-memory',
          requirementRef: 'req-memory',
          evidenceRef: 'core:client-intelligence:memory-1',
          snapshot: clientSnapshot(),
        },
      ],
    });
    expect(first.caseContextMemory.length).toBeGreaterThan(0);

    const second = await runAosSupervisorShadowCycle({
      cycleId: 'aos.supervisor.memory-2',
      generatedAt: '2026-10-01T09:05:00.000Z',
      caseContextMemory: first.caseContextMemory,
      canonicalEvents: [rechargeEvent()],
    });
    expect(second.caseContextMemory.length).toBeGreaterThan(first.caseContextMemory.length);
    expect(second.executionAuthority).toBe('NONE');
    expect(second.businessEffect).toBe(false);
  });

  it('projects non-held recommendations into canonical inert artifacts and suppresses held ones', async () => {
    const projector = createAosCanonicalRecommendationProjector();
    const normal = await runAosSupervisorShadowCycle(
      {
        cycleId: 'aos.supervisor.canonical',
        generatedAt: at,
        canonicalEvents: [rechargeEvent()],
      },
      undefined,
      undefined,
      { canonicalProjector: projector },
    );
    expect(normal.recommendations.length).toBeGreaterThan(0);
    expect(normal.canonicalRecommendations.length).toBe(normal.recommendations.length);
    expect(normal.canonicalProjectionFailures).toBe(0);
    for (const projected of normal.canonicalRecommendations) {
      expect(projected).toMatchObject({
        executionAuthority: 'NONE',
        businessEffect: false,
      });
      expect(projected.canonical.recommendation.producingSystem).toBe('qf-jarvis');
    }

    const adjudicator: AosDecisionAdjudicator = {
      adjudicate() {
        return Promise.resolve({
          outcome: 'HOLD_FOR_HUMAN_REVIEW',
          reason: 'ADVISORY_DISAGREES',
          executionAuthority: 'NONE',
          businessEffect: false,
        });
      },
    };
    const held = await runAosSupervisorShadowCycle(
      {
        cycleId: 'aos.supervisor.held',
        generatedAt: at,
        canonicalEvents: [rechargeEvent()],
      },
      undefined,
      undefined,
      { adjudicator, canonicalProjector: projector },
    );
    expect(held.adjudicationHolds).toBe(1);
    expect(held.recommendations).toHaveLength(1);
    expect(held.canonicalRecommendations).toEqual([]);
    expect(held.executionAuthority).toBe('NONE');
  });

  it('keeps owner attention ranked but inert', async () => {
    const result = await runAosSupervisorShadowCycle({
      cycleId: 'aos.supervisor.attention',
      generatedAt: at,
      marketplaceSlices: [
        {
          sliceRef: 'pune.wakad.sofa.supervisor',
          cityRef: 'pune',
          localityRef: 'wakad',
          categoryRef: 'sofa',
          observedAt: '2026-10-01T08:00:00.000Z',
          evidenceRef: 'metric:pune:wakad:sofa:supervisor',
          openDemand: 24,
          eligibleSupply: 2,
          maximumDemandPerSupply: 3,
          vendorResponseRate: {
            current: 0.35,
            baseline: 0.8,
            minimumRelativeDelta: 0.2,
          },
        },
      ],
    });
    const attention = result.ownerAttention[0];
    expect(attention).toBeDefined();
    if (attention === undefined) throw new Error('attention-fixture-missing');
    expect(['NOW', 'SOON', 'DIGEST']).toContain(attention.lane);
    expect(attention).toMatchObject({
      executionAuthority: 'NONE',
      businessEffect: false,
      requiresOwnerReview: true,
    });
  });
});

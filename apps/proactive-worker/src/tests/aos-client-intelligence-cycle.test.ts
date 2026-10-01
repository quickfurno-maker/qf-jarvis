import { describe, expect, it } from 'vitest';

import {
  runAosClientIntelligenceShadowCycle,
  type AosClientIntelligenceShadowCycleInput,
} from '../index.js';

const at = '2026-10-01T06:45:00.000Z';

function snapshot(input: {
  readonly satisfied: boolean;
  readonly handoffComplete: boolean;
  readonly opportunities?: readonly {
    readonly serviceRef: string;
    readonly score: number;
  }[];
}): AosClientIntelligenceShadowCycleInput['snapshot'] {
  const opportunities = (input.opportunities ?? []).map((one) => ({
    serviceRef: one.serviceRef,
    score: one.score,
    relevance: 'HIGH' as const,
    explicitInterest: false,
  }));
  return {
    version: 1,
    behaviour: [],
    journey: {
      followUpDue: false,
      satisfactionState: input.satisfied ? 'SATISFIED' : 'UNKNOWN',
      serviceRecoveryNeeded: false,
      reassignmentState: 'NONE',
      lifecycleState: 'OPEN',
      vendorsReleased: 3,
      vendorNoContactCount: input.handoffComplete ? 0 : 1,
      allReleasedVendorsContacted: input.handoffComplete,
    },
    opportunities,
    nextBestAction: {
      action: 'ANSWER_CLIENT',
      reasonCode: 'TEST_FIXTURE',
      requiresCoreDecision: false,
      businessEffect: false,
      executionAuthorized: false,
    },
  };
}

describe('AOS full client-intelligence shadow cycle', () => {
  it('creates one service-specific cross-sell case only after handoff and satisfaction', async () => {
    const result = await runAosClientIntelligenceShadowCycle({
      cycleId: 'aos.client-intelligence.test-1',
      generatedAt: at,
      subjectRef: 'client:opaque-1',
      requirementRef: 'req-1',
      evidenceRef: 'core:client-intelligence:1',
      snapshot: snapshot({
        satisfied: true,
        handoffComplete: true,
        opportunities: [{ serviceRef: 'sofa', score: 92 }],
      }),
    });

    const growth = result.shadow.cases.find((one) => one.case.caseKey.endsWith(':service:sofa'));
    expect(growth).toMatchObject({
      reason: 'DETERMINISTIC_RECOMMENDATION',
      recommendation: {
        action: 'REQUEST_RELATED_SERVICE_SUGGESTION',
        requiresOwnerReview: true,
        executionAuthorized: false,
      },
    });
    expect(result.executionAuthority).toBe('NONE');
    expect(result.businessEffect).toBe(false);
  });

  it('does not cross-sell when the three-vendor handoff is incomplete', async () => {
    const result = await runAosClientIntelligenceShadowCycle({
      cycleId: 'aos.client-intelligence.test-2',
      generatedAt: at,
      subjectRef: 'client:opaque-2',
      requirementRef: 'req-2',
      evidenceRef: 'core:client-intelligence:2',
      snapshot: snapshot({
        satisfied: true,
        handoffComplete: false,
        opportunities: [{ serviceRef: 'painting', score: 90 }],
      }),
    });
    const growth = result.shadow.cases.find((one) =>
      one.case.caseKey.endsWith(':service:painting'),
    );
    expect(growth?.recommendation).toBeUndefined();
    expect(growth?.reason).toBe('NO_POLICY_MATCH');
  });

  it('does not cross-sell before positive satisfaction even when an opportunity exists', async () => {
    const result = await runAosClientIntelligenceShadowCycle({
      cycleId: 'aos.client-intelligence.test-3',
      generatedAt: at,
      subjectRef: 'client:opaque-3',
      requirementRef: 'req-3',
      evidenceRef: 'core:client-intelligence:3',
      snapshot: snapshot({
        satisfied: false,
        handoffComplete: true,
        opportunities: [{ serviceRef: 'false-ceiling', score: 95 }],
      }),
    });
    const growth = result.shadow.cases.find((one) =>
      one.case.caseKey.endsWith(':service:false-ceiling'),
    );
    expect(growth?.recommendation).toBeUndefined();
    expect(growth?.reason).toBe('NO_POLICY_MATCH');
  });

  it('keeps multiple related services as separate governed cases', async () => {
    const result = await runAosClientIntelligenceShadowCycle({
      cycleId: 'aos.client-intelligence.test-4',
      generatedAt: at,
      subjectRef: 'client:opaque-4',
      requirementRef: 'req-4',
      evidenceRef: 'core:client-intelligence:4',
      snapshot: snapshot({
        satisfied: true,
        handoffComplete: true,
        opportunities: [
          { serviceRef: 'sofa', score: 90 },
          { serviceRef: 'painting', score: 82 },
        ],
      }),
    });
    const growthCases = result.shadow.cases.filter(
      (one) =>
        one.case.caseKey.includes(':client-growth:requirement:') &&
        one.case.caseKey.includes(':service:'),
    );
    expect(growthCases).toHaveLength(2);
    expect(
      growthCases.every(
        (one) => one.recommendation?.action === 'REQUEST_RELATED_SERVICE_SUGGESTION',
      ),
    ).toBe(true);
  });
});

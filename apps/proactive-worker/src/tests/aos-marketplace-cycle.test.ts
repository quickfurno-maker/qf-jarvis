import { describe, expect, it } from 'vitest';

import { runAosMarketplaceShadowCycle } from '../index.js';

const at = '2026-10-01T07:00:00.000Z';

describe('AOS marketplace shadow cycle', () => {
  it('detects local supply shortage and recommends Aarohi acquisition review only', async () => {
    const result = await runAosMarketplaceShadowCycle({
      cycleId: 'aos.market.test-1',
      generatedAt: at,
      slices: [
        {
          sliceRef: 'pune.baner.interior',
          cityRef: 'pune',
          localityRef: 'baner',
          categoryRef: 'interior',
          observedAt: at,
          evidenceRef: 'metric:pune:baner:interior',
          openDemand: 20,
          eligibleSupply: 2,
          maximumDemandPerSupply: 3,
        },
      ],
    });

    expect(result).toMatchObject({
      protocol: 'qfj.aos.marketplace-cycle.v1',
      slices: 1,
      detections: 1,
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.shadow.cases[0]).toMatchObject({
      recommendation: {
        action: 'REQUEST_VENDOR_ACQUISITION_REVIEW',
        requiresOwnerReview: true,
        executionAuthorized: false,
      },
    });
  });

  it('does not manufacture a case when supply is healthy', async () => {
    const result = await runAosMarketplaceShadowCycle({
      cycleId: 'aos.market.test-2',
      generatedAt: at,
      slices: [
        {
          sliceRef: 'pune.kothrud.paint',
          cityRef: 'pune',
          localityRef: 'kothrud',
          categoryRef: 'painting',
          observedAt: at,
          evidenceRef: 'metric:pune:kothrud:paint',
          openDemand: 4,
          eligibleSupply: 4,
          maximumDemandPerSupply: 3,
        },
      ],
    });
    expect(result.detections).toBe(0);
    expect(result.shadow.cases).toEqual([]);
  });

  it('detects response-rate degradation without assuming it is a supply shortage', async () => {
    const result = await runAosMarketplaceShadowCycle({
      cycleId: 'aos.market.test-3',
      generatedAt: at,
      slices: [
        {
          sliceRef: 'pune.wakad.sofa',
          cityRef: 'pune',
          localityRef: 'wakad',
          categoryRef: 'sofa',
          observedAt: at,
          evidenceRef: 'metric:pune:wakad:sofa',
          openDemand: 3,
          eligibleSupply: 5,
          maximumDemandPerSupply: 3,
          vendorResponseRate: {
            current: 0.45,
            baseline: 0.8,
            minimumRelativeDelta: 0.2,
          },
        },
      ],
    });
    expect(result.detections).toBe(1);
    expect(result.shadow.cases[0]).toMatchObject({
      recommendation: {
        action: 'REQUEST_HUMAN_REVIEW',
        requiresOwnerReview: true,
      },
    });
    expect(result.shadow.cases[0]?.recommendation?.alternatives).not.toContain(
      'REQUEST_VENDOR_ACQUISITION_REVIEW',
    );
  });

  it('correlates supply and response degradation into one market case', async () => {
    const result = await runAosMarketplaceShadowCycle({
      cycleId: 'aos.market.test-4',
      generatedAt: at,
      slices: [
        {
          sliceRef: 'mumbai.andheri.interior',
          cityRef: 'mumbai',
          localityRef: 'andheri',
          categoryRef: 'interior',
          observedAt: at,
          evidenceRef: 'metric:mumbai:andheri:interior',
          openDemand: 30,
          eligibleSupply: 3,
          maximumDemandPerSupply: 3,
          vendorResponseRate: {
            current: 0.4,
            baseline: 0.75,
            minimumRelativeDelta: 0.2,
          },
        },
      ],
    });
    expect(result.detections).toBe(2);
    expect(result.shadow.cases).toHaveLength(1);
    expect(result.shadow.cases[0]?.matchedPolicyRefs).toEqual([
      'marketplace.supply-shortage.v1',
      'marketplace.vendor-response-degraded.v1',
    ]);
    expect(result.shadow.cases[0]?.recommendation?.action).toBe(
      'REQUEST_VENDOR_ACQUISITION_REVIEW',
    );
  });
});

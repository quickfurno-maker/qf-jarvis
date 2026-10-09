import { describe, expect, it } from 'vitest';

import { assessAosMarketCell } from '../market-cell.js';

const base = {
  cellRef: 'market.pune.wakad.plumber',
  cityRef: 'pune',
  localityRef: 'wakad',
  categoryRef: 'plumber',
  observedAt: '2026-10-09T12:00:00.000Z',
  evidenceRef: 'core.market.wakad.plumber',
  demand7d: 70,
  demand30d: 300,
  demand90d: 900,
  registeredSupply: 50,
  eligibleSupply: 35,
  activeSupply: 32,
  creditReadySupply: 30,
  vendorResponseRate: 0.8,
  threeVendorFillRate: 0.97,
} as const;

describe('AOS marketplace supply intelligence', () => {
  it('classifies a healthy market cell as balanced', () => {
    const result = assessAosMarketCell(base);
    expect(result.state).toBe('BALANCED');
    expect(result.recommendation).toBe('MAINTAIN');
    expect(result.leadOpportunities30d).toBe(900);
    expect(result.executionAuthority).toBe('NONE');
    expect(result.businessEffect).toBe(false);
  });

  it('detects under-supply and recommends vendor acquisition', () => {
    const result = assessAosMarketCell({
      ...base,
      registeredSupply: 12,
      eligibleSupply: 8,
      activeSupply: 7,
      creditReadySupply: 6,
      threeVendorFillRate: 0.62,
    });
    expect(result.state).toBe('UNDER_SUPPLIED');
    expect(result.recommendation).toBe('ACQUIRE_VENDORS');
  });

  it('detects over-supply without closing registration itself', () => {
    const result = assessAosMarketCell({
      ...base,
      registeredSupply: 180,
      eligibleSupply: 140,
      activeSupply: 130,
      creditReadySupply: 125,
      vendorResponseRate: 0.82,
      threeVendorFillRate: 0.99,
    });
    expect(result.state).toBe('OVER_SUPPLIED');
    expect(result.recommendation).toBe('HOLD_PACKAGE_ACTIVATION');
    expect(result.productionMutation).toBe(false);
  });

  it('separates demand starvation from ordinary over-supply when demand is falling', () => {
    const result = assessAosMarketCell({
      ...base,
      demand7d: 5,
      demand30d: 80,
      demand90d: 500,
      registeredSupply: 80,
      eligibleSupply: 60,
      activeSupply: 55,
      creditReadySupply: 50,
    });
    expect(result.state).toBe('DEMAND_STARVED');
    expect(result.recommendation).toBe('BOOST_CLIENT_DEMAND');
  });

  it('detects low-quality supply when raw vendor count is adequate but effective supply is weak', () => {
    const result = assessAosMarketCell({
      ...base,
      registeredSupply: 80,
      eligibleSupply: 60,
      activeSupply: 55,
      creditReadySupply: 50,
      vendorResponseRate: 0.25,
      threeVendorFillRate: 0.55,
    });
    expect(result.state).toBe('LOW_QUALITY_SUPPLY');
    expect(result.recommendation).toBe('IMPROVE_VENDOR_QUALITY');
    expect(result.reasonCodes).toContain('VENDOR_RESPONSE_RATE_BELOW_TARGET');
  });

  it('refuses inconsistent aggregate snapshots', () => {
    expect(() =>
      assessAosMarketCell({
        ...base,
        activeSupply: 51,
      }),
    ).toThrow('aos-market-cell-shape-invalid');
  });
});

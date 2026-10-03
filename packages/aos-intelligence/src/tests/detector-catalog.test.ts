import { describe, expect, it } from 'vitest';

import {
  AOS_DETECTOR_CATALOG_V1,
  AOS_DETECTOR_TYPES,
  aosDetectorCoverageSummary,
} from '../index.js';

describe('AOS detector coverage catalog', () => {
  it('keeps every detector deterministic and powerless', () => {
    const ids = new Set<string>();
    for (const detector of AOS_DETECTOR_CATALOG_V1) {
      expect(ids.has(detector.detectorId)).toBe(false);
      ids.add(detector.detectorId);
      expect(AOS_DETECTOR_TYPES).toContain(detector.detectorType);
      expect(detector.modelRequired).toBe(false);
      expect(detector.executionAuthority).toBe('NONE');
      expect(detector.sourceRefs.length).toBeGreaterThan(0);
    }
  });

  it('reports explicit implemented/partial/source-required/planned coverage without guessing live state', () => {
    const summary = aosDetectorCoverageSummary();
    expect(
      summary.IMPLEMENTED + summary.SOURCE_PARTIAL + summary.SOURCE_REQUIRED + summary.PLANNED,
    ).toBe(AOS_DETECTOR_CATALOG_V1.length);
    // Zero fully-live detectors is a valid fail-closed production statement until
    // the authoritative Core/source adapters are actually connected. Do not turn
    // code coverage into a false claim of live source coverage just to satisfy a test.
    expect(summary.IMPLEMENTED).toBe(0);
    expect(summary.SOURCE_PARTIAL).toBeGreaterThan(0);
    expect(summary.SOURCE_REQUIRED).toBeGreaterThan(0);
    expect(summary.PLANNED).toBeGreaterThan(0);
  });

  it('contains the lead, client, vendor, marketplace and infrastructure domains', () => {
    const domains = new Set(AOS_DETECTOR_CATALOG_V1.map((item) => item.domain));
    expect(domains).toEqual(
      new Set([
        'LEAD_DELIVERY',
        'CLIENT_VALUE',
        'VENDOR_SUCCESS',
        'MARKETPLACE',
        'COMMUNICATIONS',
        'INFRASTRUCTURE',
        'MODEL_RUNTIME',
      ]),
    );
  });
});

/**
 * RWC-P5/P6 — the shared Core read predicates (ADR-0100 §4; ADR-0101 §5).
 *
 * These moved out of `riya-model-interaction` when RWC-P6 needed the same rule for a structured
 * summary edit that reaches Core authority without a model. The specs below are the reason the move
 * is safe: they pin the semantics independently of either consumer, so "the two agree" stops being
 * something to remember and becomes something that fails.
 *
 * The rule worth restating: **an active city plus an active service does not imply the pair.**
 */
import { describe, expect, it } from 'vitest';

import {
  isCoreCityActive,
  isCoreServiceActive,
  isCoreServiceCityPairAvailable,
} from '../policy/index.js';
import { syntheticAvailabilitySnapshot } from '../testing/index.js';

/** `svc.two` is sold in `city.alpha` only, so `svc.two` + `city.beta` is the unavailable pair. */
const SNAPSHOT = syntheticAvailabilitySnapshot();

describe('active membership', () => {
  it('recognises an active service, and only an active service', () => {
    expect(isCoreServiceActive(SNAPSHOT, 'svc.one')).toBe(true);
    expect(isCoreServiceActive(SNAPSHOT, 'svc.two')).toBe(true);
    expect(isCoreServiceActive(SNAPSHOT, 'svc.invented')).toBe(false);
    // A city ref is not a service ref, however well-formed it is.
    expect(isCoreServiceActive(SNAPSHOT, 'city.alpha')).toBe(false);
  });

  it('recognises an active city, and only an active city', () => {
    expect(isCoreCityActive(SNAPSHOT, 'city.alpha')).toBe(true);
    expect(isCoreCityActive(SNAPSHOT, 'city.beta')).toBe(true);
    expect(isCoreCityActive(SNAPSHOT, 'city.atlantis')).toBe(false);
    expect(isCoreCityActive(SNAPSHOT, 'svc.one')).toBe(false);
  });

  it('matches exactly: no prefix, no case-folding, no trimming', () => {
    for (const near of ['svc.on', 'svc.ones', 'SVC.ONE', ' svc.one', 'svc.one ']) {
      expect({ near, active: isCoreServiceActive(SNAPSHOT, near) }).toStrictEqual({
        near,
        active: false,
      });
    }
  });

  it('an empty catalogue makes everything inactive', () => {
    const empty = syntheticAvailabilitySnapshot({ cities: [], services: [], availability: [] });
    expect(isCoreServiceActive(empty, 'svc.one')).toBe(false);
    expect(isCoreCityActive(empty, 'city.alpha')).toBe(false);
  });
});

describe('pair availability is explicit, never inferred', () => {
  it('`ALL` covers every city in THIS snapshot', () => {
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.one', 'city.alpha')).toBe(true);
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.one', 'city.beta')).toBe(true);
  });

  it('an explicit list is exact membership', () => {
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.two', 'city.alpha')).toBe(true);
    // Both refs are individually active. The pair simply is not sold.
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.two', 'city.beta')).toBe(false);
  });

  it('an EMPTY list means available nowhere listed', () => {
    const nowhere = syntheticAvailabilitySnapshot({
      cities: [{ ref: 'city.alpha', displayName: 'Alpha' }],
      services: [{ ref: 'svc.one', displayName: 'One' }],
      availability: [{ serviceRef: 'svc.one', cityRefs: [] }],
    });
    expect(isCoreServiceActive(nowhere, 'svc.one')).toBe(true);
    expect(isCoreCityActive(nowhere, 'city.alpha')).toBe(true);
    // Active plus active, and still no pair. This is the whole rule in one assertion.
    expect(isCoreServiceCityPairAvailable(nowhere, 'svc.one', 'city.alpha')).toBe(false);
  });

  it('`ALL` over an empty city set is no city', () => {
    const noCities = syntheticAvailabilitySnapshot({
      cities: [],
      services: [{ ref: 'svc.one', displayName: 'One' }],
      availability: [{ serviceRef: 'svc.one', cityRefs: 'ALL' }],
    });
    expect(isCoreServiceCityPairAvailable(noCities, 'svc.one', 'city.alpha')).toBe(false);
  });

  it('an unlisted service or city makes the pair unanswerable, which reads as false', () => {
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.invented', 'city.alpha')).toBe(false);
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.one', 'city.atlantis')).toBe(false);
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.invented', 'city.atlantis')).toBe(false);
  });

  it('arguments are not interchangeable', () => {
    // Passing them the wrong way round must not accidentally succeed.
    expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'city.alpha', 'svc.one')).toBe(false);
  });
});

describe('the predicates are pure', () => {
  it('mutate nothing and are deterministic', () => {
    const before = JSON.stringify(SNAPSHOT);
    for (let run = 0; run < 3; run += 1) {
      expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.two', 'city.beta')).toBe(false);
      expect(isCoreServiceCityPairAvailable(SNAPSHOT, 'svc.two', 'city.alpha')).toBe(true);
    }
    expect(JSON.stringify(SNAPSHOT)).toBe(before);
  });
});

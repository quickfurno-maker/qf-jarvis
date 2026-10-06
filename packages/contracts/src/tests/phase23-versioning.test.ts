import { describe, expect, it } from 'vitest';

import {
  PHASE23_EVENT_VERSION_POLICY,
  acceptedEventVersions,
  classifyContractChange,
  requiredEventVersion,
} from '../index.js';

describe('Phase 23 event version governance', () => {
  it('keeps additive optional fields on the same version', () => {
    expect(classifyContractChange('additive-optional-field')).toStrictEqual({
      breaking: false,
      sameVersionAllowed: true,
      requiresConsumerReview: false,
    });
    expect(requiredEventVersion(2, 'additive-optional-field')).toBe(2);
  });

  it('forces meaning, required-field and idempotency changes to a new version', () => {
    for (const kind of [
      'required-field-addition',
      'field-removal',
      'field-rename',
      'field-meaning-change',
      'idempotency-semantics-change',
    ] as const) {
      expect(classifyContractChange(kind).breaking).toBe(true);
      expect(requiredEventVersion(2, kind)).toBe(3);
    }
  });

  it('requires explicit review for enum expansion', () => {
    expect(classifyContractChange('enum-expansion')).toStrictEqual({
      breaking: false,
      sameVersionAllowed: false,
      requiresConsumerReview: true,
    });
    expect(requiredEventVersion(2, 'enum-expansion')).toBe(3);
  });

  it('retains N-1 only when it has live traffic', () => {
    expect(
      acceptedEventVersions({ currentVersion: 2, previousVersionHasLiveTraffic: true }),
    ).toStrictEqual([1, 2]);
    expect(
      acceptedEventVersions({ currentVersion: 2, previousVersionHasLiveTraffic: false }),
    ).toStrictEqual([2]);
    expect(
      acceptedEventVersions({ currentVersion: 1, previousVersionHasLiveTraffic: true }),
    ).toStrictEqual([1]);
  });

  it('locks fail-closed and deprecation policy', () => {
    expect(PHASE23_EVENT_VERSION_POLICY).toMatchObject({
      contractIdentity: 'eventType + eventVersion',
      unknownTypeFailsClosed: true,
      unknownVersionFailsClosed: true,
      permissiveFallbackForbidden: true,
      automaticUpgradeForbidden: true,
      eventIdIsIdempotencyIdentity: true,
      minimumDeprecationDays: 90,
      minimumZeroUsageDaysBeforeRemoval: 30,
    });
  });
});

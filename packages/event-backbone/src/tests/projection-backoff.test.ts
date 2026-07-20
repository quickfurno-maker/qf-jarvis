/**
 * Stage 3.4.4 — deterministic equal-jitter backoff (ADR-0037). Unit tests: exact vectors, ranges, the
 * 5-minute cap, overflow bounds, determinism, and fail-closed. No database, no Math.random.
 */
import { describe, expect, it } from 'vitest';

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  BACKOFF_MULTIPLIER,
  MAX_SCHEDULED_FAILURE,
  projectionRetryBackoff,
} from '../projections/projection-backoff.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { ProjectionInputError } from '../projections/projection-errors.js';
import { type ProjectionName } from '../projections/projection-name.js';

const NOW: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
const P: ProjectionName = 'p' as ProjectionName;

function delay(name: string, version: number, position: bigint, failureNumber: number): number {
  return projectionRetryBackoff({
    name: name as ProjectionName,
    version,
    position,
    failureNumber,
    now: NOW,
  }).delayMs;
}

describe('projectionRetryBackoff — constants and exact vectors (U3)', () => {
  it('locks the exact constants', () => {
    expect(BACKOFF_BASE_MS).toBe(1000);
    expect(BACKOFF_MULTIPLIER).toBe(8);
    expect(BACKOFF_MAX_MS).toBe(300000);
    expect(MAX_SCHEDULED_FAILURE).toBe(4);
  });

  it.each([
    [1, 551],
    [2, 4423],
    [3, 54533],
    [4, 166001],
  ])('event-type-activity v1 position 7 failure %d -> %d ms', (failureNumber, expected) => {
    expect(delay('event-type-activity', 1, 7n, failureNumber)).toBe(expected);
  });

  it('next_attempt_at is now + delayMs as a canonical instant', () => {
    const { delayMs, nextAttemptAt } = projectionRetryBackoff({
      name: 'event-type-activity' as ProjectionName,
      version: 1,
      position: 7n,
      failureNumber: 1,
      now: NOW,
    });
    expect(delayMs).toBe(551);
    expect(nextAttemptAt).toBe('2026-07-19T00:00:00.551Z');
  });
});

describe('projectionRetryBackoff — ranges and the 5-minute cap (U3)', () => {
  it.each([
    [1, 500, 1000],
    [2, 4000, 8000],
    [3, 32000, 64000],
    [4, 150000, 300000],
  ])('failure %d stays within [%d, %d]', (failureNumber, lower, upper) => {
    // Sample several positions; every delay must land in the window.
    for (const position of [1n, 2n, 7n, 100n, 999999n]) {
      const d = delay('some-projection', 1, position, failureNumber);
      expect(d).toBeGreaterThanOrEqual(lower);
      expect(d).toBeLessThanOrEqual(upper);
    }
  });

  it('the 5-minute cap BINDS at failure 4 (uncapped 512000 > 300000)', () => {
    // upper is 300000 (capped), so no delay can exceed the cap.
    for (const position of [1n, 50n, 123456n]) {
      expect(delay('p', 1, position, 4)).toBeLessThanOrEqual(300000);
    }
  });
});

describe('projectionRetryBackoff — determinism and fail-closed (U3)', () => {
  it('is deterministic: same input -> same delay', () => {
    expect(delay('event-type-activity', 1, 7n, 3)).toBe(delay('event-type-activity', 1, 7n, 3));
  });

  it('changes with name, version, position and failure number', () => {
    const base = delay('event-type-activity', 1, 7n, 2);
    expect(delay('daily-event-acceptance', 1, 7n, 2)).not.toBe(base);
    expect(delay('event-type-activity', 2, 7n, 2)).not.toBe(base);
    expect(delay('event-type-activity', 1, 8n, 2)).not.toBe(base);
    expect(delay('event-type-activity', 1, 7n, 3)).not.toBe(base);
  });

  it('rejects a failure number outside 1..4 (5 blocks and schedules nothing)', () => {
    for (const n of [0, 5, 6, -1]) {
      expect(() =>
        projectionRetryBackoff({ name: P, version: 1, position: 7n, failureNumber: n, now: NOW }),
      ).toThrow(ProjectionInputError);
    }
  });

  it('rejects a non-canonical now and a non-positive position/version', () => {
    expect(() =>
      projectionRetryBackoff({
        name: P,
        version: 1,
        position: 7n,
        failureNumber: 1,
        now: '2026-07-19T00:00:00Z' as unknown as CanonicalInstant,
      }),
    ).toThrow(ProjectionInputError);
    expect(() =>
      projectionRetryBackoff({ name: P, version: 1, position: 0n, failureNumber: 1, now: NOW }),
    ).toThrow(ProjectionInputError);
    expect(() =>
      projectionRetryBackoff({ name: P, version: 0, position: 7n, failureNumber: 1, now: NOW }),
    ).toThrow(ProjectionInputError);
  });

  it('rejects a malformed / colon-injected projection name BEFORE hashing (C5.11)', () => {
    for (const bad of ['event:type', 'Bad', '1abc', 'a--', '-a', 'a_b', '', 'a:b:c']) {
      expect(() =>
        projectionRetryBackoff({
          name: bad as ProjectionName,
          version: 1,
          position: 7n,
          failureNumber: 1,
          now: NOW,
        }),
      ).toThrow(ProjectionInputError);
    }
  });

  it('rejects an unsafe or out-of-range version BEFORE hashing (C5.11)', () => {
    for (const badVersion of [
      Number.MAX_SAFE_INTEGER + 1, // not a safe integer
      Number.MAX_VALUE,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -1,
    ]) {
      expect(() =>
        projectionRetryBackoff({
          name: P,
          version: badVersion,
          position: 7n,
          failureNumber: 1,
          now: NOW,
        }),
      ).toThrow(ProjectionInputError);
    }
  });

  it('fails closed if now + delay is not a representable canonical instant', () => {
    // At the maximum 4-digit-year canonical instant, adding the delay rolls into year 10000, which is
    // NOT a canonical instant (the pattern requires a 4-digit year), so it fails closed.
    const nearMax = toCanonicalInstant('9999-12-31T23:59:59.999Z');
    expect(() =>
      projectionRetryBackoff({
        name: P,
        version: 1,
        position: 7n,
        failureNumber: 4,
        now: nearMax,
      }),
    ).toThrow(ProjectionInputError);
  });
});

/**
 * Stage 3.4.4 — the frozen runner result union (ADR-0037). Unit tests: seven variants, identity on
 * every variant, only repository-owned primitives, all frozen. No database.
 */
import { describe, expect, it } from 'vitest';

import { toProjectionName, type ProjectionName } from '../projections/projection-name.js';
import {
  busyResult,
  blockedExistingResult,
  blockedNowResult,
  caughtUpResult,
  retryPendingResult,
  retryScheduledResult,
  succeededResult,
  type ProjectionRunResult,
} from '../projections/projection-run-result.js';

const NAME: ProjectionName = toProjectionName('event-type-activity');
const ID = { projectionName: NAME, projectionVersion: 1 };
const INSTANT = '2026-07-19T00:00:00.551Z';

const ALL: ProjectionRunResult[] = [
  busyResult(ID),
  caughtUpResult(ID, 5n),
  succeededResult(ID, 6n, 1),
  retryScheduledResult(ID, 6n, 2, 'projection-handler-failed', INSTANT as never),
  blockedNowResult(ID, 6n, 'projection-handler-failed'),
  blockedExistingResult(ID, 6n, 'projection-handler-failed'),
  retryPendingResult(ID, 6n, 3, INSTANT as never),
];

describe('the runner result union (U4)', () => {
  it('has exactly the seven expected outcomes', () => {
    expect(ALL.map((r) => r.outcome).sort()).toEqual([
      'blocked-existing',
      'blocked-now',
      'busy',
      'caught-up',
      'retry-pending',
      'retry-scheduled',
      'succeeded',
    ]);
  });

  it('every variant is frozen and carries the projection identity', () => {
    for (const result of ALL) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(result.projectionName).toBe(NAME);
      expect(result.projectionVersion).toBe(1);
    }
  });

  it('carries only repository-owned primitives — no Date/Error/array/Map/cause/stack in any field', () => {
    for (const result of ALL) {
      for (const value of Object.values(result)) {
        expect(value instanceof Date).toBe(false);
        expect(value instanceof Error).toBe(false);
        expect(value instanceof Map).toBe(false);
        expect(Array.isArray(value)).toBe(false);
        const t = typeof value;
        expect(t === 'string' || t === 'bigint' || t === 'number').toBe(true);
      }
      expect(result).not.toHaveProperty('cause');
      expect(result).not.toHaveProperty('stack');
      expect(result).not.toHaveProperty('sqlstate');
    }
  });

  it('blocked-now vs blocked-existing are distinct with distinct fields', () => {
    const now = blockedNowResult(ID, 6n, 'projection-handler-failed');
    const existing = blockedExistingResult(ID, 6n, 'projection-handler-failed');
    expect(now.outcome).toBe('blocked-now');
    expect(now.attemptNumber).toBe(5);
    expect(now).not.toHaveProperty('failedAttemptCount');
    expect(existing.outcome).toBe('blocked-existing');
    expect(existing.failedAttemptCount).toBe(5);
    expect(existing).not.toHaveProperty('attemptNumber');
  });

  it('positions are bigint and instants are canonical strings', () => {
    const s = succeededResult(ID, 6n, 1);
    expect(typeof s.position).toBe('bigint');
    const r = retryScheduledResult(ID, 6n, 2, 'projection-handler-failed', INSTANT as never);
    expect(typeof r.nextAttemptAt).toBe('string');
    expect(typeof r.position).toBe('bigint');
  });
});

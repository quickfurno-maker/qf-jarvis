/**
 * Runner-owned reconciliation and runner-error serialization (ADR-0037). Unit tests (U6). No database.
 *
 * SQLSTATE inspection and failure classification moved to `projection-failure-taxonomy.ts` in
 * QFJ-P03.07B and are covered by `projection-failure-taxonomy.test.ts`. This file keeps the tests for
 * the runner's own guarded error recognition and its attempt/checkpoint reconciliation guard.
 */
import { describe, expect, it } from 'vitest';

import type { ProjectionAttemptRow } from '../projections/attempt-store.js';
import {
  assertFailedAttempts,
  isProjectionRunnerErrorSafely,
} from '../projections/projection-runner.js';
import {
  PROJECTION_RUNNER_ERROR_CODES,
  ProjectionRunnerError,
} from '../projections/projection-runner-errors.js';

const NOW = new Date('2026-07-19T00:00:00.000Z');
function failedRow(attemptNumber: number): ProjectionAttemptRow {
  return {
    sequence: BigInt(attemptNumber),
    attemptNumber,
    outcome: 'failed',
    safeErrorCode: 'projection-handler-failed',
    startedAt: NOW,
    completedAt: NOW,
    recordedAt: NOW,
  };
}
function succeededRow(attemptNumber: number): ProjectionAttemptRow {
  return { ...failedRow(attemptNumber), outcome: 'succeeded', safeErrorCode: null };
}

describe('isProjectionRunnerErrorSafely — guarded recognition (Correction-3 C2)', () => {
  it('recognises an authentic ProjectionRunnerError, retaining its exact code', () => {
    const error = new ProjectionRunnerError('projection-infrastructure-failed');
    expect(isProjectionRunnerErrorSafely(error)).toBe(true);
    expect(error.code).toBe('projection-infrastructure-failed'); // code intact
  });

  it('rejects an ordinary Error and a thrown primitive', () => {
    expect(isProjectionRunnerErrorSafely(new Error('boom'))).toBe(false);
    expect(isProjectionRunnerErrorSafely('a string')).toBe(false);
    expect(isProjectionRunnerErrorSafely(42)).toBe(false);
    expect(isProjectionRunnerErrorSafely(null)).toBe(false);
    expect(isProjectionRunnerErrorSafely(undefined)).toBe(false);
  });

  it('a revoked OBJECT Proxy is not recognised and never throws a raw TypeError', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => isProjectionRunnerErrorSafely(proxy)).not.toThrow();
    expect(isProjectionRunnerErrorSafely(proxy)).toBe(false);
  });

  it('a revoked FUNCTION Proxy is not recognised and never throws a raw TypeError', () => {
    const { proxy, revoke } = Proxy.revocable((): void => undefined, {});
    revoke();
    expect(() => isProjectionRunnerErrorSafely(proxy)).not.toThrow();
    expect(isProjectionRunnerErrorSafely(proxy)).toBe(false);
  });

  it('a hostile getPrototypeOf Proxy carrying a secret marker is not recognised and never leaks', () => {
    const MARKER = 'PROTO-SECRET-3f9d';
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(MARKER);
        },
      },
    );
    let threw: unknown = null;
    let recognised: unknown;
    try {
      recognised = isProjectionRunnerErrorSafely(hostile);
    } catch (error) {
      threw = error;
    }
    expect(threw).toBeNull(); // the trap's throw never escapes `instanceof`
    expect(recognised).toBe(false);
  });
});

/** Run the reconciliation guard, returning the thrown error (or null on success). */
function runAssert(rows: readonly ProjectionAttemptRow[], expected: number): unknown {
  try {
    assertFailedAttempts(rows, expected);
    return null;
  } catch (error) {
    return error;
  }
}

describe('assertFailedAttempts reconciliation (U6)', () => {
  it('accepts exactly k failed attempts numbered 1..k', () => {
    expect(runAssert([], 0)).toBeNull();
    expect(runAssert([failedRow(1)], 1)).toBeNull();
    expect(runAssert([failedRow(1), failedRow(2), failedRow(3), failedRow(4)], 4)).toBeNull();
  });

  it('rejects a count mismatch', () => {
    expect(runAssert([failedRow(1)], 0)).toBeInstanceOf(ProjectionRunnerError);
    expect(runAssert([failedRow(1)], 2)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('rejects a gap in attempt numbers', () => {
    expect(runAssert([failedRow(1), failedRow(3)], 2)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('rejects a duplicate attempt number', () => {
    expect(runAssert([failedRow(1), failedRow(1)], 2)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('rejects a succeeded row among the expected failures', () => {
    expect(runAssert([failedRow(1), succeededRow(2)], 2)).toBeInstanceOf(ProjectionRunnerError);
    expect(runAssert([succeededRow(1)], 1)).toBeInstanceOf(ProjectionRunnerError);
  });

  it('the divergence error is the closed code with no caller text', () => {
    const caught = runAssert([failedRow(1)], 3);
    expect(caught).toBeInstanceOf(ProjectionRunnerError);
    expect((caught as ProjectionRunnerError).code).toBe('projection-attempt-checkpoint-divergent');
  });
});

describe('ProjectionRunnerError — runtime-normalised, no leak (U5)', () => {
  it('normalises a forged code to the safe fallback and leaks no marker', () => {
    const MARKER = 'RUNNER-SECRET-9c1a';
    const forged = new ProjectionRunnerError(MARKER as never);
    expect(forged.code).toBe('projection-infrastructure-failed');
    const rendered = `${forged.message} ${forged.code} ${forged.stack ?? ''}`;
    expect(rendered).not.toContain(MARKER);
    expect((forged as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(forged)).not.toContain(MARKER);
  });

  it('every declared code maps to a non-empty fixed message', () => {
    for (const code of PROJECTION_RUNNER_ERROR_CODES) {
      const error = new ProjectionRunnerError(code);
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('includes the new unknown-failure code, distinct from infrastructure', () => {
    expect(PROJECTION_RUNNER_ERROR_CODES).toContain('projection-unknown-failure');
    const unknown = new ProjectionRunnerError('projection-unknown-failure');
    const infra = new ProjectionRunnerError('projection-infrastructure-failed');
    expect(unknown.code).not.toBe(infra.code);
    expect(unknown.message).not.toBe(infra.message);
  });
});

/**
 * Input validation for the internal checkpoint and attempt repositories (Stage 3.4.1, ADR-0034).
 *
 * These are UNIT tests: they prove that a structurally invalid input is refused with a typed, safe
 * error BEFORE any SQL is attempted. The fake client throws if queried, so a test that expected a
 * validation error but reached SQL would fail loudly. Database behaviour is proven in the integration
 * suite.
 */
import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  advanceCheckpointOnSuccess,
  createCheckpointIfAbsent,
  recordCheckpointBlocked,
  recordCheckpointRetryPending,
} from '../projections/checkpoint-store.js';
import {
  appendAttempt,
  appendFailedAttempt,
  appendSucceededAttempt,
  readAttemptsForEvent,
} from '../projections/attempt-store.js';
import {
  ProjectionInputError,
  ProjectionStoredDataError,
} from '../projections/projection-errors.js';
import { toProjectionName } from '../projections/projection-name.js';
import { ProjectionSafeErrorCodeError } from '../projections/projection-safe-error.js';

/** A client that fails loudly if any SQL is attempted — validation must reject first. */
const noSql = {
  query: () => {
    throw new Error('SQL must not be reached for invalid input');
  },
} as unknown as DatabaseClient;

/** A client that returns a fixed set of rows — used to feed a malformed stored row to a reader. */
function rowsClient(rows: readonly Record<string, unknown>[]): DatabaseClient {
  return { query: () => Promise.resolve({ rows }) } as unknown as DatabaseClient;
}

const NAME = toProjectionName('event-type-activity');
const NOW = new Date('2026-07-18T00:00:00.000Z');
const EARLIER = new Date('2026-07-17T00:00:00.000Z');

describe('checkpoint repository — input validation (no SQL for invalid input)', () => {
  it('rejects a non-positive version', async () => {
    await expect(
      createCheckpointIfAbsent(noSql, { name: NAME, version: 0, now: NOW }),
    ).rejects.toThrow(ProjectionInputError);
    await expect(
      advanceCheckpointOnSuccess(noSql, {
        name: NAME,
        version: -1,
        processedEventSequence: 1n,
        now: NOW,
      }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('rejects a non-positive processed sequence', async () => {
    await expect(
      advanceCheckpointOnSuccess(noSql, {
        name: NAME,
        version: 1,
        processedEventSequence: 0n,
        now: NOW,
      }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('rejects a retry-pending failed_attempt_count outside 1..MAX-1', async () => {
    for (const count of [0, 5, 6, -1]) {
      await expect(
        recordCheckpointRetryPending(noSql, {
          name: NAME,
          version: 1,
          failedEventSequence: 1n,
          failedAttemptCount: count,
          safeErrorCode: 'projection-handler-failed',
          nextAttemptAt: NOW,
          now: NOW,
        }),
      ).rejects.toThrow(ProjectionInputError);
    }
  });

  it('rejects an unsafe error code on retry-pending and on blocked', async () => {
    await expect(
      recordCheckpointRetryPending(noSql, {
        name: NAME,
        version: 1,
        failedEventSequence: 1n,
        failedAttemptCount: 1,
        // @ts-expect-error — an arbitrary code is not a ProjectionSafeErrorCode
        safeErrorCode: 'boom: raw db message',
        nextAttemptAt: null,
        now: NOW,
      }),
    ).rejects.toThrow(ProjectionSafeErrorCodeError);
    await expect(
      recordCheckpointBlocked(noSql, {
        name: NAME,
        version: 1,
        blockedSequence: 1n,
        // @ts-expect-error — an arbitrary code is not a ProjectionSafeErrorCode
        safeErrorCode: 'ERROR: deadlock detected',
        now: NOW,
      }),
    ).rejects.toThrow(ProjectionSafeErrorCodeError);
  });

  it('rejects an invalid timestamp', async () => {
    await expect(
      createCheckpointIfAbsent(noSql, { name: NAME, version: 1, now: new Date(Number.NaN) }),
    ).rejects.toThrow(ProjectionInputError);
  });
});

describe('attempt repository — input validation (no SQL for invalid input)', () => {
  const base = {
    name: NAME,
    version: 1,
    eventSequence: 1n,
    startedAt: NOW,
    completedAt: NOW,
  } as const;

  it('rejects attempt number 0 and 6', async () => {
    await expect(appendSucceededAttempt(noSql, { ...base, attemptNumber: 0 })).rejects.toThrow(
      ProjectionInputError,
    );
    await expect(appendSucceededAttempt(noSql, { ...base, attemptNumber: 6 })).rejects.toThrow(
      ProjectionInputError,
    );
  });

  it('rejects a succeeded attempt that carries an error code', async () => {
    await expect(
      appendAttempt(noSql, {
        ...base,
        attemptNumber: 1,
        outcome: 'succeeded',
        safeErrorCode: 'projection-handler-failed',
      }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('rejects a failed attempt with no error code', async () => {
    await expect(
      appendAttempt(noSql, {
        ...base,
        attemptNumber: 1,
        outcome: 'failed',
        safeErrorCode: null,
      }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('rejects completed_at earlier than started_at', async () => {
    await expect(
      appendSucceededAttempt(noSql, { ...base, attemptNumber: 1, completedAt: EARLIER }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('rejects arbitrary error text passed as a safe error code', async () => {
    await expect(
      appendFailedAttempt(noSql, {
        ...base,
        attemptNumber: 1,
        // @ts-expect-error — arbitrary text is not a ProjectionSafeErrorCode
        safeErrorCode: 'Error: something leaked at handler.ts:42',
      }),
    ).rejects.toThrow(ProjectionSafeErrorCodeError);
  });

  it('rejects a non-positive version and event sequence', async () => {
    await expect(
      appendSucceededAttempt(noSql, { ...base, version: 0, attemptNumber: 1 }),
    ).rejects.toThrow(ProjectionInputError);
    await expect(
      appendSucceededAttempt(noSql, { ...base, eventSequence: 0n, attemptNumber: 1 }),
    ).rejects.toThrow(ProjectionInputError);
  });
});

describe('readAttemptsForEvent — input validation and fail-closed stored-value parsing', () => {
  const wellFormedRow = {
    sequence: '1',
    attempt_number: 1,
    outcome: 'succeeded',
    safe_error_code: null,
    started_at: NOW,
    completed_at: NOW,
    recorded_at: NOW,
  };

  it('rejects a non-positive / negative version before SQL', async () => {
    await expect(
      readAttemptsForEvent(noSql, { name: NAME, version: 0, eventSequence: 1n }),
    ).rejects.toThrow(ProjectionInputError);
    await expect(
      readAttemptsForEvent(noSql, { name: NAME, version: -3, eventSequence: 1n }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('rejects a non-positive event sequence before SQL', async () => {
    await expect(
      readAttemptsForEvent(noSql, { name: NAME, version: 1, eventSequence: 0n }),
    ).rejects.toThrow(ProjectionInputError);
  });

  it('fails closed on a malformed stored outcome', async () => {
    const client = rowsClient([{ ...wellFormedRow, outcome: 'dead-letter' }]);
    await expect(
      readAttemptsForEvent(client, { name: NAME, version: 1, eventSequence: 1n }),
    ).rejects.toThrow(ProjectionStoredDataError);
  });

  it('fails closed on a malformed stored safe error code', async () => {
    const client = rowsClient([
      { ...wellFormedRow, outcome: 'failed', safe_error_code: 'ERROR: raw leaked text' },
    ]);
    await expect(
      readAttemptsForEvent(client, { name: NAME, version: 1, eventSequence: 1n }),
    ).rejects.toThrow(ProjectionStoredDataError);
  });

  it('parses a well-formed stored row', async () => {
    const client = rowsClient([wellFormedRow]);
    const rows = await readAttemptsForEvent(client, { name: NAME, version: 1, eventSequence: 1n });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe('succeeded');
    expect(rows[0]?.safeErrorCode).toBeNull();
  });
});

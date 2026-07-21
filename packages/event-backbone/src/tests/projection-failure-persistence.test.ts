/**
 * QFJ-P03.07C — projection-failure persistence CONTRACTS and repository input validation. Unit tests
 * (no database). The repository functions validate every input at the boundary and reject it BEFORE
 * any SQL is issued; a fake client that throws on `query` proves nothing reaches the database.
 */
import { describe, expect, it } from 'vitest';

import * as publicApi from '../index.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionInputError } from '../projections/projection-errors.js';
import {
  assertBoundedText,
  assertUuid,
  isProjectionFailureActionType,
  isProjectionFailureActorType,
  isProjectionFailureStatus,
  isProjectionPersistedFailureCode,
  isProjectionReplayAttemptState,
  isProjectionReplayAuthorizationState,
  isTerminalProjectionFailureStatus,
  PROJECTION_FAILURE_ACTION_TYPES,
  PROJECTION_FAILURE_STATUSES,
  PROJECTION_FAILURE_TERMINAL_STATUSES,
  type ProjectionFailureId,
} from '../projections/projection-failure-persistence.js';
import {
  appendProjectionFailureAction,
  createProjectionFailure,
  createReplayAuthorization,
  startReplayAttempt,
} from '../projections/projection-failure-repository.js';
import { toProjectionName } from '../projections/projection-name.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

/** A client that FAILS the test if any SQL is issued — proves validation fails closed first. */
const noQueryClient = {
  query: () => {
    throw new Error('the repository must not issue SQL when input is invalid');
  },
} as unknown as DatabaseClient;

describe('closed vocabularies', () => {
  it('statuses, action types, actor types, states are closed', () => {
    expect(isProjectionFailureStatus('open')).toBe(true);
    expect(isProjectionFailureStatus('not-a-status')).toBe(false);
    expect(isTerminalProjectionFailureStatus('resolved')).toBe(true);
    expect(isTerminalProjectionFailureStatus('open')).toBe(false);
    expect(PROJECTION_FAILURE_STATUSES).toContain('replaying');
    expect(PROJECTION_FAILURE_TERMINAL_STATUSES).toEqual(['resolved', 'superseded', 'retired']);
    expect(isProjectionFailureActionType('replay-succeeded')).toBe(true);
    expect(isProjectionFailureActionType('nope')).toBe(false);
    expect(PROJECTION_FAILURE_ACTION_TYPES).toHaveLength(12);
    expect(isProjectionFailureActorType('replay-approver')).toBe(true);
    expect(isProjectionFailureActorType('root')).toBe(false);
    expect(isProjectionReplayAuthorizationState('consumed')).toBe(true);
    expect(isProjectionReplayAuthorizationState('done')).toBe(false);
    expect(isProjectionReplayAttemptState('abandoned')).toBe(true);
    expect(isProjectionReplayAttemptState('paused')).toBe(false);
    expect(isProjectionPersistedFailureCode('projection-unknown-failure')).toBe(true);
    expect(isProjectionPersistedFailureCode('made-up')).toBe(false);
  });
});

describe('assertUuid / assertBoundedText validators', () => {
  it('accepts a valid UUID (normalised to lowercase) and rejects a non-UUID', () => {
    expect(assertUuid('AAAAAAAA-1111-4111-8111-111111111111', 'x')).toBe(
      'aaaaaaaa-1111-4111-8111-111111111111',
    );
    expect(() => assertUuid('not-a-uuid', 'x')).toThrow(ProjectionInputError);
    expect(() => assertUuid(42, 'x')).toThrow(ProjectionInputError);
  });

  it('bounds text length and rejects control characters and empty strings', () => {
    expect(assertBoundedText('operator-7', 128, 'actor')).toBe('operator-7');
    expect(() => assertBoundedText('', 128, 'actor')).toThrow(ProjectionInputError);
    expect(() => assertBoundedText('x'.repeat(129), 128, 'actor')).toThrow(ProjectionInputError);
    expect(() => assertBoundedText(`bad${String.fromCharCode(10)}line`, 128, 'actor')).toThrow(
      ProjectionInputError,
    );
    expect(() => assertBoundedText(`bad${String.fromCharCode(0)}nul`, 128, 'actor')).toThrow(
      ProjectionInputError,
    );
    expect(() => assertBoundedText(42, 128, 'actor')).toThrow(ProjectionInputError);
  });
});

describe('createProjectionFailure — input validation before any SQL', () => {
  const base = {
    failureId: UUID as ProjectionFailureId,
    name: toProjectionName('rm-event-type-activity'),
    version: 1,
    position: 5n,
    eventStorageSequence: 7n,
    category: 'DETERMINISTIC_HANDLER_FAILURE',
    safeErrorCode: 'projection-handler-failed',
    automaticAttemptCount: 5,
    firstFailedAt: new Date('2026-07-22T00:00:00Z'),
    lastFailedAt: new Date('2026-07-22T00:00:05Z'),
    now: new Date('2026-07-22T00:00:05Z'),
  };

  it.each([
    ['bad failure id', { ...base, failureId: 'nope' as ProjectionFailureId }],
    ['zero version', { ...base, version: 0 }],
    ['zero position', { ...base, position: 0n }],
    ['non-bigint position', { ...base, position: 5 as unknown as bigint }],
    ['unknown category', { ...base, category: 'MADE_UP' }],
    ['unknown code', { ...base, safeErrorCode: 'nope' }],
    ['attempt count 6', { ...base, automaticAttemptCount: 6 }],
    ['reversed timestamps', { ...base, lastFailedAt: new Date('2020-01-01T00:00:00Z') }],
  ])('rejects %s and issues no SQL', async (_label, input) => {
    await expect(createProjectionFailure(noQueryClient, input)).rejects.toBeInstanceOf(
      ProjectionInputError,
    );
  });
});

describe('appendProjectionFailureAction — input validation before any SQL', () => {
  const base = {
    actionId: UUID,
    failureId: UUID2 as ProjectionFailureId,
    actionType: 'created' as const,
    actorType: 'system' as const,
    actorId: 'system',
    occurredAt: new Date('2026-07-22T00:00:00Z'),
  };

  it('rejects an unknown action type', async () => {
    await expect(
      appendProjectionFailureAction(noQueryClient, {
        ...base,
        actionType: 'exploded' as never,
        actionId: UUID as never,
      }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
  });

  it('rejects an unknown actor type', async () => {
    await expect(
      appendProjectionFailureAction(noQueryClient, {
        ...base,
        actorType: 'root' as never,
        actionId: UUID as never,
      }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
  });

  it('rejects an oversized reason', async () => {
    await expect(
      appendProjectionFailureAction(noQueryClient, {
        ...base,
        actionId: UUID as never,
        reason: 'x'.repeat(513),
      }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
  });
});

describe('replay authorization / attempt — input validation before any SQL', () => {
  it('createReplayAuthorization rejects a bad idempotency key and non-UUID ids', async () => {
    await expect(
      createReplayAuthorization(noQueryClient, {
        authorizationId: 'nope' as never,
        failureId: UUID as never,
        failureGeneration: 0,
        authorizedBy: 'approver-1',
        idempotencyKey: 'k',
        createdAt: new Date('2026-07-22T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
  });

  it('startReplayAttempt rejects an incoherent lease (expiry <= acquired)', async () => {
    await expect(
      startReplayAttempt(noQueryClient, {
        attemptId: UUID as never,
        failureId: UUID2 as never,
        authorizationId: UUID as never,
        attemptNumber: 1,
        leaseOwner: 'runner-1',
        leaseAcquiredAt: new Date('2026-07-22T00:00:10Z'),
        leaseExpiresAt: new Date('2026-07-22T00:00:05Z'),
        startedAt: new Date('2026-07-22T00:00:10Z'),
      }),
    ).rejects.toBeInstanceOf(ProjectionInputError);
  });
});

describe('persistence stays internal — no package-root runtime surface change', () => {
  it('none of the persistence symbols are reachable from the package root', () => {
    for (const symbol of [
      'createProjectionFailure',
      'appendProjectionFailureAction',
      'createReplayAuthorization',
      'startReplayAttempt',
      'detectProjectionFailureDivergences',
      'PROJECTION_FAILURE_STATUSES',
      'assertUuid',
    ]) {
      expect(publicApi).not.toHaveProperty(symbol);
    }
  });
});

/**
 * QFJ-P03.07G — the redaction guarantee.
 *
 * This is the security test for the whole observability slice, and it deliberately asserts on the FULL
 * SERIALISED OUTPUT rather than on selected fields. Checking `record.payload === undefined` would pass
 * even if a payload had been concatenated into some other field; searching the emitted bytes cannot be
 * fooled that way.
 *
 * The guarantee it protects is not new. The runner and worker already use bindingless `catch` blocks so
 * a thrown value is never read, stringified, or retained, and the failure aggregate persists only closed
 * codes. The most natural way to write a "better" log line is to capture the error — which would
 * silently undo that property across the entire subsystem. These tests exist to make that regression
 * loud.
 */
import { describe, expect, it } from 'vitest';

import {
  PROJECTION_LOG_EVENT_NAMES,
  type ProjectionScopedLogEvent,
  type ProjectionWorkerScopedLogEvent,
} from '../observability/projection-log-events.js';
import { createProjectionLogger } from '../observability/projection-logger.js';
import {
  createProjectionMetricsRegistry,
  isForbiddenProjectionMetricLabelKey,
  isProjectionMetricLabelKey,
} from '../observability/projection-metrics.js';
import { toCanonicalInstant } from '../projections/projection-definition.js';
import type { ProjectionName } from '../projections/projection-name.js';

const NOW = toCanonicalInstant(new Date('2026-07-24T10:00:00.000Z'));
const IDENTITY = {
  projectionName: 'event-type-activity' as ProjectionName,
  projectionVersion: 1,
};
const FAILURE_ID = '11111111-2222-4333-8444-555555555555' as never;
const ATTEMPT_ID = '22222222-3333-4444-8555-666666666666' as never;
const AUTHORIZATION_ID = '33333333-4444-4555-8666-777777777777' as never;

/**
 * Sentinels standing in for every class of forbidden content. If any appears in emitted bytes, the
 * redaction boundary has been breached.
 */
const FORBIDDEN_SENTINELS = [
  'CUSTOMER-PAYLOAD-SENTINEL',
  'SUBJECT-SENTINEL',
  'RAW-MESSAGE-SENTINEL',
  'STACK-SENTINEL',
  'SELECT * FROM qf_jarvis.event',
  '23505',
  'postgresql://user:hunter2@db.example.internal:5432/postgres',
  'hunter2',
  'db.example.internal',
  '/etc/ssl/certs/supabase-ca.pem',
  '-----BEGIN CERTIFICATE-----',
  'OPERATOR-FREE-TEXT-SENTINEL',
  'sender-correlation-sentinel',
] as const;

/** Every event in the contract, built with realistic values. Exhaustive by construction (see below). */
function everyProjectionEvent(): readonly ProjectionScopedLogEvent[] {
  return [
    {
      event: 'projection.retry.scheduled',
      position: 7n,
      attemptNumber: 2,
      safeErrorCode: 'projection-handler-failed',
      nextAttemptAt: NOW,
    },
    {
      event: 'projection.retry.exhausted',
      position: 7n,
      attemptNumber: 5,
      safeErrorCode: 'projection-handler-failed',
      failureId: FAILURE_ID,
    },
    {
      event: 'projection.blocked',
      blockedPosition: 7n,
      safeErrorCode: 'projection-handler-failed',
      failureId: FAILURE_ID,
    },
    {
      event: 'projection.failure.created',
      failureId: FAILURE_ID,
      position: 7n,
      category: 'DETERMINISTIC_HANDLER_FAILURE',
      safeErrorCode: 'projection-handler-failed',
      automaticAttemptCount: 5,
      generation: 0,
    },
    {
      event: 'projection.failure.acknowledged',
      failureId: FAILURE_ID,
      actorType: 'failure-operator',
      actorId: 'ops-1',
      resultingGeneration: 1,
    },
    {
      event: 'projection.failure.quarantined',
      failureId: FAILURE_ID,
      actorType: 'failure-operator',
      actorId: 'ops-1',
      resultingGeneration: 2,
    },
    {
      event: 'projection.replay.authorized',
      failureId: FAILURE_ID,
      authorizationId: AUTHORIZATION_ID,
      actorType: 'replay-approver',
      actorId: 'approver-1',
      expiresAt: NOW,
      resultingGeneration: 3,
    },
    {
      event: 'projection.replay.lease.acquired',
      failureId: FAILURE_ID,
      authorizationId: AUTHORIZATION_ID,
      attemptId: ATTEMPT_ID,
      attemptNumber: 1,
      leaseExpiresAt: NOW,
    },
    {
      event: 'projection.replay.lease.takenOver',
      failureId: FAILURE_ID,
      authorizationId: AUTHORIZATION_ID,
      attemptId: ATTEMPT_ID,
      attemptNumber: 2,
      leaseExpiresAt: NOW,
      abandonedAttemptId: ATTEMPT_ID,
    },
    {
      event: 'projection.replay.started',
      failureId: FAILURE_ID,
      attemptId: ATTEMPT_ID,
      position: 7n,
    },
    {
      event: 'projection.replay.succeeded',
      failureId: FAILURE_ID,
      attemptId: ATTEMPT_ID,
      position: 7n,
      resumedToPosition: 7n,
    },
    {
      event: 'projection.replay.failed',
      failureId: FAILURE_ID,
      attemptId: ATTEMPT_ID,
      position: 7n,
      safeErrorCode: 'projection-handler-failed',
    },
    {
      event: 'projection.divergence.detected',
      runnerErrorCode: 'projection-attempt-checkpoint-divergent',
      position: 7n,
      divergenceKind: 'active-failure-position-mismatch',
    },
    {
      event: 'projection.infrastructure.failed',
      runnerErrorCode: 'projection-infrastructure-failed',
      phase: 'bookkeeping',
    },
    {
      event: 'projection.commit.outcomeUnknown',
      runnerErrorCode: 'projection-commit-outcome-unknown',
      position: 7n,
      phase: 'bookkeeping',
    },
    { event: 'projection.worker.cycle', outcome: 'blocked-existing', position: 7n },
  ];
}

function everyWorkerEvent(): readonly ProjectionWorkerScopedLogEvent[] {
  return [
    { event: 'projection.worker.started' },
    { event: 'projection.worker.stopped', cycles: 3, succeeded: 1, stoppedBy: 'aborted' },
  ];
}

function emitAll(): string[] {
  const lines: string[] = [];
  const logger = createProjectionLogger({
    sink: {
      write: (line) => {
        lines.push(line);
      },
    },
    now: () => NOW,
    minSeverity: 'debug',
    workerCycleSampling: 1,
  });
  for (const event of everyProjectionEvent()) {
    logger.projectionEvent(IDENTITY, event);
  }
  for (const event of everyWorkerEvent()) {
    logger.workerEvent(event);
  }
  return lines;
}

describe('every event in the contract is covered', () => {
  it('exercises all eighteen declared event names', () => {
    const covered = new Set([
      ...everyProjectionEvent().map((event) => event.event),
      ...everyWorkerEvent().map((event) => event.event),
    ]);
    // If a new event is added to the vocabulary without a fixture here, this fails — so the redaction
    // sweep below can never silently stop covering the whole contract.
    expect([...covered].sort()).toEqual([...PROJECTION_LOG_EVENT_NAMES].sort());
  });
});

describe('emitted log output carries no forbidden content', () => {
  it('emits every event without any sensitive sentinel appearing anywhere', () => {
    const output = emitAll().join('\n');
    expect(output.length).toBeGreaterThan(0);
    for (const sentinel of FORBIDDEN_SENTINELS) {
      expect(output).not.toContain(sentinel);
    }
  });

  it('carries no field named after a forbidden concept', () => {
    for (const line of emitAll()) {
      const record = JSON.parse(line) as Record<string, unknown>;
      for (const forbidden of [
        'payload',
        'subject',
        'metadata',
        'message',
        'stack',
        'cause',
        'sql',
        'sqlstate',
        'connectionString',
        'host',
        'username',
        'password',
        'token',
        'certificatePath',
        'reason',
        'correlationId',
        'eventType',
        'eventId',
      ]) {
        expect(record).not.toHaveProperty(forbidden);
      }
    }
  });

  it('drops hostile extra properties instead of serialising them', () => {
    const lines: string[] = [];
    const logger = createProjectionLogger({
      sink: {
        write: (line) => {
          lines.push(line);
        },
      },
      now: () => NOW,
      minSeverity: 'debug',
    });
    // A caller that smuggles extra properties past the type system at runtime. The explicit field
    // projection is what stops them; a spread would faithfully serialise every one.
    logger.projectionEvent(IDENTITY, {
      event: 'projection.infrastructure.failed',
      runnerErrorCode: 'projection-infrastructure-failed',
      phase: 'read',
      message: 'RAW-MESSAGE-SENTINEL',
      stack: 'STACK-SENTINEL',
      sql: 'SELECT * FROM qf_jarvis.event',
      payload: { subject: 'SUBJECT-SENTINEL' },
    } as unknown as ProjectionScopedLogEvent);
    const output = lines.join('\n');
    for (const sentinel of FORBIDDEN_SENTINELS) {
      expect(output).not.toContain(sentinel);
    }
  });

  it('never emits the operator free-text reason on an acknowledge or quarantine event', () => {
    // The reason IS persisted in the action ledger for audit. It is the one unbounded operator-supplied
    // string in the lifecycle, so it must never become log output.
    const lines: string[] = [];
    const logger = createProjectionLogger({
      sink: {
        write: (line) => {
          lines.push(line);
        },
      },
      now: () => NOW,
      minSeverity: 'debug',
    });
    logger.projectionEvent(IDENTITY, {
      event: 'projection.failure.acknowledged',
      failureId: FAILURE_ID,
      actorType: 'failure-operator',
      actorId: 'ops-1',
      resultingGeneration: 1,
      reason: 'OPERATOR-FREE-TEXT-SENTINEL',
    } as unknown as ProjectionScopedLogEvent);
    expect(lines.join('\n')).not.toContain('OPERATOR-FREE-TEXT-SENTINEL');
  });
});

describe('metric labels carry no unbounded or sensitive key', () => {
  it('rejects every forbidden label key at runtime', () => {
    const registry = createProjectionMetricsRegistry();
    for (const forbidden of [
      'position',
      'failure_id',
      'authorization_id',
      'attempt_id',
      'event_id',
      'actor_id',
      'correlation_id',
      'event_type',
      'message',
      'stack',
      'sqlstate',
      'sql',
    ]) {
      registry.increment('projection_retry_exhaustion_total', {
        projection_name: 'event-type-activity',
        projection_version: 1,
        [forbidden]: 'x',
      });
    }
    expect(registry.snapshot()).toHaveLength(0);
    expect(registry.rejectedSamples()).toBe(12);
  });

  it('every accepted label key is allowed and none is forbidden', () => {
    const registry = createProjectionMetricsRegistry();
    registry.increment('projection_attempts_total', {
      projection_name: 'event-type-activity',
      projection_version: 1,
      outcome: 'blocked-now',
    });
    registry.increment('projection_divergence_total', {
      projection_name: 'event-type-activity',
      projection_version: 1,
      divergence_kind: 'attempt-count-mismatch',
    });
    registry.increment('projection_infrastructure_failures_total', {
      projection_name: 'event-type-activity',
      projection_version: 1,
      runner_error_code: 'projection-infrastructure-failed',
      phase: 'read',
    });
    const snapshot = registry.snapshot();
    expect(snapshot.length).toBeGreaterThan(0);
    for (const entry of snapshot) {
      for (const key of Object.keys(entry.labels)) {
        expect(isProjectionMetricLabelKey(key)).toBe(true);
        expect(isForbiddenProjectionMetricLabelKey(key)).toBe(false);
      }
      const serialised = JSON.stringify(entry);
      for (const sentinel of FORBIDDEN_SENTINELS) {
        expect(serialised).not.toContain(sentinel);
      }
    }
  });
});

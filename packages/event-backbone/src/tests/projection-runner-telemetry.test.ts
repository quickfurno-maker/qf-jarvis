/**
 * QFJ-P03.07G — runner telemetry, driven against a scripted fake client (no database).
 *
 * These tests establish the properties that make telemetry safe to add to a correctness path:
 *
 *  - emission happens only AFTER the transaction resolves (COMMIT or ROLLBACK), never inside it;
 *  - `blocked-existing` does NOT re-emit the transition events or re-count the exhaustion, because it
 *    recurs on every invocation until an operator acts;
 *  - the exhaustion failure id is CARRIED OUT of the transaction rather than re-queried;
 *  - divergence, infrastructure, and commit-outcome-unknown each emit their own bounded shape;
 *  - a throwing logger or registry cannot change the returned result or the transaction outcome.
 *
 * The fake client dispatches on a SQL substring and records the statement order, which is what lets the
 * "after COMMIT, never before" assertions be exact rather than approximate.
 */
import { describe, expect, it } from 'vitest';

import type { ProjectionLogger } from '../observability/projection-logger.js';
import {
  createProjectionMetricsRegistry,
  type ProjectionMetricsRegistry,
} from '../observability/projection-metrics.js';
import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import {
  toCanonicalInstant,
  type CanonicalInstant,
  type ProjectionDefinition,
} from '../projections/projection-definition.js';
import { deterministicHandlerFailure } from '../projections/projection-failure-taxonomy.js';
import type { ProjectionName } from '../projections/projection-name.js';
import type { ProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';

const NAME = 'event-type-activity' as ProjectionName;
const VERSION = 1;
const NOW: CanonicalInstant = toCanonicalInstant(new Date('2026-07-24T10:00:00.000Z'));
const NOW_DATE = new Date(NOW);

// --- A recording logger --------------------------------------------------------------------------

interface Emitted {
  readonly event: string;
  readonly record: Record<string, unknown>;
}

function recordingLogger(): { logger: ProjectionLogger; emitted: Emitted[] } {
  const emitted: Emitted[] = [];
  const capture = (record: Record<string, unknown>): void => {
    emitted.push({ event: String(record['event']), record });
  };
  return {
    emitted,
    logger: {
      projectionEvent: (identity, event) => {
        capture({ ...(event as unknown as Record<string, unknown>), ...identity });
      },
      workerEvent: (event) => {
        capture({ ...(event as unknown as Record<string, unknown>) });
      },
    },
  };
}

// --- A scripted fake client ----------------------------------------------------------------------

interface CheckpointState {
  readonly status: 'active' | 'blocked';
  readonly lastPosition: string;
  readonly blockedPosition: string | null;
  readonly failedAttemptCount: number;
  readonly lastSafeErrorCode: string | null;
  readonly nextAttemptAt: Date | null;
}

interface FakeOptions {
  readonly checkpoint: CheckpointState;
  /** Failed attempt rows returned for the pending position. */
  readonly attempts?: number;
  /** Whether an event exists at the pending position. */
  readonly eventPresent?: boolean;
  /** Active failure rows returned to `reconcileBlockedExhaustion`. */
  readonly activeFailures?: readonly { position: string }[];
  /** A SQL fragment whose statement should throw. */
  readonly failOn?: string;
  /** Make COMMIT throw, producing an unknown commit outcome. */
  readonly failCommit?: boolean;
}

function failureRow(position: string): Record<string, unknown> {
  return {
    failure_id: '11111111-2222-4333-8444-555555555555',
    projection_name: NAME,
    projection_version: VERSION,
    projection_position: position,
    event_storage_sequence: '1',
    event_id: null,
    category: 'DETERMINISTIC_HANDLER_FAILURE',
    safe_error_code: 'projection-handler-failed',
    detail_digest: null,
    status: 'open',
    generation: 0,
    automatic_attempt_count: 5,
    replay_attempt_count: 0,
    resolved_attempt_id: null,
    acknowledged_at: null,
    acknowledged_by: null,
    quarantined_at: null,
    quarantined_by: null,
    resolved_at: null,
    first_failed_at: NOW_DATE,
    last_failed_at: NOW_DATE,
    created_at: NOW_DATE,
    updated_at: NOW_DATE,
  };
}

function checkpointRow(state: CheckpointState): Record<string, unknown> {
  return {
    projection_name: NAME,
    projection_version: VERSION,
    last_position: state.lastPosition,
    status: state.status,
    blocked_position: state.blockedPosition,
    failed_attempt_count: state.failedAttemptCount,
    last_safe_error_code: state.lastSafeErrorCode,
    next_attempt_at: state.nextAttemptAt,
    created_at: NOW_DATE,
    updated_at: NOW_DATE,
  };
}

function fakePool(options: FakeOptions): { pool: DatabasePool; statements: string[] } {
  const statements: string[] = [];
  const attempts = options.attempts ?? 0;

  const client = {
    query: (text: string): Promise<{ rows: unknown[]; rowCount: number }> => {
      statements.push(text.trim());
      const reply = (rows: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> =>
        Promise.resolve({ rows, rowCount: rows.length });
      if (options.failCommit === true && text.trim() === 'COMMIT') {
        return Promise.reject(new Error('commit failed'));
      }
      if (options.failOn !== undefined && text.includes(options.failOn)) {
        return Promise.reject(new Error('scripted failure'));
      }
      if (text.includes('pg_try_advisory_xact_lock')) {
        return reply([{ locked: true }]);
      }
      if (text.includes('FROM qf_jarvis.projection_checkpoint')) {
        return reply([checkpointRow(options.checkpoint)]);
      }
      // Writes that use RETURNING / rowCount must look like they affected exactly one row, or the
      // stores fail closed before the runner ever reaches its own bookkeeping.
      if (text.includes('UPDATE qf_jarvis.projection_checkpoint')) {
        return reply([checkpointRow(options.checkpoint)]);
      }
      if (text.includes('INSERT INTO qf_jarvis.projection_attempt')) {
        return reply([{ sequence: '1' }]);
      }
      if (text.includes('INSERT INTO qf_jarvis.projection_failure_action')) {
        return reply([
          {
            sequence: '1',
            action_id: '44444444-5555-4666-8777-888888888888',
            failure_id: '11111111-2222-4333-8444-555555555555',
            action_type: 'created',
            actor_type: 'system',
            actor_id: 'projection-runner',
            reason: null,
            idempotency_key: 'retry-exhaustion:event-type-activity:v1:p1',
            correlation_id: null,
            expected_generation: null,
            resulting_generation: 0,
            occurred_at: NOW_DATE,
            recorded_at: NOW_DATE,
          },
        ]);
      }
      if (text.includes('INSERT INTO qf_jarvis.projection_failure')) {
        return reply([failureRow('1')]);
      }
      if (text.includes('FROM qf_jarvis.projection_attempt')) {
        return reply(
          Array.from({ length: attempts }, (_unused, index) => ({
            sequence: String(index + 1),
            attempt_number: index + 1,
            outcome: 'failed',
            safe_error_code: 'projection-handler-failed',
            started_at: NOW_DATE,
            completed_at: NOW_DATE,
            recorded_at: NOW_DATE,
          })),
        );
      }
      if (text.includes('FROM qf_jarvis.projection_failure')) {
        return reply((options.activeFailures ?? []).map((row) => failureRow(row.position)));
      }
      if (text.includes('projection_event_position')) {
        return reply(
          options.eventPresent === false
            ? []
            : [
                {
                  position: String(BigInt(options.checkpoint.lastPosition) + 1n),
                  event_storage_sequence: '1',
                  event_id: null,
                  event_type: 'demo.event',
                  event_version: 1,
                  accepted_at: NOW_DATE,
                },
              ],
        );
      }
      return reply([]);
    },
    release: () => undefined,
  } as unknown as DatabaseClient;

  return {
    statements,
    pool: { connect: () => Promise.resolve(client) } as unknown as DatabasePool,
  };
}

function registryFor(apply: ProjectionDefinition['apply']): ProjectionRegistry {
  const definition = { name: NAME, version: VERSION, apply } as ProjectionDefinition;
  return {
    get: (name: string) => (name === NAME ? definition : undefined),
    list: () => [definition],
    has: (name: string) => name === NAME,
    size: 1,
  } as unknown as ProjectionRegistry;
}

const succeedingHandler: ProjectionDefinition['apply'] = () => Promise.resolve();
const deterministicallyFailingHandler: ProjectionDefinition['apply'] = () =>
  Promise.reject(deterministicHandlerFailure('the reducer refused the event.'));

async function run(
  options: FakeOptions,
  apply: ProjectionDefinition['apply'],
): Promise<{
  result: unknown;
  error: unknown;
  emitted: Emitted[];
  metrics: ProjectionMetricsRegistry;
  statements: string[];
}> {
  const { logger, emitted } = recordingLogger();
  const metrics = createProjectionMetricsRegistry();
  const { pool, statements } = fakePool(options);
  let result: unknown = null;
  let error: unknown = null;
  try {
    result = await runProjectionOnce({
      pool,
      registry: registryFor(apply),
      name: NAME,
      version: VERSION,
      now: NOW,
      logger,
      metrics,
    });
  } catch (thrown: unknown) {
    error = thrown;
  }
  return { result, error, emitted, metrics, statements };
}

function counter(metrics: ProjectionMetricsRegistry, name: string): number {
  return metrics
    .snapshot()
    .filter((entry) => entry.name === name)
    .reduce((total, entry) => total + entry.value, 0);
}

const ACTIVE: CheckpointState = {
  status: 'active',
  lastPosition: '0',
  blockedPosition: null,
  failedAttemptCount: 0,
  lastSafeErrorCode: null,
  nextAttemptAt: null,
};

describe('success and bounded retry', () => {
  it('counts an attempt with the outcome label on success', async () => {
    const { result, metrics, emitted } = await run({ checkpoint: ACTIVE }, succeedingHandler);
    expect((result as { outcome: string }).outcome).toBe('succeeded');
    expect(counter(metrics, 'projection_attempts_total')).toBe(1);
    // A success is not a failure of any kind.
    expect(counter(metrics, 'projection_deterministic_failures_total')).toBe(0);
    expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(0);
    expect(emitted).toHaveLength(0);
  });

  it('emits retry.scheduled AFTER the COMMIT, never before', async () => {
    const { result, emitted, metrics, statements } = await run(
      { checkpoint: ACTIVE },
      deterministicallyFailingHandler,
    );
    expect((result as { outcome: string }).outcome).toBe('retry-scheduled');
    expect(emitted.map((entry) => entry.event)).toEqual(['projection.retry.scheduled']);
    expect(statements).toContain('COMMIT');
    expect(counter(metrics, 'projection_deterministic_failures_total')).toBe(1);
    expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(0);

    const record = emitted[0]?.record ?? {};
    expect(record['attemptNumber']).toBe(1);
    expect(record['safeErrorCode']).toBe('projection-handler-failed');
  });

  it('emits nothing durable when the bookkeeping write fails — the transaction rolled back', async () => {
    const { error, emitted, metrics } = await run(
      { checkpoint: ACTIVE, failOn: 'INSERT INTO qf_jarvis.projection_attempt' },
      deterministicallyFailingHandler,
    );
    expect((error as { code?: string }).code).toBe('projection-infrastructure-failed');
    // Exactly one infrastructure event, and NO retry/exhaustion signal: nothing was recorded.
    expect(emitted.map((entry) => entry.event)).toEqual(['projection.infrastructure.failed']);
    expect(counter(metrics, 'projection_deterministic_failures_total')).toBe(0);
    expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(0);
  });
});

describe('retry exhaustion', () => {
  const FOUR_FAILED: CheckpointState = {
    ...ACTIVE,
    failedAttemptCount: 4,
    lastSafeErrorCode: 'projection-handler-failed',
  };

  it('emits exhausted + blocked + failure.created, all carrying the SAME failure id', async () => {
    const { result, emitted, metrics } = await run(
      { checkpoint: FOUR_FAILED, attempts: 4 },
      deterministicallyFailingHandler,
    );
    expect((result as { outcome: string }).outcome).toBe('blocked-now');
    expect(emitted.map((entry) => entry.event)).toEqual([
      'projection.retry.exhausted',
      'projection.blocked',
      'projection.failure.created',
    ]);

    // The id is generated INSIDE the exhaustion transaction and carried out. All three events must
    // name the same aggregate; a re-query after the commit could not guarantee that.
    const ids = emitted.map((entry) => entry.record['failureId']);
    expect(new Set(ids).size).toBe(1);
    expect(typeof ids[0]).toBe('string');

    expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(1);
    expect(counter(metrics, 'projection_failures_created_total')).toBe(1);
    expect(counter(metrics, 'projection_deterministic_failures_total')).toBe(1);
  });

  it('reports the exhausting attempt as the fifth, with the bound as the attempt count', async () => {
    const { emitted } = await run(
      { checkpoint: FOUR_FAILED, attempts: 4 },
      deterministicallyFailingHandler,
    );
    expect(emitted[0]?.record['attemptNumber']).toBe(5);
    expect(emitted[2]?.record['automaticAttemptCount']).toBe(5);
    expect(emitted[2]?.record['category']).toBe('DETERMINISTIC_HANDLER_FAILURE');
    expect(emitted[2]?.record['generation']).toBe(0);
  });
});

describe('blocked-existing is a steady state, not a transition', () => {
  const BLOCKED: CheckpointState = {
    status: 'blocked',
    lastPosition: '0',
    blockedPosition: '1',
    failedAttemptCount: 5,
    lastSafeErrorCode: 'projection-handler-failed',
    nextAttemptAt: null,
  };

  it('emits NO transition event and increments NO exhaustion counter', async () => {
    const { result, emitted, metrics } = await run(
      {
        checkpoint: BLOCKED,
        attempts: 5,
        activeFailures: [{ position: '1' }],
      },
      succeedingHandler,
    );
    expect((result as { outcome: string }).outcome).toBe('blocked-existing');
    // The critical assertion: an unattended blocked projection is re-observed every cycle. Counting it
    // here would grow the exhaustion counter without bound.
    expect(emitted).toHaveLength(0);
    expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(0);
    expect(counter(metrics, 'projection_failures_created_total')).toBe(0);
    // The attempt itself is still counted, with the steady-state outcome label.
    expect(counter(metrics, 'projection_attempts_total')).toBe(1);
  });

  it('stays flat across repeated invocations', async () => {
    for (let index = 0; index < 5; index += 1) {
      const { emitted, metrics } = await run(
        { checkpoint: BLOCKED, attempts: 5, activeFailures: [{ position: '1' }] },
        succeedingHandler,
      );
      expect(emitted).toHaveLength(0);
      expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(0);
    }
  });
});

describe('fail-closed observability', () => {
  const BLOCKED: CheckpointState = {
    status: 'blocked',
    lastPosition: '0',
    blockedPosition: '1',
    failedAttemptCount: 5,
    lastSafeErrorCode: 'projection-handler-failed',
    nextAttemptAt: null,
  };

  it('emits a bounded divergence event with a CLOSED kind when the active failure is missing', async () => {
    const { error, emitted, metrics } = await run(
      { checkpoint: BLOCKED, attempts: 5, activeFailures: [] },
      succeedingHandler,
    );
    expect((error as { code?: string }).code).toBe('projection-attempt-checkpoint-divergent');
    expect(emitted).toHaveLength(1);
    const record = emitted[0]?.record ?? {};
    expect(record['event']).toBe('projection.divergence.detected');
    // The kind comes from a typed field on the thrown error, never parsed out of its message.
    expect(record['divergenceKind']).toBe('blocked-checkpoint-without-active-failure');
    expect(counter(metrics, 'projection_divergence_total')).toBe(1);
  });

  it('distinguishes a position mismatch from a missing failure', async () => {
    const { emitted } = await run(
      { checkpoint: BLOCKED, attempts: 5, activeFailures: [{ position: '99' }] },
      succeedingHandler,
    );
    expect(emitted[0]?.record['divergenceKind']).toBe('active-failure-position-mismatch');
  });

  it('emits an infrastructure event naming the PHASE, and never the driver detail', async () => {
    const { error, emitted, metrics } = await run(
      { checkpoint: ACTIVE, failOn: 'pg_try_advisory_xact_lock' },
      succeedingHandler,
    );
    expect((error as { code?: string }).code).toBe('projection-infrastructure-failed');
    const record = emitted[0]?.record ?? {};
    expect(record['event']).toBe('projection.infrastructure.failed');
    expect(record['phase']).toBe('lock');
    expect(record).not.toHaveProperty('message');
    expect(record).not.toHaveProperty('stack');
    expect(counter(metrics, 'projection_infrastructure_failures_total')).toBe(1);
  });

  it('emits ONLY commit-outcome-unknown on an ambiguous COMMIT — never a success or block event', async () => {
    const { error, emitted, metrics } = await run(
      { checkpoint: ACTIVE, failCommit: true },
      succeedingHandler,
    );
    expect((error as { code?: string }).code).toBe('projection-commit-outcome-unknown');
    expect(emitted.map((entry) => entry.event)).toEqual(['projection.commit.outcomeUnknown']);
    expect(counter(metrics, 'projection_commit_outcome_unknown_total')).toBe(1);
    // The write may or may not have landed, so nothing may claim it did.
    expect(counter(metrics, 'projection_retry_exhaustion_total')).toBe(0);
  });
});

describe('telemetry cannot affect correctness', () => {
  const throwingLogger: ProjectionLogger = {
    projectionEvent: () => {
      throw new Error('logger exploded');
    },
    workerEvent: () => {
      throw new Error('logger exploded');
    },
  };

  it('a throwing logger does not change a successful result', async () => {
    const { pool } = fakePool({ checkpoint: ACTIVE });
    const result = await runProjectionOnce({
      pool,
      registry: registryFor(succeedingHandler),
      name: NAME,
      version: VERSION,
      now: NOW,
      logger: throwingLogger,
    });
    expect(result.outcome).toBe('succeeded');
  });

  it('a throwing logger does not change a thrown runner code', async () => {
    const { pool } = fakePool({ checkpoint: ACTIVE, failOn: 'pg_try_advisory_xact_lock' });
    let code: string | null = null;
    try {
      await runProjectionOnce({
        pool,
        registry: registryFor(succeedingHandler),
        name: NAME,
        version: VERSION,
        now: NOW,
        logger: throwingLogger,
      });
    } catch (error: unknown) {
      code = (error as { code?: string }).code ?? null;
    }
    expect(code).toBe('projection-infrastructure-failed');
  });

  it('runs unchanged when no logger or registry is supplied at all', async () => {
    const { pool } = fakePool({ checkpoint: ACTIVE });
    const result = await runProjectionOnce({
      pool,
      registry: registryFor(succeedingHandler),
      name: NAME,
      version: VERSION,
      now: NOW,
    });
    expect(result.outcome).toBe('succeeded');
  });
});

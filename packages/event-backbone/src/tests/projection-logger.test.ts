/**
 * QFJ-P03.07G — the structured logging foundation.
 *
 * Proves the closed vocabulary, the injected clock and sink, the JSON Lines shape, the volume controls,
 * and — most importantly — that a failing sink can never propagate into a caller. The redaction
 * guarantees live in `projection-observability-redaction.test.ts`, which asserts on full serialised
 * output rather than on selected fields.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  isProjectionDivergenceKind,
  isProjectionInfrastructurePhase,
  isProjectionLogEventName,
  isProjectionLogSafeCode,
  isProjectionLogSeverity,
  projectionLogSeverityFor,
  projectionLogSeverityRank,
  PROJECTION_DIVERGENCE_KINDS,
  PROJECTION_INFRASTRUCTURE_PHASES,
  PROJECTION_LOG_EVENT_NAMES,
  PROJECTION_LOG_SEVERITIES,
  PROJECTION_LOG_SEVERITY_BY_EVENT,
} from '../observability/projection-log-events.js';
import {
  createProjectionLogger,
  NOOP_PROJECTION_LOGGER,
  WORKER_CYCLE_SAMPLING_OFF,
  type ProjectionLogSink,
} from '../observability/projection-logger.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import type { ProjectionName } from '../projections/projection-name.js';

const NOW = toCanonicalInstant(new Date('2026-07-24T10:00:00.000Z'));
const IDENTITY = {
  projectionName: 'event-type-activity' as ProjectionName,
  projectionVersion: 1,
};
const FAILURE_ID = '11111111-2222-4333-8444-555555555555';

function harness(options: Partial<Parameters<typeof createProjectionLogger>[0]> = {}): {
  lines: string[];
  logger: ReturnType<typeof createProjectionLogger>;
  sink: ProjectionLogSink;
} {
  const lines: string[] = [];
  const sink: ProjectionLogSink = {
    write: (line) => {
      lines.push(line);
    },
  };
  const logger = createProjectionLogger({
    sink,
    now: () => NOW,
    minSeverity: 'debug',
    ...options,
  });
  return { lines, logger, sink };
}

function parse(line: string | undefined): Record<string, unknown> {
  return JSON.parse(line ?? '{}') as Record<string, unknown>;
}

describe('closed vocabularies', () => {
  it('declares exactly five severities in ascending rank order', () => {
    expect(PROJECTION_LOG_SEVERITIES).toEqual(['debug', 'info', 'warn', 'error', 'critical']);
    expect(projectionLogSeverityRank('debug')).toBe(0);
    expect(projectionLogSeverityRank('critical')).toBe(4);
    for (const severity of PROJECTION_LOG_SEVERITIES) {
      expect(isProjectionLogSeverity(severity)).toBe(true);
    }
    expect(isProjectionLogSeverity('fatal')).toBe(false);
    expect(isProjectionLogSeverity(4)).toBe(false);
  });

  it('declares exactly eighteen event names, each with a frozen severity', () => {
    expect(PROJECTION_LOG_EVENT_NAMES).toHaveLength(18);
    for (const name of PROJECTION_LOG_EVENT_NAMES) {
      expect(isProjectionLogEventName(name)).toBe(true);
      expect(isProjectionLogSeverity(PROJECTION_LOG_SEVERITY_BY_EVENT[name])).toBe(true);
    }
    expect(isProjectionLogEventName('projection.something.else')).toBe(false);
  });

  it('reserves `critical` for exactly the two conditions that persist nothing', () => {
    const critical = PROJECTION_LOG_EVENT_NAMES.filter(
      (name) => PROJECTION_LOG_SEVERITY_BY_EVENT[name] === 'critical',
    );
    expect(critical.sort()).toEqual([
      'projection.commit.outcomeUnknown',
      'projection.divergence.detected',
    ]);
  });

  it('declares the five closed divergence kinds and nine closed phases', () => {
    expect(PROJECTION_DIVERGENCE_KINDS).toHaveLength(5);
    expect(PROJECTION_INFRASTRUCTURE_PHASES).toHaveLength(9);
    expect(isProjectionDivergenceKind('active-failure-position-mismatch')).toBe(true);
    expect(isProjectionDivergenceKind('something-else')).toBe(false);
    expect(isProjectionInfrastructurePhase('establish')).toBe(true);
    expect(isProjectionInfrastructurePhase('commit')).toBe(false);
  });

  it('accepts codes from BOTH closed safe-code sets (0004 attempts and 0006 taxonomy)', () => {
    expect(isProjectionLogSafeCode('projection-handler-failed')).toBe(true);
    expect(isProjectionLogSafeCode('projection-attempt-write-failed')).toBe(true);
    expect(isProjectionLogSafeCode('projection-unknown-failure')).toBe(true);
    expect(isProjectionLogSafeCode('projection-made-up')).toBe(false);
  });

  it('derives severity from the event, never from the call site', () => {
    expect(
      projectionLogSeverityFor({
        event: 'projection.divergence.detected',
        runnerErrorCode: 'projection-attempt-checkpoint-divergent',
        position: 7n,
        divergenceKind: 'attempt-count-mismatch',
      }),
    ).toBe('critical');
  });
});

describe('record shape', () => {
  it('writes one JSON object per line with a stable leading key order', () => {
    const { lines, logger } = harness();
    logger.projectionEvent(IDENTITY, {
      event: 'projection.blocked',
      blockedPosition: 42n,
      safeErrorCode: 'projection-handler-failed',
      failureId: FAILURE_ID as never,
    });
    expect(lines).toHaveLength(1);
    expect(Object.keys(parse(lines[0])).slice(0, 5)).toEqual([
      'event',
      'severity',
      'at',
      'projectionName',
      'projectionVersion',
    ]);
  });

  it('stamps `at` from the INJECTED clock', () => {
    const now = vi.fn((): CanonicalInstant => NOW);
    const { lines, logger } = harness({ now });
    logger.workerEvent({ event: 'projection.worker.started' });
    expect(now).toHaveBeenCalled();
    expect(parse(lines[0])['at']).toBe(NOW);
  });

  it('renders bigint positions as decimal strings (JSON.stringify throws on a bigint)', () => {
    const { lines, logger } = harness();
    logger.projectionEvent(IDENTITY, {
      event: 'projection.replay.succeeded',
      failureId: FAILURE_ID as never,
      attemptId: FAILURE_ID as never,
      position: 9007199254740993n,
      resumedToPosition: 9007199254740993n,
    });
    const record = parse(lines[0]);
    expect(record['position']).toBe('9007199254740993');
    expect(record['resumedToPosition']).toBe('9007199254740993');
  });

  it('omits projection identity on worker-scoped events, which span the registry', () => {
    const { lines, logger } = harness();
    logger.workerEvent({
      event: 'projection.worker.stopped',
      cycles: 3,
      succeeded: 2,
      stoppedBy: 'aborted',
    });
    const record = parse(lines[0]);
    expect(record).not.toHaveProperty('projectionName');
    expect(record).not.toHaveProperty('projectionVersion');
    expect(record['cycles']).toBe(3);
    expect(record['stoppedBy']).toBe('aborted');
  });

  it('projects ONLY declared fields — an extra runtime property never reaches the sink', () => {
    const { lines, logger } = harness();
    // The type system forbids this; a plain object at runtime does not. The projection is what makes
    // the guarantee real.
    const hostile = {
      event: 'projection.blocked',
      blockedPosition: 1n,
      safeErrorCode: 'projection-handler-failed',
      failureId: FAILURE_ID,
      payload: { secret: 'customer-data' },
      stack: 'Error: at Object.<anonymous>',
    } as unknown as Parameters<typeof logger.projectionEvent>[1];
    logger.projectionEvent(IDENTITY, hostile);
    expect(lines[0]).not.toContain('customer-data');
    expect(lines[0]).not.toContain('stack');
    expect(parse(lines[0])).not.toHaveProperty('payload');
  });
});

describe('failure containment', () => {
  it('swallows a throwing sink — emission can never propagate to a caller', () => {
    const logger = createProjectionLogger({
      sink: {
        write: () => {
          throw new Error('sink exploded');
        },
      },
      now: () => NOW,
      minSeverity: 'debug',
    });
    expect(() => {
      logger.workerEvent({ event: 'projection.worker.started' });
    }).not.toThrow();
  });

  it('swallows a throwing clock', () => {
    const logger = createProjectionLogger({
      sink: { write: () => undefined },
      now: () => {
        throw new Error('clock exploded');
      },
      minSeverity: 'debug',
    });
    expect(() => {
      logger.workerEvent({ event: 'projection.worker.started' });
    }).not.toThrow();
  });

  it('discards everything through the no-op logger without throwing', () => {
    expect(() => {
      NOOP_PROJECTION_LOGGER.workerEvent({ event: 'projection.worker.started' });
      NOOP_PROJECTION_LOGGER.projectionEvent(IDENTITY, {
        event: 'projection.blocked',
        blockedPosition: 1n,
        safeErrorCode: 'projection-handler-failed',
        failureId: FAILURE_ID as never,
      });
    }).not.toThrow();
  });
});

describe('volume control', () => {
  it('drops events below the minimum severity', () => {
    const { lines, logger } = harness({ minSeverity: 'error' });
    logger.workerEvent({ event: 'projection.worker.started' }); // info
    expect(lines).toHaveLength(0);
  });

  it('disables the per-cycle event by default (sampling off)', () => {
    const { lines, logger } = harness({ workerCycleSampling: WORKER_CYCLE_SAMPLING_OFF });
    for (let index = 0; index < 10; index += 1) {
      logger.projectionEvent(IDENTITY, {
        event: 'projection.worker.cycle',
        outcome: 'caught-up',
        position: null,
      });
    }
    expect(lines).toHaveLength(0);
  });

  it('samples the per-cycle event deterministically — every Nth, never randomly', () => {
    const { lines, logger } = harness({ workerCycleSampling: 3 });
    for (let index = 0; index < 9; index += 1) {
      logger.projectionEvent(IDENTITY, {
        event: 'projection.worker.cycle',
        outcome: 'busy',
        position: null,
      });
    }
    expect(lines).toHaveLength(3);
  });

  it('always emits the FIRST divergence, then rate-limits repeats of the same kind', () => {
    const { lines, logger } = harness({ divergenceRepeatSuppressionMs: 300_000 });
    for (let index = 0; index < 5; index += 1) {
      logger.projectionEvent(IDENTITY, {
        event: 'projection.divergence.detected',
        runnerErrorCode: 'projection-attempt-checkpoint-divergent',
        position: 7n,
        divergenceKind: 'attempt-count-mismatch',
      });
    }
    // A polling worker re-observes a divergence every cycle; without suppression this would flood.
    expect(lines).toHaveLength(1);
    expect(parse(lines[0])['severity']).toBe('critical');
  });

  it('suppresses per (name, version, kind) — a DIFFERENT kind is still reported', () => {
    const { lines, logger } = harness();
    logger.projectionEvent(IDENTITY, {
      event: 'projection.divergence.detected',
      runnerErrorCode: 'projection-attempt-checkpoint-divergent',
      position: 7n,
      divergenceKind: 'attempt-count-mismatch',
    });
    logger.projectionEvent(IDENTITY, {
      event: 'projection.divergence.detected',
      runnerErrorCode: 'projection-attempt-checkpoint-divergent',
      position: 7n,
      divergenceKind: 'missing-event-at-position',
    });
    expect(lines).toHaveLength(2);
  });

  it('NEVER suppresses commit-outcome-unknown, however often it recurs', () => {
    const { lines, logger } = harness();
    for (let index = 0; index < 4; index += 1) {
      logger.projectionEvent(IDENTITY, {
        event: 'projection.commit.outcomeUnknown',
        runnerErrorCode: 'projection-commit-outcome-unknown',
        position: 3n,
        phase: 'bookkeeping',
      });
    }
    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(parse(line)['severity']).toBe('critical');
    }
  });
});

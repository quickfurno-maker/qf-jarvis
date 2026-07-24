/**
 * QFJ-P03.07G — derived health, the health decision, and the startup schema probe.
 *
 * The health decision is the part worth stating loudly: a blocked projection DEGRADES projection
 * health and does not touch liveness, readiness, or deployment health. Failing liveness on a block
 * would make an orchestrator restart the worker, and every restart would re-observe the same block —
 * converting a contained single-projection halt into a crash loop that also stops every healthy
 * projection in the process, which is exactly the containment invariant ADR-0040 requires.
 */
import { describe, expect, it } from 'vitest';

import {
  applyProjectionHealthToMetrics,
  evaluateProjectionHealth,
  probeProjectionFailureSchema,
  readActiveFailureCounts,
  readBlockedProjections,
  readOldestActiveFailureAges,
  readProjectionCheckpointLags,
  readProjectionHealthSnapshot,
  REQUIRED_PROJECTION_FAILURE_RELATIONS,
  type ProjectionHealthSnapshot,
} from '../observability/projection-health.js';
import { createProjectionMetricsRegistry } from '../observability/projection-metrics.js';
import type { DatabaseClient } from '../persistence/pool.js';
import { toCanonicalInstant } from '../projections/projection-definition.js';

const NOW = toCanonicalInstant(new Date('2026-07-24T10:00:00.000Z'));

/** A client that answers each query from a substring-keyed script. */
function fakeClient(script: readonly (readonly [string, unknown[]])[]): DatabaseClient {
  return {
    query: (text: string): Promise<{ rows: unknown[]; rowCount: number }> => {
      for (const [fragment, rows] of script) {
        if (text.includes(fragment)) {
          return Promise.resolve({ rows: [...rows], rowCount: rows.length });
        }
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    release: () => undefined,
  } as unknown as DatabaseClient;
}

const EMPTY_SNAPSHOT: ProjectionHealthSnapshot = {
  blocked: [],
  activeFailures: [],
  oldestActiveFailureAges: [],
  lags: [],
};

describe('derived reads', () => {
  it('reads blocked checkpoints and parses BIGINT positions', async () => {
    const client = fakeClient([
      [
        'FROM qf_jarvis.projection_checkpoint',
        [
          {
            projection_name: 'event-type-activity',
            projection_version: 1,
            blocked_position: '42',
            last_safe_error_code: 'projection-handler-failed',
            failed_attempt_count: 5,
          },
        ],
      ],
    ]);
    const blocked = await readBlockedProjections(client);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.blockedPosition).toBe(42n);
    expect(blocked[0]?.failedAttemptCount).toBe(5);
  });

  it('skips a blocked row with no blocked position instead of throwing', async () => {
    // The runner already fails closed on this divergence. A health read must not be the thing that
    // breaks during the incident it is meant to describe.
    const client = fakeClient([
      [
        'FROM qf_jarvis.projection_checkpoint',
        [
          {
            projection_name: 'event-type-activity',
            projection_version: 1,
            blocked_position: null,
            last_safe_error_code: null,
            failed_attempt_count: 5,
          },
        ],
      ],
    ]);
    await expect(readBlockedProjections(client)).resolves.toHaveLength(0);
  });

  it('groups active failure counts by the closed status vocabulary', async () => {
    const client = fakeClient([
      [
        'FROM qf_jarvis.projection_failure',
        [
          {
            projection_name: 'event-type-activity',
            projection_version: 1,
            status: 'quarantined',
            count: '3',
          },
          // Not a member of the closed vocabulary — the CHECK constraint makes it unreachable, and it
          // is skipped rather than surfaced as a bogus label value.
          {
            projection_name: 'event-type-activity',
            projection_version: 1,
            status: 'not-a-status',
            count: '9',
          },
        ],
      ],
    ]);
    const counts = await readActiveFailureCounts(client);
    expect(counts).toHaveLength(1);
    expect(counts[0]?.status).toBe('quarantined');
    expect(counts[0]?.count).toBe(3);
  });

  it('never reports a negative age, even under clock skew', async () => {
    const client = fakeClient([
      [
        'FROM qf_jarvis.projection_failure',
        [
          {
            projection_name: 'event-type-activity',
            projection_version: 1,
            age_seconds: '-30',
          },
        ],
      ],
    ]);
    const ages = await readOldestActiveFailureAges(client, NOW);
    expect(ages[0]?.ageSeconds).toBe(0);
  });

  it('reads checkpoint lag as a non-negative bigint', async () => {
    const client = fakeClient([
      [
        'FROM qf_jarvis.projection_checkpoint',
        [{ projection_name: 'event-type-activity', projection_version: 1, lag_positions: '17' }],
      ],
    ]);
    const lags = await readProjectionCheckpointLags(client);
    expect(lags[0]?.lagPositions).toBe(17n);
  });

  it('assembles a whole snapshot', async () => {
    const client = fakeClient([
      ['FROM qf_jarvis.projection_checkpoint', []],
      ['FROM qf_jarvis.projection_failure', []],
    ]);
    await expect(readProjectionHealthSnapshot(client, NOW)).resolves.toEqual(EMPTY_SNAPSHOT);
  });
});

describe('the health decision', () => {
  it('reports healthy when nothing is blocked and no failure is active', () => {
    const report = evaluateProjectionHealth(EMPTY_SNAPSHOT);
    expect(report.status).toBe('healthy');
    expect(report.blockedCount).toBe(0);
  });

  it('DEGRADES on a blocked projection but leaves liveness, readiness and deployment untouched', () => {
    const report = evaluateProjectionHealth({
      ...EMPTY_SNAPSHOT,
      blocked: [
        {
          projectionName: 'event-type-activity',
          projectionVersion: 1,
          blockedPosition: 42n,
          lastSafeErrorCode: 'projection-handler-failed',
          failedAttemptCount: 5,
        },
      ],
    });
    expect(report.status).toBe('degraded');
    expect(report.blockedCount).toBe(1);
    // The whole point: a contained halt must not become a process-wide outage.
    expect(report.processLive).toBe(true);
    expect(report.processReady).toBe(true);
    expect(report.deploymentHealthy).toBe(true);
  });

  it('degrades on active failures even when no checkpoint is blocked', () => {
    const report = evaluateProjectionHealth({
      ...EMPTY_SNAPSHOT,
      activeFailures: [
        {
          projectionName: 'event-type-activity',
          projectionVersion: 1,
          status: 'quarantined',
          count: 2,
        },
      ],
    });
    expect(report.status).toBe('degraded');
    expect(report.activeFailureCount).toBe(2);
    expect(report.processLive).toBe(true);
  });
});

describe('derived gauges', () => {
  it('projects a snapshot onto the four derived gauges', () => {
    const metrics = createProjectionMetricsRegistry();
    applyProjectionHealthToMetrics(metrics, {
      blocked: [
        {
          projectionName: 'event-type-activity',
          projectionVersion: 1,
          blockedPosition: 42n,
          lastSafeErrorCode: 'projection-handler-failed',
          failedAttemptCount: 5,
        },
      ],
      activeFailures: [
        { projectionName: 'event-type-activity', projectionVersion: 1, status: 'open', count: 1 },
      ],
      oldestActiveFailureAges: [
        { projectionName: 'event-type-activity', projectionVersion: 1, ageSeconds: 3600 },
      ],
      lags: [{ projectionName: 'event-type-activity', projectionVersion: 1, lagPositions: 17n }],
    });
    const byName = new Map(metrics.snapshot().map((entry) => [entry.name, entry.value]));
    expect(byName.get('projection_blocked_checkpoints')).toBe(1);
    expect(byName.get('projection_active_failures')).toBe(1);
    expect(byName.get('projection_oldest_active_failure_age_seconds')).toBe(3600);
    expect(byName.get('projection_checkpoint_lag_positions')).toBe(17);
    expect(metrics.rejectedSamples()).toBe(0);
  });

  it('CLEARS a blocked series once the projection is no longer blocked', () => {
    const metrics = createProjectionMetricsRegistry();
    applyProjectionHealthToMetrics(metrics, {
      ...EMPTY_SNAPSHOT,
      blocked: [
        {
          projectionName: 'event-type-activity',
          projectionVersion: 1,
          blockedPosition: 42n,
          lastSafeErrorCode: 'projection-handler-failed',
          failedAttemptCount: 5,
        },
      ],
    });
    expect(
      metrics.snapshot().filter((e) => e.name === 'projection_blocked_checkpoints'),
    ).toHaveLength(1);

    // Incident resolved. A stale `1` would keep the critical alert firing forever.
    applyProjectionHealthToMetrics(metrics, EMPTY_SNAPSHOT);
    expect(
      metrics.snapshot().filter((e) => e.name === 'projection_blocked_checkpoints'),
    ).toHaveLength(0);
  });

  it('rebuilds correctly on a fresh registry — the restart case', () => {
    const restarted = createProjectionMetricsRegistry();
    expect(restarted.snapshot()).toHaveLength(0);
    applyProjectionHealthToMetrics(restarted, {
      ...EMPTY_SNAPSHOT,
      lags: [{ projectionName: 'event-type-activity', projectionVersion: 1, lagPositions: 5n }],
    });
    expect(restarted.snapshot()).toHaveLength(1);
  });
});

describe('the startup schema probe', () => {
  it('requires every projection-failure relation', () => {
    expect([...REQUIRED_PROJECTION_FAILURE_RELATIONS]).toContain('projection_failure');
    expect([...REQUIRED_PROJECTION_FAILURE_RELATIONS]).toContain('projection_failure_action');
    expect([...REQUIRED_PROJECTION_FAILURE_RELATIONS]).toContain('projection_replay_authorization');
    expect([...REQUIRED_PROJECTION_FAILURE_RELATIONS]).toContain('projection_replay_attempt');
  });

  it('reports present when every relation exists', async () => {
    const client = fakeClient([
      [
        'pg_catalog.pg_class',
        REQUIRED_PROJECTION_FAILURE_RELATIONS.map((relname) => ({ relname })),
      ],
    ]);
    const probe = await probeProjectionFailureSchema(client);
    expect(probe.present).toBe(true);
    expect(probe.missing).toHaveLength(0);
  });

  it('names exactly what is missing when the migrations are behind', async () => {
    const client = fakeClient([
      [
        'pg_catalog.pg_class',
        [{ relname: 'projection_checkpoint' }, { relname: 'projection_attempt' }],
      ],
    ]);
    const probe = await probeProjectionFailureSchema(client);
    expect(probe.present).toBe(false);
    expect(probe.missing).toContain('projection_failure');
    expect(probe.missing).toContain('projection_replay_attempt');
  });
});

/**
 * QFJ-P03.07G — derived projection health against real PostgreSQL 17 (migrations 0001–0006).
 *
 * The unit tests prove the SHAPE of the health readers against a scripted client. This file proves the
 * QUERIES themselves: that the column names, the active-failure predicate, the position-map join, and
 * the catalog probe are all correct against the schema as actually migrated. A health reader that
 * compiles and returns plausible objects from a fake is worth very little; the failure modes that
 * matter — a renamed column, a predicate that stopped matching the partial index, a join through the
 * wrong ordering authority — only appear against a real database.
 *
 * It additionally proves the RESTART property that motivates the derived/process-local split: a fresh
 * metrics registry, standing in for a restarted worker, rebuilds the correct blocked set on its first
 * refresh, because state gauges are read rather than counted.
 *
 * Loopback-guarded harness. Synthetic fixtures only. No managed database, no live data.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
} from '../observability/projection-health.js';
import { createProjectionMetricsRegistry } from '../observability/projection-metrics.js';
import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import {
  createCheckpointIfAbsent,
  recordCheckpointBlocked,
  recordCheckpointRetryPending,
} from '../projections/checkpoint-store.js';
import { toCanonicalInstant } from '../projections/projection-definition.js';
import { toProjectionName } from '../projections/projection-name.js';

import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const NAME = toProjectionName('event-type-activity');
const OTHER = toProjectionName('daily-event-acceptance');
const VERSION = 1;
const NOW_DATE = new Date('2026-07-24T10:00:00.000Z');
const NOW = toCanonicalInstant(NOW_DATE);

let pool: DatabasePool;

/**
 * Store one synthetic event through the real event store, which fires the allocator trigger and so
 * allocates the next gap-free projection position — the same path production ingestion takes.
 */
function syntheticEvent(): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType: 'qf.recommendation.created',
    eventVersion: 2,
    source: 'quickfurno-core',
    subjectType: 'client',
    subjectId: 'CORE-CLIENT-00311',
    occurredAt: '2026-07-11T09:00:00Z',
    emittedAt: '2026-07-11T09:00:05Z',
    correlationId: randomUUID(),
    causationEventId: null,
    payload: { synthetic: true },
    semanticEventDigest: Buffer.alloc(32, 0xa1),
    bodyDigest: Buffer.alloc(32, 0xb2),
    signatureAlgorithm: 'ed25519',
    signatureKeyId: 'test-qf-core-2026-07',
    signatureSignedAt: '2026-07-11T09:00:06Z',
    signature: Buffer.alloc(64, 0xc3),
  };
}

async function seedEvent(): Promise<void> {
  await storeValidatedEvent(pool, syntheticEvent());
}

/**
 * Create one failure aggregate at `position`, `ageSeconds` old.
 *
 * A `resolved` row must carry BOTH a resolution time and the successful attempt reference — the
 * `projection_failure_resolved_shape` CHECK makes "resolved" and "has a resolution" the same
 * proposition, so a resolved row without them is rejected by the database.
 */
async function seedFailure(
  projectionName: string,
  position: number,
  status: string,
  ageSeconds: number,
): Promise<void> {
  const createdAt = new Date(NOW_DATE.getTime() - ageSeconds * 1000);
  const resolvedAt = status === 'resolved' ? createdAt : null;
  const resolvedAttemptId = status === 'resolved' ? randomUUID() : null;
  await withClient(pool, async (client) => {
    await client.query(
      `INSERT INTO qf_jarvis.projection_failure
         (failure_id, projection_name, projection_version, projection_position,
          event_storage_sequence, category, safe_error_code, status, generation,
          automatic_attempt_count, resolved_at, resolved_attempt_id,
          first_failed_at, last_failed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4, 'DETERMINISTIC_HANDLER_FAILURE', 'projection-handler-failed',
               $5, 0, 5, $6, $7, $8, $8, $8, $8)`,
      [
        randomUUID(),
        projectionName,
        VERSION,
        position,
        status,
        resolvedAt,
        resolvedAttemptId,
        createdAt,
      ],
    );
  });
}

beforeAll(async () => {
  pool = createTestPool({ applicationName: 'qf-jarvis-health-integration' });
  await resetTestDatabase(pool);
  await runMigrations(pool, defaultMigrationsDirectory());
}, 120_000);

afterAll(async () => {
  await closeTestPool(pool);
});

describe('the startup schema probe against the real catalog', () => {
  it('finds every required relation after migrations 0001-0006', async () => {
    const probe = await withClient(pool, (client) => probeProjectionFailureSchema(client));
    expect(probe.present).toBe(true);
    expect(probe.missing).toHaveLength(0);
  });

  it('names all seven relations it requires, and they all exist', async () => {
    const found = await withClient(pool, async (client) => {
      const result = await client.query<{ relname: string }>(
        `SELECT c.relname
           FROM pg_catalog.pg_class AS c
           JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          WHERE n.nspname = 'qf_jarvis' AND c.relkind = 'r'`,
      );
      return new Set(result.rows.map((row) => row.relname));
    });
    for (const relation of REQUIRED_PROJECTION_FAILURE_RELATIONS) {
      expect(found.has(relation)).toBe(true);
    }
  });
});

describe('derived health against real data', () => {
  it('reports nothing on a freshly migrated database', async () => {
    const snapshot = await withClient(pool, (client) => readProjectionHealthSnapshot(client, NOW));
    expect(snapshot.blocked).toHaveLength(0);
    expect(snapshot.activeFailures).toHaveLength(0);
    expect(evaluateProjectionHealth(snapshot).status).toBe('healthy');
  });

  it('reads a blocked checkpoint, its position, and its lag', async () => {
    await seedEvent();
    await seedEvent();
    // Walk the real bounded-retry path: attempts 1-4 leave the checkpoint active, and only the fifth
    // may block it. `recordCheckpointBlocked` guards on `failed_attempt_count = 4`, so a checkpoint
    // cannot be blocked out of nowhere — which is exactly the invariant being relied on here.
    await withClient(pool, async (client) => {
      await createCheckpointIfAbsent(client, { name: NAME, version: VERSION, now: NOW_DATE });
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        await recordCheckpointRetryPending(client, {
          name: NAME,
          version: VERSION,
          failedEventPosition: 1n,
          failedAttemptCount: attempt,
          safeErrorCode: 'projection-handler-failed',
          nextAttemptAt: NOW_DATE,
          now: NOW_DATE,
        });
      }
      await recordCheckpointBlocked(client, {
        name: NAME,
        version: VERSION,
        blockedPosition: 1n,
        safeErrorCode: 'projection-handler-failed',
        now: NOW_DATE,
      });
    });

    const blocked = await withClient(pool, (client) => readBlockedProjections(client));
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.projectionName).toBe(NAME);
    expect(blocked[0]?.blockedPosition).toBe(1n);
    expect(blocked[0]?.failedAttemptCount).toBe(5);

    // The ceiling is MAX(position) over the append-only position map — the same gap-free ordering
    // authority the runner reads through, never `event.sequence`.
    const lags = await withClient(pool, (client) => readProjectionCheckpointLags(client));
    const lag = lags.find((row) => row.projectionName === NAME);
    expect(lag?.lagPositions).toBe(2n);
  });

  it('counts non-terminal failures by status and EXCLUDES terminal ones', async () => {
    await seedFailure(NAME, 1, 'open', 3600);
    await seedFailure(OTHER, 1, 'quarantined', 60);
    // Terminal statuses must not appear: this is exactly the predicate of the partial unique index
    // projection_failure_active_unique, so a drift between the two would show up here.
    await seedFailure(OTHER, 2, 'resolved', 10);
    await seedFailure(OTHER, 3, 'superseded', 10);
    await seedFailure(OTHER, 4, 'retired', 10);

    const counts = await withClient(pool, (client) => readActiveFailureCounts(client));
    const statuses = counts.map((row) => row.status).sort();
    expect(statuses).toEqual(['open', 'quarantined']);
    expect(counts.reduce((total, row) => total + row.count, 0)).toBe(2);
  });

  it('measures the oldest active failure age against the INJECTED instant', async () => {
    const ages = await withClient(pool, (client) => readOldestActiveFailureAges(client, NOW));
    const age = ages.find((row) => row.projectionName === NAME);
    // Seeded one hour before the injected `now`, and measured against it rather than database time.
    expect(age?.ageSeconds).toBeCloseTo(3600, 0);
  });

  it('degrades health while anything is blocked or active', async () => {
    const snapshot = await withClient(pool, (client) => readProjectionHealthSnapshot(client, NOW));
    const report = evaluateProjectionHealth(snapshot);
    expect(report.status).toBe('degraded');
    expect(report.blockedCount).toBe(1);
    expect(report.activeFailureCount).toBe(2);
    // Containment: a blocked projection never becomes a process-wide or deployment-wide failure.
    expect(report.processLive).toBe(true);
    expect(report.processReady).toBe(true);
    expect(report.deploymentHealthy).toBe(true);
  });

  it('a FRESH registry rebuilds the correct gauges — the restart property', async () => {
    // Process-local counters reset on restart; derived gauges are read back, so a restarted worker
    // reports the true blocked set on its first refresh rather than an empty one.
    const restarted = createProjectionMetricsRegistry();
    expect(restarted.snapshot()).toHaveLength(0);

    const snapshot = await withClient(pool, (client) => readProjectionHealthSnapshot(client, NOW));
    applyProjectionHealthToMetrics(restarted, snapshot);

    const blockedSeries = restarted
      .snapshot()
      .filter((entry) => entry.name === 'projection_blocked_checkpoints');
    expect(blockedSeries).toHaveLength(1);
    expect(blockedSeries[0]?.labels['projection_name']).toBe(NAME);
    expect(restarted.rejectedSamples()).toBe(0);
  });

  it('CLEARS the blocked gauge once the block is resolved', async () => {
    const metrics = createProjectionMetricsRegistry();
    applyProjectionHealthToMetrics(
      metrics,
      await withClient(pool, (client) => readProjectionHealthSnapshot(client, NOW)),
    );
    expect(
      metrics.snapshot().filter((entry) => entry.name === 'projection_blocked_checkpoints'),
    ).toHaveLength(1);

    await withClient(pool, async (client) => {
      await client.query(
        `UPDATE qf_jarvis.projection_checkpoint
            SET status = 'active', blocked_position = NULL, failed_attempt_count = 0,
                last_safe_error_code = NULL
          WHERE projection_name = $1 AND projection_version = $2`,
        [NAME, VERSION],
      );
    });

    applyProjectionHealthToMetrics(
      metrics,
      await withClient(pool, (client) => readProjectionHealthSnapshot(client, NOW)),
    );
    // A stale `1` here would keep the critical blocked-projection alert firing after the incident
    // closed, which is why the derived gauges are REPLACED rather than set.
    expect(
      metrics.snapshot().filter((entry) => entry.name === 'projection_blocked_checkpoints'),
    ).toHaveLength(0);
  });
});

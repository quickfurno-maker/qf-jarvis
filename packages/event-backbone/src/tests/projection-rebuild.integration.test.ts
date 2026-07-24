/**
 * QFJ-P03.08 — the bounded rebuild-determinism and erasure PROOF against real PostgreSQL 17 (ADR-0043).
 *
 * Core acceptance evidence, which only a real database can establish:
 *   - the LIVE read-model digest equals the REBUILT digest for both production metadata read models
 *     (destroy-and-rebuild, ADR-0022 §7), and rebuilding twice is identical;
 *   - a rollback-contained rebuild leaves the LIVE read model, the checkpoint, the attempt log, and the
 *     failure aggregate UNCHANGED (isolation + mid-rebuild abort safety);
 *   - a committed destroy-and-rebuild creates NO checkpoint/attempt/failure rows of its own;
 *   - a synthetic tombstone (erasure) event's effect SURVIVES a full rebuild, on an ephemeral test-only
 *     target — with no subject, no payload, no real personal data (subject-keyed erasure is P03.09);
 *   - `horizon = 0` is a successful no-op.
 *
 * Loopback-guarded harness; it FAILS (never skips) without DATABASE_URL, per repository CI policy.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultMigrationsDirectory,
  withClient,
  withTransaction,
  type DatabasePool,
} from '../index.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME } from '../projections/handlers/daily-event-acceptance.js';
import {
  EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
  EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
} from '../projections/handlers/event-type-activity.js';
import { createProductionProjectionRegistry } from '../projections/production-registry.js';
import {
  defineProjection,
  toCanonicalInstant,
  type CanonicalInstant,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projections/projection-definition.js';
import {
  DAILY_EVENT_ACCEPTANCE_DIGEST_SPEC,
  digestReadModel,
  EVENT_TYPE_ACTIVITY_DIGEST_SPEC,
  type ReadModelDigestSpec,
} from '../projections/projection-rebuild-digest.js';
import { captureRebuildHorizon, rebuildProjection } from '../projections/projection-rebuild.js';
import { runProjectionWorker } from '../projections/projection-worker.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';
import type { DatabaseClient } from '../persistence/pool.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-p0308-rebuild' });

function makeRecord(eventType: string): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    source: 'quickfurno-core',
    subjectType: 'client',
    subjectId: 'CORE-CLIENT-1',
    occurredAt: '2026-07-11T09:00:00Z',
    emittedAt: '2026-07-11T09:00:05Z',
    correlationId: randomUUID(),
    causationEventId: null,
    payload: { synthetic: true },
    semanticEventDigest: Buffer.alloc(32, 0xa1),
    bodyDigest: Buffer.alloc(32, 0xb2),
    signatureAlgorithm: 'ed25519',
    signatureKeyId: 'test-key',
    signatureSignedAt: '2026-07-11T09:00:06Z',
    signature: Buffer.alloc(64, 0xc3),
  };
}

async function seed(eventTypes: readonly string[]): Promise<void> {
  for (const eventType of eventTypes) {
    await storeValidatedEvent(admin, makeRecord(eventType));
  }
}

function productionDefinition(name: string): ProjectionDefinition {
  const definition = createProductionProjectionRegistry().get(name);
  if (definition === undefined) {
    throw new Error(`production registry is missing ${name}`);
  }
  return definition;
}

// A fixed injected worker clock; unrelated to the event-derived read-model timestamps.
const FIXED_NOW: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
const fixedNow = (): CanonicalInstant => FIXED_NOW;

async function driveLive(): Promise<void> {
  await runProjectionWorker({
    pool: admin,
    registry: createProductionProjectionRegistry(),
    now: fixedNow,
    sleep: () => Promise.resolve(),
    maxCycles: 30,
  });
}

async function countRows(
  client: DatabaseClient,
  table: string,
  where: string,
  params: unknown[],
): Promise<number> {
  const result = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${table} WHERE ${where}`,
    params,
  );
  return Number.parseInt(result.rows[0]?.n ?? '0', 10);
}

async function checkpointLast(
  client: DatabaseClient,
  name: string,
  version: number,
): Promise<string | null> {
  const result = await client.query<{ last_position: string }>(
    `SELECT last_position FROM qf_jarvis.projection_checkpoint WHERE projection_name = $1 AND projection_version = $2`,
    [name, version],
  );
  return result.rows[0]?.last_position ?? null;
}

beforeEach(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeTestPool(admin);
});

describe('QFJ-P03.08 — live/rebuild digest equality (production read models)', () => {
  it('rebuilds both read models to a digest identical to the live result, and is repeatable', async () => {
    await seed(['qf.recommendation.created', 'qf.quote.issued', 'qf.recommendation.created']);
    await driveLive();

    const specs: { spec: ReadModelDigestSpec; definition: ProjectionDefinition }[] = [
      {
        spec: EVENT_TYPE_ACTIVITY_DIGEST_SPEC,
        definition: productionDefinition(EVENT_TYPE_ACTIVITY_PROJECTION_NAME),
      },
      {
        spec: DAILY_EVENT_ACCEPTANCE_DIGEST_SPEC,
        definition: productionDefinition(DAILY_EVENT_ACCEPTANCE_PROJECTION_NAME),
      },
    ];

    for (const { spec, definition } of specs) {
      const live = await withClient(admin, (client) => digestReadModel(client, spec));

      // Destroy-and-rebuild in a COMMITTED transaction; digest the rebuilt state.
      const rebuilt = await withTransaction(admin, async (client) => {
        const horizon = await captureRebuildHorizon(client);
        await client.query(`DELETE FROM ${spec.table}`);
        const result = await rebuildProjection({ client, definition, horizon });
        expect(result.appliedPositions).toBe(horizon);
        return digestReadModel(client, spec);
      });

      expect(rebuilt).toBe(live);

      // A second rebuild is byte-identical.
      const again = await withTransaction(admin, async (client) => {
        const horizon = await captureRebuildHorizon(client);
        await client.query(`DELETE FROM ${spec.table}`);
        await rebuildProjection({ client, definition, horizon });
        return digestReadModel(client, spec);
      });
      expect(again).toBe(live);
    }
  });

  it('is a successful no-op at horizon 0 (no events)', async () => {
    const definition = productionDefinition(EVENT_TYPE_ACTIVITY_PROJECTION_NAME);
    const result = await withClient(admin, async (client) => {
      const horizon = await captureRebuildHorizon(client);
      return rebuildProjection({ client, definition, horizon });
    });
    expect(result.horizon).toBe(0n);
    expect(result.appliedPositions).toBe(0n);
  });
});

describe('QFJ-P03.08 — rebuild isolation from live checkpoint and P03.07 state', () => {
  it('a rollback-contained rebuild leaves the live read model, checkpoint, attempts, and failures unchanged', async () => {
    await seed(['qf.recommendation.created', 'qf.quote.issued']);
    await driveLive();

    const spec = EVENT_TYPE_ACTIVITY_DIGEST_SPEC;
    const definition = productionDefinition(EVENT_TYPE_ACTIVITY_PROJECTION_NAME);

    const before = await withClient(admin, async (client) => ({
      digest: await digestReadModel(client, spec),
      checkpoint: await checkpointLast(
        client,
        EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
        EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
      ),
      attempts: await countRows(client, 'qf_jarvis.projection_attempt', 'projection_name = $1', [
        EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
      ]),
      failures: await countRows(client, 'qf_jarvis.projection_failure', 'true', []),
    }));

    // Run a full destroy-and-rebuild, then FORCE a rollback by throwing a sentinel.
    class Rollback extends Error {}
    let rebuiltDigest = '';
    await expect(
      withTransaction(admin, async (client) => {
        const horizon = await captureRebuildHorizon(client);
        await client.query(`DELETE FROM ${spec.table}`);
        await rebuildProjection({ client, definition, horizon });
        rebuiltDigest = await digestReadModel(client, spec);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    // The rebuild reproduced the live digest before the rollback...
    expect(rebuiltDigest).toBe(before.digest);

    // ...and after rollback the LIVE state and all P03.07 tables are byte-for-byte as they were.
    const after = await withClient(admin, async (client) => ({
      digest: await digestReadModel(client, spec),
      checkpoint: await checkpointLast(
        client,
        EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
        EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
      ),
      attempts: await countRows(client, 'qf_jarvis.projection_attempt', 'projection_name = $1', [
        EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
      ]),
      failures: await countRows(client, 'qf_jarvis.projection_failure', 'true', []),
    }));

    expect(after).toEqual(before);
  });

  it('a committed rebuild creates no checkpoint/attempt/failure rows of its own', async () => {
    await seed(['qf.recommendation.created', 'qf.quote.issued']);
    await driveLive();

    const spec = EVENT_TYPE_ACTIVITY_DIGEST_SPEC;
    const definition = productionDefinition(EVENT_TYPE_ACTIVITY_PROJECTION_NAME);

    const before = await withClient(admin, async (client) => ({
      checkpoint: await checkpointLast(
        client,
        EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
        EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
      ),
      attempts: await countRows(client, 'qf_jarvis.projection_attempt', 'true', []),
      failures: await countRows(client, 'qf_jarvis.projection_failure', 'true', []),
    }));

    await withTransaction(admin, async (client) => {
      const horizon = await captureRebuildHorizon(client);
      await client.query(`DELETE FROM ${spec.table}`);
      await rebuildProjection({ client, definition, horizon });
    });

    const after = await withClient(admin, async (client) => ({
      checkpoint: await checkpointLast(
        client,
        EVENT_TYPE_ACTIVITY_PROJECTION_NAME,
        EVENT_TYPE_ACTIVITY_PROJECTION_VERSION,
      ),
      attempts: await countRows(client, 'qf_jarvis.projection_attempt', 'true', []),
      failures: await countRows(client, 'qf_jarvis.projection_failure', 'true', []),
    }));

    expect(after).toEqual(before);
  });
});

describe('QFJ-P03.08 — erasure survives rebuild (synthetic, ephemeral target)', () => {
  const ERASURE_EVENT_TYPE = 'qf.privacy.erasure-recorded';
  const SYNTHETIC_TABLE = 'qf_jarvis.rm_p0308_synthetic_activity';

  // A domain-neutral synthetic reducer: it counts events per type into an ephemeral test-only table,
  // and treats a tombstone event as CLEARING all derived state. No subject, no payload — the effect is
  // keyed only on the metadata event type. This proves the *erasure event's effect* survives rebuild;
  // the subject-keyed rm_subject_activity proof is QFJ-P03.09 (ADR-0043 §I).
  const syntheticDefinition: ProjectionDefinition = defineProjection({
    name: 'p0308-synthetic-erasure',
    version: 1,
    apply: async (client: DatabaseClient, event: ProjectionEvent): Promise<void> => {
      if (event.eventType === ERASURE_EVENT_TYPE) {
        await client.query(`DELETE FROM ${SYNTHETIC_TABLE}`);
        return;
      }
      await client.query(
        `INSERT INTO ${SYNTHETIC_TABLE} AS rm (event_type, event_count, last_event_position)
         VALUES ($1, 1, $2::bigint)
         ON CONFLICT (event_type) DO UPDATE SET
           event_count = rm.event_count + 1,
           last_event_position = EXCLUDED.last_event_position
         WHERE EXCLUDED.last_event_position > rm.last_event_position`,
        [event.eventType, event.position.toString()],
      );
    },
  });

  const syntheticSpec: ReadModelDigestSpec = {
    table: SYNTHETIC_TABLE,
    columns: [{ name: 'event_type' }, { name: 'event_count' }, { name: 'last_event_position' }],
    orderBy: ['event_type'],
  };

  it('an erasure event replayed during rebuild reproduces the identical erased final state', async () => {
    // Seed: two events, an erasure (tombstone), then two more events after the erasure.
    await seed([
      'qf.recommendation.created',
      'qf.recommendation.created',
      ERASURE_EVENT_TYPE,
      'qf.quote.issued',
      'qf.quote.issued',
    ]);

    await withTransaction(admin, async (client) => {
      // Ephemeral, test-only target (Model 2) — created and dropped inside this transaction.
      await client.query(
        `CREATE TABLE ${SYNTHETIC_TABLE} (
           event_type          TEXT   PRIMARY KEY,
           event_count         BIGINT NOT NULL,
           last_event_position BIGINT NOT NULL
         )`,
      );

      const horizon = await captureRebuildHorizon(client);

      // "Live": apply every position in order once via the pure reducer.
      const live = await rebuildProjection({ client, definition: syntheticDefinition, horizon });
      expect(live.appliedPositions).toBe(horizon);
      const liveDigest = await digestReadModel(client, syntheticSpec);

      // The erasure cleared the pre-erasure rows; only the two post-erasure events remain.
      const remaining = await client.query<{ event_type: string; event_count: string }>(
        `SELECT event_type, event_count FROM ${SYNTHETIC_TABLE} ORDER BY event_type`,
      );
      expect(remaining.rows).toEqual([{ event_type: 'qf.quote.issued', event_count: '2' }]);

      // Destroy and rebuild from position 1: the erasure is replayed in order → identical erased state.
      await client.query(`DELETE FROM ${SYNTHETIC_TABLE}`);
      const rebuilt = await rebuildProjection({ client, definition: syntheticDefinition, horizon });
      expect(rebuilt.appliedPositions).toBe(horizon);
      const rebuiltDigest = await digestReadModel(client, syntheticSpec);

      expect(rebuiltDigest).toBe(liveDigest);

      await client.query(`DROP TABLE ${SYNTHETIC_TABLE}`);
    });
  });
});

/**
 * QFJ-P03.09 — the subject-activity projection against real PostgreSQL 17 (ADR-0044).
 *
 * Proves, on the actual schema (migration 0007): ordinary activity accumulation (count, first/last
 * position and instant, last event type/version); subject_type namespacing; a permanent minimal
 * tombstone on qf.privacy.erasure-recorded (before and after activity; repeated erasure preserves the
 * first; post-erasure ordinary events never reactivate); a second subject is unaffected; full
 * destroy-and-rebuild digest equality INCLUDING erased state (pre-erasure activity never resurrects);
 * and the least-privilege grant (projection_runtime can read the subject columns but NOT the payload).
 *
 * Loopback-guarded; FAILS (never skips) without DATABASE_URL, per repository CI policy.
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
import type { DatabaseClient } from '../persistence/pool.js';
import {
  subjectActivityProjection,
  SUBJECT_ACTIVITY_PROJECTION_NAME,
  SUBJECT_ACTIVITY_PROJECTION_VERSION,
} from '../projections/handlers/subject-activity.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { captureRebuildHorizon, rebuildProjection } from '../projections/projection-rebuild.js';
import {
  digestReadModel,
  SUBJECT_ACTIVITY_DIGEST_SPEC,
} from '../projections/projection-rebuild-digest.js';
import { runProjectionWorker } from '../projections/projection-worker.js';
import {
  closeTestPool,
  createProjectionPool,
  createTestPool,
  ensureProjectionRoleExists,
  resetTestDatabase,
} from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-p0309-subject' });

const ERASURE = 'qf.privacy.erasure-recorded';

function record(eventType: string, subjectType: string, subjectId: string): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType,
    eventVersion: 1,
    source: 'quickfurno-core',
    subjectType,
    subjectId,
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

async function seed(events: readonly EventPersistenceRecord[]): Promise<void> {
  for (const event of events) {
    await storeValidatedEvent(admin, event);
  }
}

const fixedNow: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');

async function driveSubjectActivity(): Promise<void> {
  await runProjectionWorker({
    pool: admin,
    registry: createProjectionRegistry([subjectActivityProjection]),
    now: () => fixedNow,
    sleep: () => Promise.resolve(),
    maxCycles: 50,
  });
}

interface SubjectRow {
  readonly subject_type: string;
  readonly subject_id: string;
  readonly activity_event_count: string;
  readonly first_activity_position: string | null;
  readonly last_activity_position: string | null;
  readonly last_activity_event_type: string | null;
  readonly last_activity_event_version: number | null;
  readonly erased: boolean;
  readonly erased_at_position: string | null;
}

async function readRow(subjectType: string, subjectId: string): Promise<SubjectRow | null> {
  return withClient(admin, async (client) => {
    const result = await client.query<SubjectRow>(
      `SELECT subject_type, subject_id, activity_event_count, first_activity_position,
              last_activity_position, last_activity_event_type, last_activity_event_version,
              erased, erased_at_position
         FROM qf_jarvis.rm_subject_activity
        WHERE subject_type = $1 AND subject_id = $2`,
      [subjectType, subjectId],
    );
    return result.rows[0] ?? null;
  });
}

beforeEach(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeTestPool(admin);
});

describe('QFJ-P03.09 — ordinary activity', () => {
  it('accumulates count and advances last fields; first fields stay stable; namespaces by subject_type', async () => {
    await seed([
      record('qf.recommendation.created', 'client', 'A'),
      record('qf.quote.issued', 'client', 'A'),
      record('qf.recommendation.created', 'vendor', 'A'), // same id, different type => distinct row
      record('qf.recommendation.created', 'client', 'B'),
    ]);
    await driveSubjectActivity();

    const clientA = await readRow('client', 'A');
    expect(clientA?.activity_event_count).toBe('2');
    expect(clientA?.first_activity_position).toBe('1');
    expect(clientA?.last_activity_position).toBe('2');
    expect(clientA?.last_activity_event_type).toBe('qf.quote.issued');
    expect(clientA?.erased).toBe(false);

    expect((await readRow('vendor', 'A'))?.activity_event_count).toBe('1');
    expect((await readRow('client', 'B'))?.activity_event_count).toBe('1');
  });
});

describe('QFJ-P03.09 — permanent tombstone', () => {
  it('erasure after activity clears activity and is permanent (no reactivation)', async () => {
    await seed([
      record('qf.recommendation.created', 'client', 'A'),
      record('qf.quote.issued', 'client', 'A'),
      record(ERASURE, 'client', 'A'), // position 3 erases A
      record('qf.recommendation.created', 'client', 'A'), // position 4 must NOT reactivate
    ]);
    await driveSubjectActivity();

    const a = await readRow('client', 'A');
    expect(a?.erased).toBe(true);
    expect(a?.activity_event_count).toBe('0');
    expect(a?.first_activity_position).toBeNull();
    expect(a?.last_activity_position).toBeNull();
    expect(a?.last_activity_event_type).toBeNull();
    expect(a?.erased_at_position).toBe('3');
  });

  it('erasure before any activity creates a zero-count tombstone', async () => {
    await seed([
      record(ERASURE, 'client', 'C'), // erased with no prior activity
      record('qf.recommendation.created', 'client', 'C'), // ignored permanently
    ]);
    await driveSubjectActivity();

    const c = await readRow('client', 'C');
    expect(c?.erased).toBe(true);
    expect(c?.activity_event_count).toBe('0');
    expect(c?.erased_at_position).toBe('1');
  });

  it('a repeated erasure preserves the FIRST tombstone', async () => {
    await seed([
      record('qf.recommendation.created', 'client', 'D'),
      record(ERASURE, 'client', 'D'), // position 2: first tombstone
      record(ERASURE, 'client', 'D'), // position 3: idempotent
    ]);
    await driveSubjectActivity();

    const d = await readRow('client', 'D');
    expect(d?.erased).toBe(true);
    expect(d?.erased_at_position).toBe('2');
  });

  it('erasing one subject does not affect another', async () => {
    await seed([
      record('qf.recommendation.created', 'client', 'A'),
      record('qf.recommendation.created', 'client', 'B'),
      record(ERASURE, 'client', 'A'),
    ]);
    await driveSubjectActivity();

    expect((await readRow('client', 'A'))?.erased).toBe(true);
    const b = await readRow('client', 'B');
    expect(b?.erased).toBe(false);
    expect(b?.activity_event_count).toBe('1');
  });
});

describe('QFJ-P03.09 — rebuild determinism including erased state', () => {
  it('live digest equals a full destroy-and-rebuild digest; pre-erasure activity does not resurrect', async () => {
    await seed([
      record('qf.recommendation.created', 'client', 'A'),
      record('qf.quote.issued', 'client', 'A'),
      record(ERASURE, 'client', 'A'), // A becomes a permanent tombstone
      record('qf.recommendation.created', 'client', 'B'), // B stays active
      record('qf.recommendation.created', 'client', 'A'), // ignored (A erased)
    ]);
    await driveSubjectActivity();

    const live = await withClient(admin, (client) =>
      digestReadModel(client, SUBJECT_ACTIVITY_DIGEST_SPEC),
    );

    const rebuilt = await withTransaction(admin, async (client) => {
      const horizon = await captureRebuildHorizon(client);
      await client.query('DELETE FROM qf_jarvis.rm_subject_activity');
      const result = await rebuildProjection({
        client,
        definition: subjectActivityProjection,
        horizon,
      });
      expect(result.appliedPositions).toBe(horizon);
      return digestReadModel(client, SUBJECT_ACTIVITY_DIGEST_SPEC);
    });

    expect(rebuilt).toBe(live);

    // The rebuilt tombstone is intact — pre-erasure activity did not come back.
    const a = await readRow('client', 'A');
    expect(a?.erased).toBe(true);
    expect(a?.activity_event_count).toBe('0');
  });

  it('rebuild does not advance or mutate the live checkpoint', async () => {
    await seed([
      record('qf.recommendation.created', 'client', 'A'),
      record(ERASURE, 'client', 'A'),
    ]);
    await driveSubjectActivity();

    const before = await withClient(admin, (client) =>
      client
        .query<{ last_position: string }>(
          `SELECT last_position FROM qf_jarvis.projection_checkpoint WHERE projection_name = $1 AND projection_version = $2`,
          [SUBJECT_ACTIVITY_PROJECTION_NAME, SUBJECT_ACTIVITY_PROJECTION_VERSION],
        )
        .then((r) => r.rows[0]?.last_position ?? null),
    );

    class Rollback extends Error {}
    await expect(
      withTransaction(admin, async (client) => {
        const horizon = await captureRebuildHorizon(client);
        await client.query('DELETE FROM qf_jarvis.rm_subject_activity');
        await rebuildProjection({ client, definition: subjectActivityProjection, horizon });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    const after = await withClient(admin, (client) =>
      client
        .query<{ last_position: string }>(
          `SELECT last_position FROM qf_jarvis.projection_checkpoint WHERE projection_name = $1 AND projection_version = $2`,
          [SUBJECT_ACTIVITY_PROJECTION_NAME, SUBJECT_ACTIVITY_PROJECTION_VERSION],
        )
        .then((r) => r.rows[0]?.last_position ?? null),
    );
    expect(after).toBe(before);
  });
});

describe('QFJ-P03.09 — least-privilege grant', () => {
  it('projection_runtime can read the subject columns but NOT the payload', async () => {
    // Re-provision with the projection role present BEFORE migrating, so 0007's conditional grant applies.
    const password = `p0309_${randomUUID().replace(/-/g, '')}`;
    await resetTestDatabase(admin);
    await ensureProjectionRoleExists(admin, password);
    await runMigrations(admin, defaultMigrationsDirectory());
    await seed([record('qf.recommendation.created', 'client', 'GRANT-1')]);

    const projectionPool = createProjectionPool(password, 'qf-p0309-grant');
    try {
      // Granted: subject columns.
      const subject = await withClient(projectionPool, (client: DatabaseClient) =>
        client.query<{ subject_type: string }>(
          'SELECT subject_type, subject_id FROM qf_jarvis.event LIMIT 1',
        ),
      );
      expect(subject.rows[0]?.subject_type).toBe('client');

      // Denied: the payload column was never granted to this role.
      await expect(
        withClient(projectionPool, (client: DatabaseClient) =>
          client.query('SELECT payload FROM qf_jarvis.event LIMIT 1'),
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await closeTestPool(projectionPool);
    }
  });
});

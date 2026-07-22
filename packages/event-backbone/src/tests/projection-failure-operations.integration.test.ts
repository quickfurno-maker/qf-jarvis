/**
 * QFJ-P03.07E — failure inspection/quarantine operations against real PostgreSQL 17 (ADR-0040).
 *
 * Drives a genuine blocked failure through the runner (five deterministic failures → QFJ-P03.07D
 * establishment), then proves the operator operations: bounded inspection, action-history, acknowledge
 * and quarantine atomically transition status + append exactly one action while leaving the blocked
 * checkpoint/position/attempts untouched; idempotency; optimistic-concurrency; the divergence gate; and
 * that no replay authorization/attempt, checkpoint write, resolve, or skip ever occurs.
 *
 * Loopback-guarded harness; synthetic handlers only. Integration-gated (runs in CI).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defaultMigrationsDirectory, withClient, type DatabasePool } from '../index.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { createProjectionFailure } from '../projections/projection-failure-repository.js';
import type { ProjectionFailureId } from '../projections/projection-failure-persistence.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import { deterministicHandlerFailure } from '../projections/projection-failure-taxonomy.js';
import { createProjectionRegistry } from '../projections/projection-registry.js';
import { runProjectionOnce } from '../projections/projection-runner.js';
import type { ProjectionName } from '../projections/projection-name.js';
import {
  acknowledgeProjectionFailureOperation,
  inspectProjectionFailure,
  inspectProjectionFailureHistory,
  listProjectionFailuresForInspection,
  quarantineProjectionFailureOperation,
  type ProjectionFailureAuthorizer,
  type ProjectionFailureOperationContext,
} from '../projections/projection-failure-operations.js';
import { closeTestPool, createTestPool, resetTestDatabase } from './database-test-utils.js';

const admin: DatabasePool = createTestPool({ applicationName: 'qf-p03-07e-admin' });

const now: CanonicalInstant = toCanonicalInstant('2026-07-19T00:00:00.000Z');
function laterNow(ms: number): CanonicalInstant {
  return toCanonicalInstant(new Date(Date.parse(now) + ms));
}
const T0 = new Date('2026-07-22T00:00:00.000Z');

const ALLOW: ProjectionFailureAuthorizer = { authorize: () => true };
const INSPECT_ONLY: ProjectionFailureAuthorizer = {
  authorize: (r) => r.capability === 'projection-failure:inspect',
};

function ctx(actorType: ProjectionFailureOperationContext['actorType'] = 'failure-operator') {
  return { actorType, actorId: 'operator-1', correlationId: randomUUID() };
}

function makeRecord(overrides: Partial<EventPersistenceRecord> = {}): EventPersistenceRecord {
  return {
    eventId: randomUUID(),
    eventType: 'qf.recommendation.created',
    eventVersion: 2,
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
    ...overrides,
  };
}

async function seedEvents(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) await storeValidatedEvent(admin, makeRecord());
}

const failHandler = async (): Promise<void> => {
  await Promise.resolve();
  throw deterministicHandlerFailure('deterministic reducer refusal');
};

function registryOf(name: string) {
  return createProjectionRegistry([{ name, version: 1, apply: failHandler }]);
}

/** Drive five deterministic failures to establish one blocked failure; return its id + generation. */
async function blockFailure(name: string): Promise<{ failureId: ProjectionFailureId }> {
  const registry = registryOf(name);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await runProjectionOnce({
      pool: admin,
      registry,
      name,
      version: 1,
      now: laterNow(attempt * 600000),
    });
  }
  const failureId = await withClient(admin, async (c) => {
    const r = await c.query<{ failure_id: string }>(
      `SELECT failure_id FROM qf_jarvis.projection_failure
        WHERE projection_name = $1 AND projection_version = 1 AND status NOT IN ('resolved','superseded','retired')`,
      [name],
    );
    return r.rows[0]?.failure_id;
  });
  if (failureId === undefined) throw new Error('expected a blocked failure to exist');
  return { failureId: failureId as ProjectionFailureId };
}

async function checkpointOf(
  name: string,
): Promise<{ status: string; last: bigint; blocked: bigint | null } | null> {
  return withClient(admin, async (c) => {
    const r = await c.query<{
      status: string;
      last_position: string;
      blocked_position: string | null;
    }>(
      `SELECT status, last_position, blocked_position FROM qf_jarvis.projection_checkpoint
        WHERE projection_name = $1 AND projection_version = 1`,
      [name],
    );
    const row = r.rows[0];
    if (row === undefined) return null;
    return {
      status: row.status,
      last: BigInt(row.last_position),
      blocked: row.blocked_position === null ? null : BigInt(row.blocked_position),
    };
  });
}

async function actionTypes(failureId: string): Promise<string[]> {
  return withClient(admin, async (c) => {
    const r = await c.query<{ action_type: string }>(
      `SELECT action_type FROM qf_jarvis.projection_failure_action WHERE failure_id = $1 ORDER BY sequence`,
      [failureId],
    );
    return r.rows.map((row) => row.action_type);
  });
}

async function replayRowCounts(failureId: string): Promise<{ auth: number; attempt: number }> {
  return withClient(admin, async (c) => {
    const a = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM qf_jarvis.projection_replay_authorization WHERE failure_id = $1`,
      [failureId],
    );
    const t = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM qf_jarvis.projection_replay_attempt WHERE failure_id = $1`,
      [failureId],
    );
    return { auth: a.rows[0]?.n ?? -1, attempt: t.rows[0]?.n ?? -1 };
  });
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await runMigrations(admin, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeTestPool(admin);
});

// ---------------------------------------------------------------------------

describe('inspection over a genuine blocked failure', () => {
  it('lists, inspects, and reads the history of a blocked failure with the created action', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-inspect');

    const page = await listProjectionFailuresForInspection(
      admin,
      ALLOW,
      ctx('read-only-operator'),
      {
        activeOnly: true,
        pageSize: 50,
      },
    );
    expect(page.items.some((i) => i.failureId === failureId)).toBe(true);

    const detail = await inspectProjectionFailure(admin, ALLOW, ctx('read-only-operator'), {
      failureId,
    });
    expect(detail.status).toBe('open');
    expect(detail.category).toBe('DETERMINISTIC_HANDLER_FAILURE');
    expect(detail.checkpoint.status).toBe('blocked');
    expect(detail.checkpoint.blockedPosition).toBe(detail.projectionPosition);
    expect(detail.finalAttempt.attemptCount).toBe(5);
    expect(detail.divergences).toEqual([]);
    expect(detail.actionCount).toBe(1);

    const history = await inspectProjectionFailureHistory(admin, ALLOW, ctx('read-only-operator'), {
      failureId,
    });
    expect(history.map((a) => a.actionType)).toEqual(['created']);
  });

  it('exposes no event payload or raw exception data in the detail model', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-nopayload');
    const detail = await inspectProjectionFailure(admin, ALLOW, ctx(), { failureId });
    const serialized = JSON.stringify(detail, (_k: string, v: unknown) =>
      typeof v === 'bigint' ? v.toString() : v,
    );
    expect(serialized).not.toContain('synthetic'); // the event payload flag
    expect(serialized).not.toContain('CORE-CLIENT-1'); // the subject id
    expect(serialized.toLowerCase()).not.toContain('stack');
  });
});

describe('acknowledge and quarantine preserve the checkpoint', () => {
  it('acknowledge atomically transitions and appends one action; checkpoint unchanged', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-ack');
    const cpBefore = await checkpointOf('e-ack');

    const result = await acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 0,
      reason: 'reviewing',
      now: T0,
    });
    expect(result.status).toBe('acknowledged');
    expect(result.generation).toBe(1);
    expect(result.idempotent).toBe(false);
    expect(await actionTypes(failureId)).toEqual(['created', 'acknowledged']);
    expect(await checkpointOf('e-ack')).toEqual(cpBefore); // checkpoint untouched
  });

  it('quarantine (open→quarantined) preserves the blocked checkpoint, position, and attempts', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-quar');
    const cpBefore = await checkpointOf('e-quar');

    const result = await quarantineProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 0,
      reason: 'isolating for investigation',
      now: T0,
    });
    expect(result.status).toBe('quarantined');
    expect(await actionTypes(failureId)).toEqual(['created', 'quarantined']);

    const cpAfter = await checkpointOf('e-quar');
    expect(cpAfter).toEqual(cpBefore);
    expect(cpAfter?.status).toBe('blocked');
    expect(cpAfter?.last).toBe(0n);
    // No replay authorization or attempt was created.
    expect(await replayRowCounts(failureId)).toEqual({ auth: 0, attempt: 0 });

    // The runner still sees a blocked checkpoint and processes nothing further.
    const again = await runProjectionOnce({
      pool: admin,
      registry: registryOf('e-quar'),
      name: 'e-quar',
      version: 1,
      now: laterNow(9 * 600000),
    });
    expect(again.outcome).toBe('blocked-existing');
    expect((await checkpointOf('e-quar'))?.status).toBe('blocked');
  });

  it('acknowledge then quarantine is a valid two-step lifecycle', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-ack-quar');
    await acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 0,
      now: T0,
    });
    const q = await quarantineProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 1,
      now: T0,
    });
    expect(q.status).toBe('quarantined');
    expect(await actionTypes(failureId)).toEqual(['created', 'acknowledged', 'quarantined']);
  });
});

describe('idempotency and optimistic concurrency', () => {
  it('an exact duplicate acknowledge is idempotent (one action, no double increment)', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-ack-dup');
    const first = await acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 0,
      now: T0,
    });
    const second = await acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 0,
      now: T0,
    });
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.generation).toBe(1); // unchanged
    expect(await actionTypes(failureId)).toEqual(['created', 'acknowledged']);
  });

  it('a stale generation is rejected', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-stale');
    await acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
      failureId,
      expectedGeneration: 0,
      now: T0,
    });
    await expect(
      quarantineProjectionFailureOperation(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 0, // stale — the failure is now at generation 1
        now: T0,
      }),
    ).rejects.toMatchObject({ code: 'stale-generation' });
  });

  it('concurrent acknowledge attempts yield exactly one action', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-conc-ack');
    const [a, b] = await Promise.all([
      acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 0,
        now: T0,
      }).catch((e: unknown) => e),
      acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 0,
        now: T0,
      }).catch((e: unknown) => e),
    ]);
    void a;
    void b;
    expect(await actionTypes(failureId)).toEqual(['created', 'acknowledged']); // exactly one
  });

  it('acknowledge racing quarantine yields one valid serial outcome', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-race');
    const [a, q] = await Promise.all([
      acknowledgeProjectionFailureOperation(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 0,
        now: T0,
      }).catch((e: unknown) => e),
      quarantineProjectionFailureOperation(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 0,
        now: T0,
      }).catch((e: unknown) => e),
    ]);
    void a;
    void q;
    // Exactly one of {acknowledged, quarantined} won; the loser did not also write.
    const types = await actionTypes(failureId);
    expect(types).toHaveLength(2); // created + exactly one transition
    expect(types[0]).toBe('created');
    expect(['acknowledged', 'quarantined']).toContain(types[1]);
  });
});

describe('authorization and divergence gates', () => {
  it('an inspect-only operator cannot acknowledge (no write)', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-authz');
    await expect(
      acknowledgeProjectionFailureOperation(admin, INSPECT_ONLY, ctx(), {
        failureId,
        expectedGeneration: 0,
        now: T0,
      }),
    ).rejects.toMatchObject({ code: 'authorization-denied' });
    expect(await actionTypes(failureId)).toEqual(['created']); // no acknowledged action
  });

  it('a divergence (a second active failure for the projection) blocks quarantine', async () => {
    await seedEvents(2);
    const { failureId } = await blockFailure('e-diverge');

    // Forge a divergence: a SECOND active failure for the same projection at position 2. This makes
    // the projection have multiple active failures — a fail-closed divergence.
    const storageSeq = await withClient(admin, async (c) => {
      const r = await c.query<{ s: string }>(
        `SELECT event_storage_sequence AS s FROM qf_jarvis.projection_event_position WHERE position = 2`,
      );
      return r.rows[0]?.s;
    });
    if (storageSeq === undefined) throw new Error('expected an event at position 2');
    await withClient(admin, (c) =>
      createProjectionFailure(c, {
        failureId: randomUUID() as ProjectionFailureId,
        name: 'e-diverge' as ProjectionName,
        version: 1,
        position: 2n,
        eventStorageSequence: BigInt(storageSeq),
        category: 'DETERMINISTIC_HANDLER_FAILURE',
        safeErrorCode: 'projection-handler-failed',
        automaticAttemptCount: 5,
        firstFailedAt: T0,
        lastFailedAt: T0,
        now: T0,
      }),
    );

    await expect(
      quarantineProjectionFailureOperation(admin, ALLOW, ctx(), {
        failureId,
        expectedGeneration: 0,
        now: T0,
      }),
    ).rejects.toMatchObject({ code: 'divergence-detected' });
    // No quarantine action was appended to the original failure.
    expect(await actionTypes(failureId)).toEqual(['created']);
  });

  it('a missing failure is rejected', async () => {
    await expect(
      inspectProjectionFailure(admin, ALLOW, ctx(), {
        failureId: randomUUID() as ProjectionFailureId,
      }),
    ).rejects.toMatchObject({ code: 'failure-not-found' });
  });
});

describe('append-only protection remains active', () => {
  it('the action ledger refuses a direct UPDATE (append-only trigger)', async () => {
    await seedEvents(1);
    const { failureId } = await blockFailure('e-appendonly');
    await expect(
      withClient(admin, (c) =>
        c.query(
          `UPDATE qf_jarvis.projection_failure_action SET reason = 'x' WHERE failure_id = $1`,
          [failureId],
        ),
      ),
    ).rejects.toThrow(/append-only|not permitted/i);
  });
});

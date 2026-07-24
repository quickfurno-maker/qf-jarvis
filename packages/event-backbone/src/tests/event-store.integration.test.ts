/**
 * `storeValidatedEvent` against a real PostgreSQL — the atomic, idempotent event-store write
 * (Stage 3.3 slice 3, ADR-0020 §8).
 *
 * These prove the BEHAVIOUR the schema only made possible: first delivery stores exactly one row,
 * a same-digest redelivery is a benign duplicate, a different-digest redelivery fails closed
 * without touching the original, and all of it stays correct under **real concurrent clients** —
 * separate database sessions racing, not simulated Promise ordering.
 *
 * The records here are synthetic. No real name, phone number, email, address, coordinate, or
 * QuickFurno record appears — the digests and signature are fixed obviously-synthetic bytes.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  closeDatabasePool,
  ConflictingEventDigestError,
  createDatabaseConfig,
  createDatabasePool,
  defaultMigrationsDirectory,
  MigrationChecksumMismatchError,
  storeValidatedEvent,
  withClient,
  type DatabaseClient,
  type DatabasePool,
  type EventPersistenceRecord,
} from '../index.js';
import { runMigrations } from '../persistence/migration-runner.js';
import {
  closeTestPool,
  createTestPool,
  ensureManagedRolesExist,
  MANAGED_ROLES,
  requireTestDatabaseUrl,
  resetTestDatabase,
} from './database-test-utils.js';

const pool: DatabasePool = createTestPool({ applicationName: 'qf-event-store-test' });

/**
 * The DEPLOYMENT runtime role, exactly as migration 0002 expects to find it.
 *
 * It does not exist on a laptop by default — no more than `anon`/`authenticated`/`service_role`
 * do — so the tests create it BEFORE migrating, which is the only order in which 0002's
 * conditional grant has something to grant to. A separate, low-privilege LOGIN role is what
 * makes the authorization assertions real: they connect **as this role** and observe what
 * PostgreSQL itself refuses, rather than reading a grant table and trusting it.
 *
 * The password is a fresh synthetic value per run. It is never logged.
 */
const RUNTIME_ROLE = 'qf_jarvis_runtime';
const RUNTIME_PASSWORD = randomUUID();

/** The test database, re-pointed at the runtime role. Same loopback host and database. */
function runtimeConnectionString(): string {
  const url = new URL(requireTestDatabaseUrl());
  url.username = RUNTIME_ROLE;
  url.password = RUNTIME_PASSWORD;
  return url.toString();
}

/** A pool that connects AS the least-privileged runtime role. The suite closes it. */
const runtimePool: DatabasePool = createDatabasePool(
  createDatabaseConfig({
    connectionString: runtimeConnectionString(),
    maxConnections: 3,
    applicationName: 'qf-event-store-runtime-test',
  }),
);

/**
 * Create the runtime LOGIN role and set this run's password.
 *
 * The role is cluster-global and persists between test files; 0002's grant to it is conditional
 * and idempotent, so re-migrating in any other file neither fails nor over-grants. `ALTER ROLE
 * ... PASSWORD` cannot take a bind parameter, so the literal is escaped server-side with
 * `format(%L)` — never string-concatenated — before it is executed.
 */
async function ensureRuntimeRoleExists(admin: DatabasePool, password: string): Promise<void> {
  await withClient(admin, async (client) => {
    await client.query(`
      DO $runtime$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
          CREATE ROLE qf_jarvis_runtime LOGIN;
        END IF;
      END
      $runtime$;
    `);

    const built = await client.query<{ stmt: string }>(
      `SELECT format('ALTER ROLE qf_jarvis_runtime WITH LOGIN PASSWORD %L', $1::text) AS stmt`,
      [password],
    );
    const stmt = built.rows[0]?.stmt;
    if (stmt === undefined) {
      throw new Error('Failed to build the runtime role password statement');
    }
    await client.query(stmt);
  });
}

/** A well-formed synthetic record. Obviously-synthetic digests and signature. */
function makeRecord(overrides: Partial<EventPersistenceRecord> = {}): EventPersistenceRecord {
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
    ...overrides,
  };
}

async function countRows(eventId: string): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM qf_jarvis.event WHERE event_id = $1',
      [eventId],
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  });
}

async function countConflicts(eventId: string): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM qf_jarvis.event_conflict WHERE event_id = $1',
      [eventId],
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  });
}

beforeAll(async () => {
  await resetTestDatabase(pool);
  // Create the roles BEFORE migrating. 0002 grants the runtime role its least privilege only
  // if the role already exists, and the PUBLIC/managed-role revocation assertions would be
  // vacuous if those roles did not exist to be revoked from.
  await ensureManagedRolesExist(pool);
  await ensureRuntimeRoleExists(pool, RUNTIME_PASSWORD);
  await runMigrations(pool, defaultMigrationsDirectory());
});

afterAll(async () => {
  await closeDatabasePool(runtimePool);
  await closeTestPool(pool);
});

describe('storeValidatedEvent — first delivery', () => {
  it('stores exactly one row and reports a database-generated acceptance', async () => {
    const record = makeRecord();
    const before = Date.now();
    const outcome = await storeValidatedEvent(pool, record);

    expect(outcome.outcome).toBe('stored');
    expect(BigInt(outcome.sequence)).toBeGreaterThan(0n);
    // accepted_at is generated by PostgreSQL, never supplied — the record has no such field.
    expect(outcome.acceptedAt).toBeInstanceOf(Date);
    expect(outcome.acceptedAt.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    expect(await countRows(record.eventId)).toBe(1);
  });

  it('maps every field to the correct column', async () => {
    const record = makeRecord({
      eventType: 'qf.communication.state-recorded',
      eventVersion: 2,
      subjectType: 'vendor',
      subjectId: 'CORE-VENDOR-00088',
      correlationId: randomUUID(),
      causationEventId: randomUUID(),
      payload: { recommendationId: 'REC-7', reasons: ['stale', 'high-value'] },
      semanticEventDigest: Buffer.alloc(32, 0x11),
      bodyDigest: Buffer.alloc(32, 0x22),
      signatureKeyId: 'core-2026-a',
      signature: Buffer.alloc(64, 0x33),
    });

    await storeValidatedEvent(pool, record);

    const row = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT event_id, event_type, event_version, source, subject_type, subject_id,
                occurred_at, emitted_at, correlation_id, causation_event_id, payload,
                semantic_event_digest, body_digest, signature_algorithm, signature_key_id,
                signature_signed_at, signature, accepted_at
           FROM qf_jarvis.event WHERE event_id = $1`,
        [record.eventId],
      );
      return result.rows[0] as Record<string, unknown>;
    });

    expect(row['event_id']).toBe(record.eventId);
    expect(row['event_type']).toBe(record.eventType);
    expect(row['event_version']).toBe(record.eventVersion);
    expect(row['source']).toBe('quickfurno-core');
    expect(row['subject_type']).toBe('vendor');
    expect(row['subject_id']).toBe('CORE-VENDOR-00088');
    expect((row['occurred_at'] as Date).getTime()).toBe(new Date(record.occurredAt).getTime());
    expect((row['emitted_at'] as Date).getTime()).toBe(new Date(record.emittedAt).getTime());
    expect(row['correlation_id']).toBe(record.correlationId);
    expect(row['causation_event_id']).toBe(record.causationEventId);
    expect(row['payload']).toStrictEqual(record.payload);
    expect((row['semantic_event_digest'] as Buffer).equals(record.semanticEventDigest)).toBe(true);
    expect((row['body_digest'] as Buffer).equals(record.bodyDigest)).toBe(true);
    expect(row['signature_algorithm']).toBe('ed25519');
    expect(row['signature_key_id']).toBe('core-2026-a');
    expect((row['signature_signed_at'] as Date).getTime()).toBe(
      new Date(record.signatureSignedAt).getTime(),
    );
    expect((row['signature'] as Buffer).equals(record.signature)).toBe(true);
    expect(row['accepted_at']).toBeInstanceOf(Date);
  });
});

describe('storeValidatedEvent — benign duplicate (same eventId, same digest)', () => {
  it('does not insert a second row and returns the ORIGINAL sequence', async () => {
    const record = makeRecord();
    const first = await storeValidatedEvent(pool, record);
    const second = await storeValidatedEvent(pool, record);

    expect(first.outcome).toBe('stored');
    expect(second.outcome).toBe('duplicate');
    expect(second.sequence).toBe(first.sequence);
    expect(second.acceptedAt.getTime()).toBe(first.acceptedAt.getTime());
    expect(await countRows(record.eventId)).toBe(1);
  });
});

describe('storeValidatedEvent — conflicting duplicate (same eventId, different digest)', () => {
  it('fails closed with a safe error and never overwrites the original', async () => {
    const eventId = randomUUID();
    const original = makeRecord({
      eventId,
      subjectId: 'CORE-CLIENT-ORIGINAL',
      semanticEventDigest: Buffer.alloc(32, 0xa1),
    });
    await storeValidatedEvent(pool, original);

    const before = await withClient(pool, async (client) => {
      const result = await client.query(
        'SELECT sequence, subject_id, semantic_event_digest, accepted_at FROM qf_jarvis.event WHERE event_id = $1',
        [eventId],
      );
      return result.rows[0] as Record<string, unknown>;
    });

    const conflicting = makeRecord({
      eventId,
      subjectId: 'CORE-CLIENT-TAMPERED',
      semanticEventDigest: Buffer.alloc(32, 0xff),
    });

    let thrown: unknown;
    try {
      await storeValidatedEvent(pool, conflicting);
      throw new Error('expected a ConflictingEventDigestError');
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConflictingEventDigestError);
    const conflict = thrown as ConflictingEventDigestError;
    expect(conflict.code).toBe('conflicting-event-digest');
    expect(conflict.eventId).toBe(eventId);
    // The error carries only the eventId — never the digests, subject, payload, or signature.
    expect(conflict.message).not.toContain('a1a1');
    expect(conflict.message).not.toContain('ffff');
    expect(conflict.message).not.toContain('CORE-CLIENT-TAMPERED');

    // The original row is byte-for-byte unchanged.
    const after = await withClient(pool, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        'SELECT sequence, subject_id, semantic_event_digest, accepted_at FROM qf_jarvis.event WHERE event_id = $1',
        [eventId],
      );
      return result.rows;
    });
    expect(after).toHaveLength(1);
    const row = after[0];
    if (row === undefined) {
      throw new Error('Expected the original row to survive the conflict');
    }
    expect(row['subject_id']).toBe('CORE-CLIENT-ORIGINAL');
    expect(row['sequence']).toBe(before['sequence']);
    expect((row['semantic_event_digest'] as Buffer).equals(Buffer.alloc(32, 0xa1))).toBe(true);
    expect((row['accepted_at'] as Date).getTime()).toBe((before['accepted_at'] as Date).getTime());
  });
});

describe('storeValidatedEvent — real concurrent clients', () => {
  it('creates exactly one row when the same event is delivered concurrently', async () => {
    // One shared record, delivered many times at once. Separate pool connections race on the
    // unique index; exactly one INSERT wins and the rest classify as benign duplicates.
    const record = makeRecord();
    const attempts = 8;

    const outcomes = await Promise.all(
      Array.from({ length: attempts }, () => storeValidatedEvent(pool, record)),
    );

    const stored = outcomes.filter((o) => o.outcome === 'stored');
    const duplicates = outcomes.filter((o) => o.outcome === 'duplicate');
    expect(stored).toHaveLength(1);
    expect(duplicates).toHaveLength(attempts - 1);
    // Every result — stored and duplicate — reports the same single row.
    for (const outcome of outcomes) {
      expect(outcome.sequence).toBe(stored[0]?.sequence);
    }
    expect(await countRows(record.eventId)).toBe(1);
  });

  it('creates exactly one accepted row and one conflict when conflicting events race', async () => {
    const eventId = randomUUID();
    const a = makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x01) });
    const b = makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x02) });

    const results = await Promise.allSettled([
      storeValidatedEvent(pool, a),
      storeValidatedEvent(pool, b),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((fulfilled[0] as PromiseFulfilledResult<{ outcome: string }>).value.outcome).toBe(
      'stored',
    );
    const rejection = rejected[0];
    if (rejection === undefined) {
      throw new Error('Expected exactly one conflicting delivery to be rejected');
    }
    expect(rejection.reason).toBeInstanceOf(ConflictingEventDigestError);
    expect(await countRows(eventId)).toBe(1);
  });
});

describe('storeValidatedEvent — conflict recording (Stage 3.3.3)', () => {
  /** Deliver a conflicting event (its `eventId` already accepted); return the caught error. */
  async function provokeConflict(conflicting: EventPersistenceRecord): Promise<unknown> {
    try {
      await storeValidatedEvent(pool, conflicting);
      throw new Error('expected a ConflictingEventDigestError');
    } catch (error: unknown) {
      return error;
    }
  }

  it('appends exactly one event_conflict row and still throws the typed error', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );

    const error = await provokeConflict(
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xff) }),
    );

    expect(error).toBeInstanceOf(ConflictingEventDigestError);
    expect(await countConflicts(eventId)).toBe(1);
  });

  it('maps the conflicting delivery evidence to the correct columns — and stores NO original digest', async () => {
    const eventId = randomUUID();
    const correlationId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );

    const conflicting = makeRecord({
      eventId,
      correlationId,
      semanticEventDigest: Buffer.alloc(32, 0xcd),
      bodyDigest: Buffer.alloc(32, 0xce),
      signatureAlgorithm: 'ed25519',
      signatureKeyId: 'core-2026-a',
      signatureSignedAt: '2026-07-11T09:00:06Z',
    });
    await provokeConflict(conflicting);

    const row = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT event_id, conflicting_semantic_event_digest, conflicting_body_digest,
                conflicting_correlation_id, conflicting_signature_algorithm,
                conflicting_signature_key_id, conflicting_signature_signed_at, recorded_at
           FROM qf_jarvis.event_conflict WHERE event_id = $1`,
        [eventId],
      );
      return result.rows[0] as Record<string, unknown>;
    });

    expect(row['event_id']).toBe(eventId);
    expect(
      (row['conflicting_semantic_event_digest'] as Buffer).equals(Buffer.alloc(32, 0xcd)),
    ).toBe(true);
    expect((row['conflicting_body_digest'] as Buffer).equals(Buffer.alloc(32, 0xce))).toBe(true);
    expect(row['conflicting_correlation_id']).toBe(correlationId);
    expect(row['conflicting_signature_algorithm']).toBe('ed25519');
    expect(row['conflicting_signature_key_id']).toBe('core-2026-a');
    expect((row['conflicting_signature_signed_at'] as Date).getTime()).toBe(
      new Date('2026-07-11T09:00:06Z').getTime(),
    );
    // recorded_at is database-generated.
    expect(row['recorded_at']).toBeInstanceOf(Date);
  });

  it('has no original-digest, payload, signature, or subject column — the original is joined', async () => {
    const columns = await withClient(pool, async (client) => {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'qf_jarvis' AND table_name = 'event_conflict'`,
      );
      return result.rows.map((row) => row.column_name);
    });

    for (const forbidden of [
      'original_semantic_event_digest',
      'payload',
      'conflicting_payload',
      'raw_body',
      'signature',
      'conflicting_signature',
      'subject_id',
      'subject_type',
    ]) {
      expect(columns).not.toContain(forbidden);
    }

    // The original semantic digest is obtained by joining the immutable parent row — one copy.
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x5a) }),
    );
    await provokeConflict(makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x5b) }));
    const joined = await withClient(pool, async (client) => {
      const result = await client.query<{ original: Buffer; conflicting: Buffer }>(
        `SELECT e.semantic_event_digest AS original, c.conflicting_semantic_event_digest AS conflicting
           FROM qf_jarvis.event_conflict c
           JOIN qf_jarvis.event e ON e.event_id = c.event_id
          WHERE c.event_id = $1`,
        [eventId],
      );
      return result.rows[0];
    });
    expect(joined?.original.equals(Buffer.alloc(32, 0x5a))).toBe(true);
    expect(joined?.conflicting.equals(Buffer.alloc(32, 0x5b))).toBe(true);
  });

  it('leaves the accepted original byte-for-byte unchanged', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({
        eventId,
        subjectId: 'CORE-CLIENT-ORIGINAL',
        semanticEventDigest: Buffer.alloc(32, 0xa1),
      }),
    );
    const before = await withClient(pool, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        'SELECT sequence, subject_id, semantic_event_digest, accepted_at FROM qf_jarvis.event WHERE event_id = $1',
        [eventId],
      );
      return result.rows[0];
    });

    await provokeConflict(
      makeRecord({
        eventId,
        subjectId: 'CORE-CLIENT-TAMPERED',
        semanticEventDigest: Buffer.alloc(32, 0xff),
      }),
    );

    const after = await withClient(pool, async (client) => {
      const result = await client.query<Record<string, unknown>>(
        'SELECT sequence, subject_id, semantic_event_digest, accepted_at FROM qf_jarvis.event WHERE event_id = $1',
        [eventId],
      );
      return result.rows;
    });
    expect(after).toHaveLength(1);
    const row = after[0];
    if (row === undefined || before === undefined) {
      throw new Error('Expected the original row to survive the conflict');
    }
    expect(row['subject_id']).toBe('CORE-CLIENT-ORIGINAL');
    expect(row['sequence']).toBe(before['sequence']);
    expect((row['semantic_event_digest'] as Buffer).equals(Buffer.alloc(32, 0xa1))).toBe(true);
    expect((row['accepted_at'] as Date).getTime()).toBe((before['accepted_at'] as Date).getTime());
  });

  it('records NO conflict for a benign (same-digest) redelivery', async () => {
    const record = makeRecord();
    await storeValidatedEvent(pool, record);
    const second = await storeValidatedEvent(pool, record);
    expect(second.outcome).toBe('duplicate');
    expect(await countConflicts(record.eventId)).toBe(0);
  });

  it('records a SEPARATE row for each repeated conflicting delivery — no dedup', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );

    await provokeConflict(makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xb1) }));
    await provokeConflict(makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xb2) }));
    // Even the SAME conflicting digest, delivered again, is a separate audit fact.
    await provokeConflict(makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xb1) }));

    expect(await countConflicts(eventId)).toBe(3);
    expect(await countRows(eventId)).toBe(1);
  });

  it('rolls back the whole transaction if the conflict INSERT fails, leaving no partial record', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );

    // Force ONLY the event_conflict INSERT to fail, via a temporary always-failing constraint that
    // applies to new rows. The event INSERT (ON CONFLICT DO NOTHING) is a no-op, so the failure is
    // isolated to the conflict append.
    await withClient(pool, (client) =>
      client.query(
        'ALTER TABLE qf_jarvis.event_conflict ADD CONSTRAINT tmp_force_fail CHECK (recorded_at IS NULL) NOT VALID',
      ),
    );
    try {
      const error = await provokeConflict(
        makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xff) }),
      );
      // The failure surfaces as the database/constraint error — NOT as a recorded conflict.
      expect(error).not.toBeInstanceOf(ConflictingEventDigestError);
      expect(String((error as { constraint?: string }).constraint)).toBe('tmp_force_fail');
      // Nothing partial: no conflict row, and the original event still stands.
      expect(await countConflicts(eventId)).toBe(0);
      expect(await countRows(eventId)).toBe(1);
    } finally {
      await withClient(pool, (client) =>
        client.query('ALTER TABLE qf_jarvis.event_conflict DROP CONSTRAINT tmp_force_fail'),
      );
    }
  });

  it('commits the conflict BEFORE the typed error is thrown — the row is durable', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );

    const error = await provokeConflict(
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xff) }),
    );
    expect(error).toBeInstanceOf(ConflictingEventDigestError);
    // A FRESH transaction sees the committed conflict row — so it committed before the throw.
    const persisted = await withClient(pool, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM qf_jarvis.event_conflict WHERE event_id = $1',
        [eventId],
      );
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    });
    expect(persisted).toBe(1);
  });
});

describe('event_conflict — append-only', () => {
  it('refuses UPDATE, DELETE, and a bulk DELETE', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );
    try {
      await storeValidatedEvent(
        pool,
        makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xff) }),
      );
    } catch {
      // expected conflict
    }

    await expect(
      withClient(pool, (client) =>
        client.query(
          'UPDATE qf_jarvis.event_conflict SET conflicting_signature_key_id = $1 WHERE event_id = $2',
          ['tampered', eventId],
        ),
      ),
    ).rejects.toThrow(/append-only|not permitted/i);

    await expect(
      withClient(pool, (client) =>
        client.query('DELETE FROM qf_jarvis.event_conflict WHERE event_id = $1', [eventId]),
      ),
    ).rejects.toThrow(/append-only|not permitted/i);

    await expect(
      withClient(pool, (client) => client.query('DELETE FROM qf_jarvis.event_conflict')),
    ).rejects.toThrow(/append-only|not permitted/i);
  });

  it('refuses a direct INSERT whose event_id has no accepted parent (FK)', async () => {
    await expect(
      withClient(pool, (client) =>
        client.query(
          `INSERT INTO qf_jarvis.event_conflict (
             event_id, conflicting_semantic_event_digest, conflicting_body_digest,
             conflicting_correlation_id, conflicting_signature_algorithm,
             conflicting_signature_key_id, conflicting_signature_signed_at
           ) VALUES ($1, $2, $3, $4, 'ed25519', 'core-2026-a', '2026-07-11T09:00:06Z')`,
          [randomUUID(), Buffer.alloc(32, 0x01), Buffer.alloc(32, 0x02), randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ constraint: 'event_conflict_event_fk' });
  });
});

/** The columns the runtime may INSERT into event_conflict; sequence + recorded_at are DB-generated. */
const EVENT_CONFLICT_CALLER_COLUMNS = [
  'event_id',
  'conflicting_semantic_event_digest',
  'conflicting_body_digest',
  'conflicting_correlation_id',
  'conflicting_signature_algorithm',
  'conflicting_signature_key_id',
  'conflicting_signature_signed_at',
] as const;

describe('event_conflict — the runtime role has exactly column-level least privilege', () => {
  it('stores a first event and then records a conflict THROUGH the runtime connection', async () => {
    const eventId = randomUUID();
    // 1. A first validated event can be stored by the runtime role.
    const stored = await storeValidatedEvent(
      runtimePool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );
    expect(stored.outcome).toBe('stored');

    // 2. A conflicting delivery through storeValidatedEvent (runtime connection): appends one
    //    event_conflict row, commits it, and throws ConflictingEventDigestError.
    let thrown: unknown;
    try {
      await storeValidatedEvent(
        runtimePool,
        makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xff) }),
      );
      throw new Error('expected a ConflictingEventDigestError');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictingEventDigestError);
    // Committed before the throw — a fresh read (admin) sees exactly one conflict row.
    expect(await countConflicts(eventId)).toBe(1);
  });

  it('holds INSERT on exactly the seven caller columns and none on the generated columns', async () => {
    const priv = await withClient(pool, async (client) => {
      // Queries run SEQUENTIALLY on the one borrowed client: a single pg connection cannot execute
      // queries concurrently, and `Promise.all(... client.query ...)` would trip the pg
      // concurrent-query deprecation. Correctness, not just tidiness.
      const rows = new Map<string, boolean | undefined>();
      for (const column of [...EVENT_CONFLICT_CALLER_COLUMNS, 'sequence', 'recorded_at']) {
        const result = await client.query<{ granted: boolean }>(
          `SELECT has_column_privilege($1, 'qf_jarvis.event_conflict', $2, 'INSERT') AS granted`,
          [RUNTIME_ROLE, column],
        );
        rows.set(column, result.rows[0]?.granted);
      }
      return rows;
    });
    for (const column of EVENT_CONFLICT_CALLER_COLUMNS) {
      expect(priv.get(column)).toBe(true);
    }
    expect(priv.get('sequence')).toBe(false);
    expect(priv.get('recorded_at')).toBe(false);
  });

  it('holds SELECT on only sequence and recorded_at, and none on the content columns', async () => {
    const priv = await withClient(pool, async (client) => {
      // Sequential on the one client (see the INSERT test above) — no concurrent query on a
      // single pg connection.
      const rows = new Map<string, boolean | undefined>();
      for (const column of ['sequence', 'recorded_at', ...EVENT_CONFLICT_CALLER_COLUMNS]) {
        const result = await client.query<{ granted: boolean }>(
          `SELECT has_column_privilege($1, 'qf_jarvis.event_conflict', $2, 'SELECT') AS granted`,
          [RUNTIME_ROLE, column],
        );
        rows.set(column, result.rows[0]?.granted);
      }
      return rows;
    });
    expect(priv.get('sequence')).toBe(true);
    expect(priv.get('recorded_at')).toBe(true);
    for (const column of EVENT_CONFLICT_CALLER_COLUMNS) {
      expect(priv.get(column)).toBe(false);
    }
  });

  it('cannot SELECT any content column, nor SELECT *', async () => {
    for (const column of EVENT_CONFLICT_CALLER_COLUMNS) {
      await expect(
        withClient(runtimePool, (client) =>
          client.query(`SELECT ${column} FROM qf_jarvis.event_conflict`),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      withClient(runtimePool, (client) => client.query('SELECT * FROM qf_jarvis.event_conflict')),
    ).rejects.toMatchObject({ code: '42501' });

    // The two granted columns DO select.
    const ok = await withClient(runtimePool, async (client) => {
      const result = await client.query(
        'SELECT sequence, recorded_at FROM qf_jarvis.event_conflict LIMIT 1',
      );
      return result.rowCount ?? 0;
    });
    expect(ok).toBeGreaterThanOrEqual(0);
  });

  it('cannot itself supply sequence or recorded_at', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(
      pool,
      makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0xa1) }),
    );
    // recorded_at is an ordinary defaulted column — a clean permission denial.
    await expect(
      withClient(runtimePool, (client) =>
        client.query(
          `INSERT INTO qf_jarvis.event_conflict (event_id, conflicting_semantic_event_digest,
             conflicting_body_digest, conflicting_correlation_id, conflicting_signature_algorithm,
             conflicting_signature_key_id, conflicting_signature_signed_at, recorded_at)
           VALUES ($1, $2, $3, $4, 'ed25519', 'core-2026-a', '2026-07-11T09:00:06Z', now())`,
          [eventId, Buffer.alloc(32, 0x01), Buffer.alloc(32, 0x02), randomUUID()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // Naming sequence (GENERATED ALWAYS) is refused too.
    await expect(
      withClient(runtimePool, (client) =>
        client.query(
          `INSERT INTO qf_jarvis.event_conflict (event_id, sequence, conflicting_semantic_event_digest,
             conflicting_body_digest, conflicting_correlation_id, conflicting_signature_algorithm,
             conflicting_signature_key_id, conflicting_signature_signed_at)
           VALUES ($1, 999, $2, $3, $4, 'ed25519', 'core-2026-a', '2026-07-11T09:00:06Z')`,
          [eventId, Buffer.alloc(32, 0x01), Buffer.alloc(32, 0x02), randomUUID()],
        ),
      ),
    ).rejects.toThrow();
  });

  it('has no identity-sequence privilege of any kind', async () => {
    const priv = await withClient(pool, async (client) => {
      const seq = await client.query<{ seq: string | null }>(
        `SELECT pg_get_serial_sequence('qf_jarvis.event_conflict', 'sequence') AS seq`,
      );
      const sequenceName = seq.rows[0]?.seq;
      if (sequenceName === null || sequenceName === undefined) {
        throw new Error('Expected an identity sequence');
      }
      const result = await client.query<{ usage: boolean; select: boolean; update: boolean }>(
        `SELECT has_sequence_privilege($1, $2, 'USAGE')  AS usage,
                has_sequence_privilege($1, $2, 'SELECT') AS select,
                has_sequence_privilege($1, $2, 'UPDATE') AS update`,
        [RUNTIME_ROLE, sequenceName],
      );
      return result.rows[0];
    });
    expect(priv?.usage).toBe(false);
    expect(priv?.select).toBe(false);
    expect(priv?.update).toBe(false);
  });

  it('is denied UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER, and cannot CREATE in qf_jarvis', async () => {
    const priv = await withClient(pool, async (client) => {
      const result = await client.query<{
        upd: boolean;
        del: boolean;
        trunc: boolean;
        refs: boolean;
        trig: boolean;
        schema_create: boolean;
      }>(
        `SELECT has_table_privilege($1, 'qf_jarvis.event_conflict', 'UPDATE')     AS upd,
                has_table_privilege($1, 'qf_jarvis.event_conflict', 'DELETE')     AS del,
                has_table_privilege($1, 'qf_jarvis.event_conflict', 'TRUNCATE')   AS trunc,
                has_table_privilege($1, 'qf_jarvis.event_conflict', 'REFERENCES') AS refs,
                has_table_privilege($1, 'qf_jarvis.event_conflict', 'TRIGGER')    AS trig,
                has_schema_privilege($1, 'qf_jarvis', 'CREATE')                   AS schema_create`,
        [RUNTIME_ROLE],
      );
      return result.rows[0];
    });
    expect(priv?.upd).toBe(false);
    expect(priv?.del).toBe(false);
    expect(priv?.trunc).toBe(false);
    expect(priv?.refs).toBe(false);
    expect(priv?.trig).toBe(false);
    expect(priv?.schema_create).toBe(false);

    // Behavioural: a CREATE TABLE in qf_jarvis is refused.
    await expect(
      withClient(runtimePool, (client) =>
        client.query('CREATE TABLE qf_jarvis.runtime_probe_conflict (id integer)'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('owns no new table, sequence, or function', async () => {
    const counts = await withClient(pool, async (client) => {
      const result = await client.query<{ relations: string; routines: string }>(
        `SELECT (SELECT count(*) FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
                  WHERE r.rolname = $1)::text AS relations,
                (SELECT count(*) FROM pg_catalog.pg_proc p
                   JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
                  WHERE r.rolname = $1)::text AS routines`,
        [RUNTIME_ROLE],
      );
      return result.rows[0];
    });
    expect(counts?.relations).toBe('0');
    expect(counts?.routines).toBe('0');
  });
});

describe('event_conflict — nothing else can reach it', () => {
  it('leaves PUBLIC, anon, authenticated and service_role with no schema/table/column access', async () => {
    for (const grantee of ['public', ...MANAGED_ROLES]) {
      const priv = await withClient(pool, async (client) => {
        const result = await client.query<{
          schema_usage: boolean;
          seq_select: boolean;
          event_id_insert: boolean;
          seq_insert: boolean;
        }>(
          `SELECT has_schema_privilege($1, 'qf_jarvis', 'USAGE')                              AS schema_usage,
                  has_column_privilege($1, 'qf_jarvis.event_conflict', 'sequence', 'SELECT')  AS seq_select,
                  has_column_privilege($1, 'qf_jarvis.event_conflict', 'event_id', 'INSERT')  AS event_id_insert,
                  has_column_privilege($1, 'qf_jarvis.event_conflict', 'sequence', 'INSERT')  AS seq_insert`,
          [grantee],
        );
        return result.rows[0];
      });
      expect(priv?.schema_usage).toBe(false);
      expect(priv?.seq_select).toBe(false);
      expect(priv?.event_id_insert).toBe(false);
      expect(priv?.seq_insert).toBe(false);
    }
  });
});

describe('storeValidatedEvent — rollback', () => {
  it('leaves no partial row when the insert fails a constraint', async () => {
    // A 16-byte digest violates the 32-byte CHECK. The INSERT throws inside the transaction, which
    // rolls back — so no row exists afterwards.
    const record = makeRecord({ semanticEventDigest: Buffer.alloc(16, 0x01) });

    await expect(storeValidatedEvent(pool, record)).rejects.toMatchObject({
      constraint: 'event_semantic_event_digest_is_sha256',
    });

    expect(await countRows(record.eventId)).toBe(0);
  });
});

/**
 * Migration 0002 — the runtime role's least privilege, proven from BOTH sides.
 *
 * The grant table is read with `has_*_privilege` (what the migration says it did), AND the role
 * is connected to directly (what PostgreSQL actually enforces). A grant assertion that only reads
 * the catalog can be fooled by a role that inherits privilege some other way; connecting as the
 * role and watching it be refused cannot.
 */
describe('migration 0002 — the runtime role has exactly least privilege', () => {
  it('grants USAGE on the schema and SELECT+INSERT on the event table, and nothing more', async () => {
    const priv = await withClient(pool, async (client) => {
      const result = await client.query<{
        schema_usage: boolean;
        schema_create: boolean;
        ev_select: boolean;
        ev_insert: boolean;
        ev_update: boolean;
        ev_delete: boolean;
        ev_truncate: boolean;
        ev_references: boolean;
        ev_trigger: boolean;
      }>(
        `SELECT has_schema_privilege($1, 'qf_jarvis', 'USAGE')           AS schema_usage,
                has_schema_privilege($1, 'qf_jarvis', 'CREATE')          AS schema_create,
                has_table_privilege($1, 'qf_jarvis.event', 'SELECT')     AS ev_select,
                has_table_privilege($1, 'qf_jarvis.event', 'INSERT')     AS ev_insert,
                has_table_privilege($1, 'qf_jarvis.event', 'UPDATE')     AS ev_update,
                has_table_privilege($1, 'qf_jarvis.event', 'DELETE')     AS ev_delete,
                has_table_privilege($1, 'qf_jarvis.event', 'TRUNCATE')   AS ev_truncate,
                has_table_privilege($1, 'qf_jarvis.event', 'REFERENCES') AS ev_references,
                has_table_privilege($1, 'qf_jarvis.event', 'TRIGGER')    AS ev_trigger`,
        [RUNTIME_ROLE],
      );
      return result.rows[0];
    });

    expect(priv?.schema_usage).toBe(true);
    expect(priv?.ev_select).toBe(true);
    expect(priv?.ev_insert).toBe(true);
    // Everything else is denied. The runtime appends and reads; it does not define or rewrite.
    expect(priv?.schema_create).toBe(false);
    expect(priv?.ev_update).toBe(false);
    expect(priv?.ev_delete).toBe(false);
    expect(priv?.ev_truncate).toBe(false);
    expect(priv?.ev_references).toBe(false);
    expect(priv?.ev_trigger).toBe(false);
  });

  it('grants NO privilege on the identity sequence — an IDENTITY column needs none', async () => {
    // 0002 issues no sequence grant on purpose: PostgreSQL advances a GENERATED ALWAYS AS
    // IDENTITY sequence as part of the INSERT without the inserting role holding any privilege
    // on it. "Minimum sequence privilege only when actually required" here means: none.
    const priv = await withClient(pool, async (client) => {
      const sequence = await client.query<{ seq: string | null }>(
        `SELECT pg_get_serial_sequence('qf_jarvis.event', 'sequence') AS seq`,
      );
      const sequenceName = sequence.rows[0]?.seq;
      if (sequenceName === null || sequenceName === undefined) {
        throw new Error('Expected an identity sequence backing qf_jarvis.event.sequence');
      }

      const result = await client.query<{
        seq_usage: boolean;
        seq_select: boolean;
        seq_update: boolean;
      }>(
        `SELECT has_sequence_privilege($1, $2, 'USAGE')  AS seq_usage,
                has_sequence_privilege($1, $2, 'SELECT') AS seq_select,
                has_sequence_privilege($1, $2, 'UPDATE') AS seq_update`,
        [RUNTIME_ROLE, sequenceName],
      );
      return result.rows[0];
    });

    expect(priv?.seq_usage).toBe(false);
    expect(priv?.seq_select).toBe(false);
    expect(priv?.seq_update).toBe(false);
  });

  it('can append and read a synthetic event over its own least-privileged connection', async () => {
    // The positive proof, as the runtime role itself: USAGE + INSERT is enough to store, the
    // RETURNING/classification SELECT is covered by SELECT, and the identity advances with no
    // sequence grant at all.
    const record = makeRecord();
    const outcome = await storeValidatedEvent(runtimePool, record);
    expect(outcome.outcome).toBe('stored');

    const seen = await withClient(runtimePool, async (client) => {
      const result = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM qf_jarvis.event WHERE event_id = $1',
        [record.eventId],
      );
      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    });
    expect(seen).toBe(1);
  });

  it('is REFUSED UPDATE, DELETE, TRUNCATE and CREATE — checked as the role itself', async () => {
    // SQLSTATE 42501 is insufficient_privilege. The privilege check fires before any row is
    // touched and before the append-only trigger — so an UPDATE/DELETE that matches nothing is
    // still refused. These are the second control; the trigger from 0001 is the first.
    await expect(
      withClient(runtimePool, (client) =>
        client.query('UPDATE qf_jarvis.event SET subject_id = $1 WHERE event_id = $2', [
          'CORE-CLIENT-NEVER',
          randomUUID(),
        ]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withClient(runtimePool, (client) =>
        client.query('DELETE FROM qf_jarvis.event WHERE event_id = $1', [randomUUID()]),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withClient(runtimePool, (client) => client.query('TRUNCATE qf_jarvis.event')),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(
      withClient(runtimePool, (client) =>
        client.query('CREATE TABLE qf_jarvis.runtime_probe (id integer)'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot reach the migration history at all — no privilege of any kind', async () => {
    // The runtime role holds USAGE on the schema but no grant on schema_migration, so the
    // history — the record of what this database IS — is invisible to it.
    await expect(
      withClient(runtimePool, (client) =>
        client.query('SELECT version FROM qf_jarvis.schema_migration'),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    // Check EVERY table privilege, not only SELECT — a stale INSERT/UPDATE/DELETE on the history
    // would be just as dangerous, and the comprehensive REVOKE in 0002 must leave none behind.
    for (const privilege of [
      'SELECT',
      'INSERT',
      'UPDATE',
      'DELETE',
      'TRUNCATE',
      'REFERENCES',
      'TRIGGER',
    ]) {
      const granted = await withClient(pool, async (client) => {
        const result = await client.query<{ granted: boolean }>(
          `SELECT has_table_privilege($1, 'qf_jarvis.schema_migration', $2) AS granted`,
          [RUNTIME_ROLE, privilege],
        );
        return result.rows[0]?.granted;
      });
      expect(granted).toBe(false);
    }
  });

  it('owns no schema, table, sequence, function or trigger', async () => {
    // A role that owns the table could `ALTER TABLE ... DISABLE TRIGGER` and defeat immutability
    // from the inside. The runtime must own nothing. (A trigger has no owner of its own; it is
    // owned via its table, so owning no relation is owning no trigger.)
    const counts = await withClient(pool, async (client) => {
      const result = await client.query<{
        relations: string;
        schemas: string;
        routines: string;
      }>(
        `SELECT (SELECT count(*) FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
                  WHERE r.rolname = $1)::text AS relations,
                (SELECT count(*) FROM pg_catalog.pg_namespace n
                   JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
                  WHERE r.rolname = $1)::text AS schemas,
                (SELECT count(*) FROM pg_catalog.pg_proc p
                   JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
                  WHERE r.rolname = $1)::text AS routines`,
        [RUNTIME_ROLE],
      );
      return result.rows[0];
    });

    expect(counts?.relations).toBe('0');
    expect(counts?.schemas).toBe('0');
    expect(counts?.routines).toBe('0');
  });
});

describe('migration 0002 — nothing else can reach the event log', () => {
  it('leaves PUBLIC, anon, authenticated and service_role with no access', async () => {
    for (const grantee of ['public', ...MANAGED_ROLES]) {
      const priv = await withClient(pool, async (client) => {
        const result = await client.query<{
          schema_usage: boolean;
          ev_select: boolean;
          ev_insert: boolean;
        }>(
          `SELECT has_schema_privilege($1, 'qf_jarvis', 'USAGE')       AS schema_usage,
                  has_table_privilege($1, 'qf_jarvis.event', 'SELECT') AS ev_select,
                  has_table_privilege($1, 'qf_jarvis.event', 'INSERT') AS ev_insert`,
          [grantee],
        );
        return result.rows[0];
      });

      expect(priv?.schema_usage).toBe(false);
      expect(priv?.ev_select).toBe(false);
      expect(priv?.ev_insert).toBe(false);
    }
  });
});

describe('the immutability controls survive migrations 0002 and 0003', () => {
  it('keeps ALL FOUR append-only triggers enabled', async () => {
    // The grant migrations touch no trigger. All four append-only triggers — the event log, the
    // migration history, and the two Stage 3.3.3 audit tables — must still be enabled afterwards.
    // 'O' is "enabled (origin/local)"; 'D' would be disabled.
    const triggers = await withClient(pool, async (client) => {
      const result = await client.query<{ tgname: string; tgenabled: string }>(
        `SELECT t.tgname, t.tgenabled
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_class c     ON c.oid = t.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'qf_jarvis'
            AND t.tgname IN (
              'event_is_immutable', 'schema_migration_is_append_only',
              'ingestion_rejection_is_immutable', 'event_conflict_is_immutable'
            )`,
      );
      return new Map(result.rows.map((row) => [row.tgname, row.tgenabled]));
    });

    expect(triggers.get('event_is_immutable')).toBe('O');
    expect(triggers.get('schema_migration_is_append_only')).toBe('O');
    expect(triggers.get('ingestion_rejection_is_immutable')).toBe('O');
    expect(triggers.get('event_conflict_is_immutable')).toBe('O');
  });
});

describe('the runner is idempotent with 0001 through 0005 applied', () => {
  it('applies zero additional migrations on a re-run, with history 0001, 0002, 0003, 0004', async () => {
    const result = await runMigrations(pool, defaultMigrationsDirectory());

    expect(result.applied).toStrictEqual([]);
    expect(result.alreadyApplied.map((m) => m.filename)).toStrictEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
      '0007_subject_activity_projection.sql',
    ]);
  });
});

describe('the real 0001/0002/0003 set is checksum-reconciled', () => {
  it('rejects a re-run after ONLY the copied 0003 is edited (MigrationChecksumMismatchError)', async () => {
    const realDir = defaultMigrationsDirectory();
    // Byte-for-byte copies of the REAL migration set into a throwaway directory. The real files
    // (0001/0002/0003) are never touched — only the copy of 0003 is later edited.
    const copyDir = await mkdtemp(join(tmpdir(), 'qf-mig-checksum-'));
    try {
      await resetTestDatabase(pool);
      const names = [
        '0001_event_log.sql',
        '0002_event_runtime_grants.sql',
        '0003_ingestion_rejection_and_event_conflict.sql',
      ];
      for (const name of names) {
        await writeFile(join(copyDir, name), await readFile(join(realDir, name)));
      }

      const applied = await runMigrations(pool, copyDir);
      expect(applied.applied.map((m) => m.filename)).toStrictEqual(names);

      // Edit ONLY the copied 0003 — a trailing comment changes its checksum, not its behaviour.
      const copied0003 = join(copyDir, '0003_ingestion_rejection_and_event_conflict.sql');
      await writeFile(
        copied0003,
        `${(await readFile(copied0003)).toString('utf8')}\n-- checksum-mismatch probe (copy only)\n`,
      );

      await expect(runMigrations(pool, copyDir)).rejects.toBeInstanceOf(
        MigrationChecksumMismatchError,
      );
    } finally {
      await rm(copyDir, { recursive: true, force: true });
      // Restore the shared database to the real, fully-migrated state for any later file.
      await resetTestDatabase(pool);
      await runMigrations(pool, realDir);
    }
  });
});

/**
 * Migration 0002 must remove STALE DIRECT privileges, not only the schema/table grants.
 *
 * 0002's REVOKEs run only on its FIRST application, so this test applies 0001, plants stale grants
 * on schema_migration / the identity sequence / the functions, and only THEN applies 0002 — the
 * exact order in which the comprehensive REVOKE has something to clean up. It resets and re-applies
 * both migrations, and (running last in this file) leaves the shared database fully migrated.
 */
describe('migration 0002 — comprehensive stale-grant remediation', () => {
  it('strips stale grants on schema_migration, the identity sequence, and functions', async () => {
    const migrationsDir = defaultMigrationsDirectory();

    await resetTestDatabase(pool);
    const only0001 = await mkdtemp(join(tmpdir(), 'qf-mig-0001-'));
    try {
      // 1. Apply ONLY 0001, from a byte-for-byte copy so its checksum reconciles with the real file
      //    when the full directory runs later (and applies 0002 for the first time).
      await writeFile(
        join(only0001, '0001_event_log.sql'),
        await readFile(join(migrationsDir, '0001_event_log.sql')),
      );
      const first = await runMigrations(pool, only0001);
      expect(first.applied.map((m) => m.filename)).toStrictEqual(['0001_event_log.sql']);

      // 2. Ensure the runtime role exists (cluster-global; recreate defensively).
      await ensureRuntimeRoleExists(pool, RUNTIME_PASSWORD);

      const sequenceName = await withClient(pool, async (client) => {
        const result = await client.query<{ seq: string | null }>(
          `SELECT pg_get_serial_sequence('qf_jarvis.event', 'sequence') AS seq`,
        );
        const seq = result.rows[0]?.seq;
        if (seq === null || seq === undefined) {
          throw new Error('Expected an identity sequence backing qf_jarvis.event.sequence');
        }
        return seq;
      });

      // 3. Deliberately grant exactly the stale privileges least privilege must later remove. The
      //    sequence name is DB-derived (pg_get_serial_sequence), not user input.
      await withClient(pool, async (client) => {
        await client.query('GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime');
        await client.query(
          'GRANT SELECT, INSERT, UPDATE, DELETE ON qf_jarvis.schema_migration TO qf_jarvis_runtime',
        );
        await client.query(
          `GRANT USAGE, SELECT, UPDATE ON SEQUENCE ${sequenceName} TO qf_jarvis_runtime`,
        );
        await client.query(
          'GRANT EXECUTE ON FUNCTION qf_jarvis.event_reject_mutation() TO qf_jarvis_runtime',
        );
        await client.query(
          'GRANT EXECUTE ON FUNCTION qf_jarvis.schema_migration_reject_mutation() TO qf_jarvis_runtime',
        );
      });

      // Sanity: the stale grants actually took, so the assertions below are not vacuous.
      const before = await withClient(pool, async (client) => {
        const result = await client.query<{ hist: boolean; seq: boolean; fn: boolean }>(
          `SELECT has_table_privilege('qf_jarvis_runtime', 'qf_jarvis.schema_migration', 'SELECT') AS hist,
                  has_sequence_privilege('qf_jarvis_runtime', $1, 'USAGE')                         AS seq,
                  has_function_privilege('qf_jarvis_runtime', 'qf_jarvis.event_reject_mutation()', 'EXECUTE') AS fn`,
          [sequenceName],
        );
        return result.rows[0];
      });
      expect(before?.hist).toBe(true);
      expect(before?.seq).toBe(true);
      expect(before?.fn).toBe(true);

      // 4. Apply the full directory — 0002, 0003, 0004, then 0005 run for the first time; each does a
      //    comprehensive clean-slate REVOKE. 0003 is the final grant authority for the ingestion
      //    role; 0004 grants only the SEPARATE projection role and leaves the ingestion role's
      //    least-privilege set (and this stale-grant remediation) untouched.
      const second = await runMigrations(pool, migrationsDir);
      expect(second.applied.map((m) => m.filename)).toStrictEqual([
        '0002_event_runtime_grants.sql',
        '0003_ingestion_rejection_and_event_conflict.sql',
        '0004_projection_foundation.sql',
        '0005_projection_event_positions.sql',
        '0006_projection_failure_operations.sql',
        '0007_subject_activity_projection.sql',
      ]);

      // 5. Every stale direct privilege is gone. ALL schema_migration privileges, not only SELECT.
      for (const privilege of [
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
      ]) {
        const granted = await withClient(pool, async (client) => {
          const result = await client.query<{ granted: boolean }>(
            `SELECT has_table_privilege('qf_jarvis_runtime', 'qf_jarvis.schema_migration', $1) AS granted`,
            [privilege],
          );
          return result.rows[0]?.granted;
        });
        expect(granted).toBe(false);
      }

      const after = await withClient(pool, async (client) => {
        const seq = await client.query<{
          seq_usage: boolean;
          seq_select: boolean;
          seq_update: boolean;
        }>(
          `SELECT has_sequence_privilege('qf_jarvis_runtime', $1, 'USAGE')  AS seq_usage,
                  has_sequence_privilege('qf_jarvis_runtime', $1, 'SELECT') AS seq_select,
                  has_sequence_privilege('qf_jarvis_runtime', $1, 'UPDATE') AS seq_update`,
          [sequenceName],
        );
        const fns = await client.query<{ ev_fn: boolean; hist_fn: boolean }>(
          `SELECT has_function_privilege('qf_jarvis_runtime', 'qf_jarvis.event_reject_mutation()', 'EXECUTE') AS ev_fn,
                  has_function_privilege('qf_jarvis_runtime', 'qf_jarvis.schema_migration_reject_mutation()', 'EXECUTE') AS hist_fn`,
        );
        return { seq: seq.rows[0], fns: fns.rows[0] };
      });
      expect(after.seq?.seq_usage).toBe(false);
      expect(after.seq?.seq_select).toBe(false);
      expect(after.seq?.seq_update).toBe(false);
      expect(after.fns?.ev_fn).toBe(false);
      expect(after.fns?.hist_fn).toBe(false);

      // 6 & 7. Event INSERT and SELECT still work through the runtime role — and with NO sequence
      //        privilege at all, proving an IDENTITY column requires none.
      const record = makeRecord();
      const outcome = await storeValidatedEvent(runtimePool, record);
      expect(outcome.outcome).toBe('stored');
      const seen = await withClient(runtimePool, async (client) => {
        const result = await client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM qf_jarvis.event WHERE event_id = $1',
          [record.eventId],
        );
        return Number.parseInt(result.rows[0]?.count ?? '0', 10);
      });
      expect(seen).toBe(1);
    } finally {
      await rm(only0001, { recursive: true, force: true });
    }
  });
});

/**
 * storeValidatedEvent must ENFORCE its isolation level, not inherit the session's.
 *
 * The classification reads the committed row in a separate statement and depends on READ COMMITTED
 * snapshot behaviour. These pools default their sessions to REPEATABLE READ; the store must
 * override that per transaction, or a concurrent delivery would misclassify. The two dedicated
 * single-connection pools also give two distinct PostgreSQL backends to race across.
 */
describe('storeValidatedEvent — enforces READ COMMITTED over an ambient REPEATABLE READ default', () => {
  /**
   * A TEST-ONLY pool wrapper that runs a per-connection initializer and **fully awaits it before
   * handing the client back**. This deliberately replaces the older `pool.on('connect', c => void
   * c.query(...))` pattern: a fire-and-forget connect listener lets the pool return the client while
   * the unawaited `SET` is still in flight, so the first real query can overlap it — which trips the
   * pg "client is already executing a query" deprecation and can leave the session un-initialised.
   * Here `connect()` obtains the real client, awaits the initializer to completion, and returns the
   * client only on success; on failure it releases the client exactly once and propagates the
   * original error. Production pool behaviour is untouched — only `connect()` is wrapped, via a Proxy
   * that delegates `end`/`ended`/everything else to the real pool.
   */
  function initializedPool(real: DatabasePool, initSql: string): DatabasePool {
    const connect = async (): Promise<DatabaseClient> => {
      const client = await real.connect();
      try {
        await client.query(initSql);
      } catch (error: unknown) {
        client.release(error instanceof Error ? error : undefined);
        throw error;
      }
      return client;
    };
    return new Proxy(real, {
      get(target, prop): unknown {
        if (prop === 'connect') {
          return connect;
        }
        // Read against the real pool (getters run with `this` = target), and bind methods to it,
        // so `end`/`ended`/etc. behave exactly as the underlying pool's.
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  function repeatableReadPool(applicationName: string): DatabasePool {
    const real = createDatabasePool(
      createDatabaseConfig({
        connectionString: requireTestDatabaseUrl(),
        maxConnections: 1,
        applicationName,
      }),
    );
    // Set the SESSION default to REPEATABLE READ, AWAITED before the client is returned (see
    // initializedPool). The SHOW assertion below also proves the default really took effect.
    return initializedPool(
      real,
      'SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    );
  }

  async function sessionDefaultIsolation(target: DatabasePool): Promise<string> {
    return withClient(target, async (client) => {
      const result = await client.query<{ default_transaction_isolation: string }>(
        'SHOW default_transaction_isolation',
      );
      return result.rows[0]?.default_transaction_isolation ?? '';
    });
  }

  async function backendPid(target: DatabasePool): Promise<number> {
    return withClient(target, async (client) => {
      const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      return result.rows[0]?.pid ?? 0;
    });
  }

  it('classifies identical and conflicting races correctly across two distinct backends', async () => {
    const poolA = repeatableReadPool('qf-event-store-rr-a');
    const poolB = repeatableReadPool('qf-event-store-rr-b');
    try {
      // Non-vacuous: the ambient session default really is REPEATABLE READ on both pools.
      expect(await sessionDefaultIsolation(poolA)).toBe('repeatable read');
      expect(await sessionDefaultIsolation(poolB)).toBe('repeatable read');

      // Two dedicated single-connection pools ⇒ two distinct PostgreSQL backends.
      const pidA = await backendPid(poolA);
      const pidB = await backendPid(poolB);
      expect(pidA).toBeGreaterThan(0);
      expect(pidB).toBeGreaterThan(0);
      expect(pidA).not.toBe(pidB);

      // Identical delivery raced across the two backends: exactly one stored, one benign duplicate,
      // one row. This holds ONLY because storeValidatedEvent forces READ COMMITTED — under the
      // ambient REPEATABLE READ the loser's SELECT would reuse its INSERT-time snapshot and never
      // see the winner's committed row.
      const shared = makeRecord();
      const identical = await Promise.all([
        storeValidatedEvent(poolA, shared),
        storeValidatedEvent(poolB, shared),
      ]);
      expect(identical.map((o) => o.outcome).sort()).toStrictEqual(['duplicate', 'stored']);
      expect(await countRows(shared.eventId)).toBe(1);

      // Conflicting delivery raced across the two backends: one accepted, one typed conflict.
      const eventId = randomUUID();
      const a = makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x01) });
      const b = makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x02) });
      const raced = await Promise.allSettled([
        storeValidatedEvent(poolA, a),
        storeValidatedEvent(poolB, b),
      ]);
      const fulfilled = raced.filter((r) => r.status === 'fulfilled');
      const rejected = raced.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejection = rejected[0];
      if (rejection === undefined) {
        throw new Error('Expected exactly one conflicting delivery to be rejected');
      }
      expect(rejection.reason).toBeInstanceOf(ConflictingEventDigestError);
      // One accepted event, one conflict error — and exactly one conflict AUDIT row, recorded by
      // the losing delivery in the same transaction that classified it, across separate backends.
      expect(await countRows(eventId)).toBe(1);
      expect(await countConflicts(eventId)).toBe(1);
    } finally {
      await closeDatabasePool(poolA);
      await closeDatabasePool(poolB);
    }
  });

  it('the initialized pool AWAITS the initializer fully before returning the client', async () => {
    // Regression guard for the removed fire-and-forget connect listener: the client must never be
    // handed back while the SET is still in flight (which is what let the first real query overlap).
    const log: string[] = [];
    let initSettled = false;
    const fakeClient = {
      query: async (text: string): Promise<{ rows: never[] }> => {
        log.push(`query:${text}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        initSettled = true;
        log.push('init-settled');
        return { rows: [] };
      },
      release: (): void => {
        log.push('release');
      },
    };
    const fakeReal = {
      connect: () => Promise.resolve(fakeClient as unknown as DatabaseClient),
    } as unknown as DatabasePool;

    const client = await initializedPool(fakeReal, 'SET X').connect();

    // The client is returned ONLY after the initializer settled — no overlap window, no release.
    expect(initSettled).toBe(true);
    expect(log).toStrictEqual(['query:SET X', 'init-settled']);
    expect(client).toBe(fakeClient);
  });

  it('on initializer failure it releases the client exactly once and propagates the original error', async () => {
    const original = new Error('synthetic SET failure');
    let releaseCount = 0;
    const fakeClient = {
      query: () => Promise.reject(original),
      release: (): void => {
        releaseCount += 1;
      },
    };
    const fakeReal = {
      connect: () => Promise.resolve(fakeClient as unknown as DatabaseClient),
    } as unknown as DatabasePool;

    let caught: unknown;
    try {
      await initializedPool(fakeReal, 'SET X').connect();
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toBe(original);
    expect(releaseCount).toBe(1);
  });
});

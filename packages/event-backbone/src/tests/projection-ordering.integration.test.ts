/**
 * Stage 3.4.3 — gap-free, commit-ordered PROJECTION POSITIONS against real PostgreSQL 17
 * (migration 0005, ADR-0036).
 *
 * Proves, against a real database on loopback with synthetic fixtures only:
 *   * the deterministic one-time backfill of pre-0005 events (raw identity gaps collapse to dense
 *     positions; no event row is mutated);
 *   * duplicate/conflict behaviour through the REAL event-store path (a benign or conflicting
 *     duplicate allocates NO position; a later new event still gets the next dense position);
 *   * rollback (event + mapping + allocator roll back together; the next event REUSES the position);
 *   * concurrency + commit ordering (the allocator row lock serializes; commit order == position
 *     order; a rolled-back position is reused; no gaps, no duplicates, no deadlock);
 *   * database enforcement (ON CONFLICT allocates nothing; a missing allocator fails the insert;
 *     the map is append-only; runtime roles cannot forge gaps);
 *   * role security (the least-privilege ingestion role's INSERT fires the SECURITY DEFINER trigger
 *     yet the role has no direct allocator/mapping access; the projection role reads the map and
 *     event metadata only; managed aliases and PUBLIC have none; the definer function has a locked
 *     search_path and no PUBLIC/runtime EXECUTE);
 *   * the internal position reader returns metadata-only frozen events and never the raw identity.
 *
 * Loopback-guarded harness. No managed database, no live data.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  defaultMigrationsDirectory,
  withClient,
  type DatabaseClient,
  type DatabasePool,
} from '../index.js';
import { storeValidatedEvent, type EventPersistenceRecord } from '../persistence/event-store.js';
import { runMigrations } from '../persistence/migration-runner.js';
import { readEventAtPosition } from '../projections/projection-event-reader.js';
import { ProjectionInputError } from '../projections/projection-errors.js';
import {
  closeTestPool,
  createProjectionPool,
  createRuntimePool,
  createTestPool,
  ensureManagedRolesExist,
  ensureProjectionRoleExists,
  ensureRuntimeRoleExists,
  MANAGED_ROLES,
  PROJECTION_ROLE,
  resetTestDatabase,
  RUNTIME_ROLE,
} from './database-test-utils.js';

const RUNTIME_PASSWORD = randomUUID();
const PROJECTION_PASSWORD = randomUUID();

const admin: DatabasePool = createTestPool({ applicationName: 'qf-ordering-admin' });
let runtimePool: DatabasePool | undefined;
let projectionPool: DatabasePool | undefined;

function requireRuntimePool(): DatabasePool {
  if (runtimePool === undefined) throw new Error('runtime pool not initialised');
  return runtimePool;
}
function requireProjectionPool(): DatabasePool {
  if (projectionPool === undefined) throw new Error('projection pool not initialised');
  return projectionPool;
}

/** A well-formed synthetic record; obviously-synthetic digests and signature. */
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

/** Raw event INSERT SQL (fires the allocator trigger). Used where a controlled transaction is needed. */
const RAW_INSERT_EVENT = `
INSERT INTO qf_jarvis.event (
  event_id, event_type, event_version, source, subject_type, subject_id,
  occurred_at, emitted_at, correlation_id, payload,
  semantic_event_digest, body_digest, signature_algorithm, signature_key_id,
  signature_signed_at, signature)
VALUES ($1, 'qf.raw.event', 1, 'quickfurno-core', 'client', 'CORE-RAW-1',
  now(), now(), gen_random_uuid(), '{"raw":true}'::jsonb,
  decode(repeat('a1',32),'hex'), decode(repeat('b2',32),'hex'),
  'ed25519', 'test-key', now(), decode('c3c3','hex'))
RETURNING sequence`;

async function allocatorLastPosition(pool: DatabasePool): Promise<bigint> {
  return withClient(pool, async (c) => {
    const r = await c.query<{ last_position: string }>(
      'SELECT last_position FROM qf_jarvis.projection_event_position_allocator',
    );
    return BigInt(r.rows[0]?.last_position ?? '-1');
  });
}

async function mapRows(pool: DatabasePool): Promise<{ position: bigint; storageSeq: bigint }[]> {
  return withClient(pool, async (c) => {
    const r = await c.query<{ position: string; event_storage_sequence: string }>(
      'SELECT position, event_storage_sequence FROM qf_jarvis.projection_event_position ORDER BY position',
    );
    return r.rows.map((row) => ({
      position: BigInt(row.position),
      storageSeq: BigInt(row.event_storage_sequence),
    }));
  });
}

async function maxStorageSequence(pool: DatabasePool): Promise<bigint> {
  return withClient(pool, async (c) => {
    const r = await c.query<{ m: string | null }>(
      'SELECT max(sequence)::text AS m FROM qf_jarvis.event',
    );
    return BigInt(r.rows[0]?.m ?? '0');
  });
}

/** The backend PID of a dedicated client, for lock-state inspection. */
async function backendPid(client: DatabaseClient): Promise<number> {
  const r = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const pid = r.rows[0]?.pid;
  if (pid === undefined) throw new Error('could not read backend pid');
  return pid;
}

/**
 * Poll PostgreSQL's OWN lock state (never a fixed sleep) until `waiterPid` is actively waiting on a
 * lock AND `blockerPid` is among its blockers, using `pg_blocking_pids` + `pg_stat_activity`. Bounded
 * by `deadlineMs`, so a wrong assumption fails fast instead of hanging CI. Short sleeps appear only
 * inside this poll loop, never as the assertion.
 */
async function waitUntilBlockedBy(
  observer: DatabasePool,
  waiterPid: number,
  blockerPid: number,
  deadlineMs = 8_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const r = await withClient(observer, (c) =>
      c.query<{ blockers: number[]; wait_event_type: string | null }>(
        `SELECT pg_blocking_pids($1) AS blockers,
                (SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1) AS wait_event_type`,
        [waiterPid],
      ),
    );
    const row = r.rows[0];
    const blockers = row?.blockers ?? [];
    if (blockers.includes(blockerPid) && row?.wait_event_type === 'Lock') {
      return;
    }
    if (Date.now() - start > deadlineMs) {
      throw new Error(
        `deadline: pid ${String(waiterPid)} not blocked by ${String(blockerPid)} within ${String(
          deadlineMs,
        )}ms (blockers=${JSON.stringify(blockers)}, wait=${String(row?.wait_event_type)})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 40)); // bounded poll interval only
  }
}

beforeAll(async () => {
  await resetTestDatabase(admin);
  await ensureManagedRolesExist(admin);
  await ensureRuntimeRoleExists(admin, RUNTIME_PASSWORD);
  await ensureProjectionRoleExists(admin, PROJECTION_PASSWORD);
  await runMigrations(admin, defaultMigrationsDirectory());
  runtimePool = createRuntimePool(RUNTIME_PASSWORD, 'qf-ordering-runtime');
  projectionPool = createProjectionPool(PROJECTION_PASSWORD, 'qf-ordering-projection');
});

afterAll(async () => {
  const closes: Promise<void>[] = [];
  if (runtimePool !== undefined) closes.push(closeTestPool(runtimePool));
  if (projectionPool !== undefined) closes.push(closeTestPool(projectionPool));
  closes.push(closeTestPool(admin));
  const failures = (await Promise.allSettled(closes))
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason as unknown);
  if (failures.length > 0) throw new AggregateError(failures, 'Failed to close one or more pools');
});

// ---------------------------------------------------------------------------
// Proof 3 — duplicate/conflict behaviour through the REAL event-store path
// ---------------------------------------------------------------------------

describe('duplicate and conflict behaviour allocate positions correctly', () => {
  it('a first accepted event allocates exactly one position; a duplicate allocates none', async () => {
    const before = await allocatorLastPosition(admin);
    const record = makeRecord();

    const first = await storeValidatedEvent(admin, record);
    expect(first.outcome).toBe('stored');
    const afterFirst = await allocatorLastPosition(admin);
    expect(afterFirst).toBe(before + 1n);

    // Benign duplicate: same eventId, same digest — allocates NO position.
    const dup = await storeValidatedEvent(admin, record);
    expect(dup.outcome).toBe('duplicate');
    expect(await allocatorLastPosition(admin)).toBe(afterFirst);
  });

  it('a conflicting duplicate allocates none, and a later new event gets the NEXT dense position', async () => {
    const eventId = randomUUID();
    await storeValidatedEvent(admin, makeRecord({ eventId }));
    const afterOriginal = await allocatorLastPosition(admin);

    // Conflicting duplicate: same eventId, DIFFERENT digest — commits an audit row and throws, but
    // inserts NO event row, so it allocates no position.
    await expect(
      storeValidatedEvent(
        admin,
        makeRecord({ eventId, semanticEventDigest: Buffer.alloc(32, 0x0f) }),
      ),
    ).rejects.toThrow();
    expect(await allocatorLastPosition(admin)).toBe(afterOriginal);

    // A later genuinely-new event receives the immediately following dense position, even though the
    // raw identity has advanced past the consumed values.
    const next = await storeValidatedEvent(admin, makeRecord());
    expect(next.outcome).toBe('stored');
    expect(await allocatorLastPosition(admin)).toBe(afterOriginal + 1n);
  });

  it('positions are dense even though raw storage identity has gaps', async () => {
    const rows = await mapRows(admin);
    const positions = rows.map((r) => r.position);
    // Dense 1..N with no gaps.
    for (let i = 0; i < positions.length; i += 1) {
      expect(positions[i]).toBe(BigInt(i + 1));
    }
    // The raw storage sequences are strictly increasing but NOT necessarily contiguous.
    const seqs = rows.map((r) => r.storageSeq);
    let strictlyIncreasing = true;
    let hasGap = false;
    for (let i = 1; i < seqs.length; i += 1) {
      const prev = seqs[i - 1];
      const cur = seqs[i];
      if (prev === undefined || cur === undefined || cur <= prev) strictlyIncreasing = false;
      if (prev !== undefined && cur !== undefined && cur !== prev + 1n) hasGap = true;
    }
    expect(strictlyIncreasing).toBe(true);
    // At least one gap exists in the raw identity (a duplicate/conflict consumed a value).
    expect(hasGap).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Proof 4 — rollback: event + mapping + allocator roll back together
// ---------------------------------------------------------------------------

describe('a rolled-back event insertion reuses its projection position', () => {
  it('rolls back the position with the event and reuses it on the next commit', async () => {
    const before = await allocatorLastPosition(admin);
    const client = await admin.connect();
    let rolledBackSeq: string | undefined;
    try {
      await client.query('BEGIN');
      const r = await client.query<{ sequence: string }>(RAW_INSERT_EVENT, [randomUUID()]);
      rolledBackSeq = r.rows[0]?.sequence;
      // Inside the txn the allocator advanced by 1.
      const inTxn = await client.query<{ last_position: string }>(
        'SELECT last_position FROM qf_jarvis.projection_event_position_allocator',
      );
      expect(BigInt(inTxn.rows[0]?.last_position ?? '-1')).toBe(before + 1n);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // After rollback the allocator is unchanged and no orphan mapping row exists.
    expect(await allocatorLastPosition(admin)).toBe(before);
    const orphan = await withClient(admin, (c) =>
      c.query(
        'SELECT 1 FROM qf_jarvis.projection_event_position WHERE event_storage_sequence = $1',
        [rolledBackSeq],
      ),
    );
    expect(orphan.rowCount).toBe(0);

    // The next committed event reuses the rolled-back projection position (still dense).
    const next = await storeValidatedEvent(admin, makeRecord());
    expect(next.outcome).toBe('stored');
    expect(await allocatorLastPosition(admin)).toBe(before + 1n);
  });
});

// ---------------------------------------------------------------------------
// Proof 5 — concurrency and commit ordering (separate clients)
// ---------------------------------------------------------------------------

describe('concurrent event inserts serialize on the allocator and stay dense', () => {
  it('B waits on the allocator lock A holds (proven via pg_blocking_pids); commit order == position order', async () => {
    const posBefore = await allocatorLastPosition(admin);
    const seqBefore = await maxStorageSequence(admin);
    const a = await admin.connect();
    const b = await admin.connect();
    // The pending B insert; tracked so cleanup can always settle it.
    let bInsert: Promise<{ rows: { sequence: string }[] }> | undefined;
    let aOpen = false;
    let bOpen = false;
    try {
      const aPid = await backendPid(a);
      const bPid = await backendPid(b);

      await a.query('BEGIN');
      aOpen = true;
      const ra = await a.query<{ sequence: string }>(RAW_INSERT_EVENT, [randomUUID()]);
      const seqA = BigInt(ra.rows[0]?.sequence ?? '-1');

      // B begins and issues its insert with a BOUNDED statement timeout so nothing can hang CI.
      await b.query('BEGIN');
      bOpen = true;
      await b.query("SET LOCAL statement_timeout = '15000'");
      bInsert = b.query<{ sequence: string }>(RAW_INSERT_EVENT, [randomUUID()]);

      // PROOF (not a timer): B is actively waiting on a Lock, and A is its blocker.
      await waitUntilBlockedBy(admin, bPid, aPid);

      // Commit A -> B proceeds and gets the NEXT position.
      await a.query('COMMIT');
      aOpen = false;
      const rb = await bInsert;
      bInsert = undefined;
      const seqB = BigInt(rb.rows[0]?.sequence ?? '-1');
      await b.query('COMMIT');
      bOpen = false;

      // Exact storage-sequence mapping (A first, then B — no conflict/rollback between them).
      expect(seqA).toBe(seqBefore + 1n);
      expect(seqB).toBe(seqBefore + 2n);

      // Commit order == position order: A -> posBefore+1, B -> posBefore+2.
      const rows = await mapRows(admin);
      const byPosition = new Map(rows.map((r) => [r.position, r.storageSeq]));
      expect(byPosition.get(posBefore + 1n)).toBe(seqA);
      expect(byPosition.get(posBefore + 2n)).toBe(seqB);
      expect(await allocatorLastPosition(admin)).toBe(posBefore + 2n);
      const positions = rows.map((r) => r.position);
      expect(new Set(positions).size).toBe(positions.length); // no duplicate positions
    } finally {
      // Failure-safe: release A's lock first (unblocks B), settle B's pending insert, roll both back.
      if (aOpen) await a.query('ROLLBACK').catch(() => undefined);
      if (bInsert !== undefined) await bInsert.catch(() => undefined);
      if (bOpen) await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  });

  it('if A rolls back, B (proven blocked) reuses A’s position and no A row remains', async () => {
    const posBefore = await allocatorLastPosition(admin);
    const seqBefore = await maxStorageSequence(admin);
    const a = await admin.connect();
    const b = await admin.connect();
    const aEventId = randomUUID();
    let bInsert: Promise<{ rows: { sequence: string }[] }> | undefined;
    let aOpen = false;
    let bOpen = false;
    try {
      const aPid = await backendPid(a);
      const bPid = await backendPid(b);

      await a.query('BEGIN');
      aOpen = true;
      const ra = await a.query<{ sequence: string }>(RAW_INSERT_EVENT, [aEventId]);
      const seqA = BigInt(ra.rows[0]?.sequence ?? '-1'); // consumes an identity permanently

      await b.query('BEGIN');
      bOpen = true;
      await b.query("SET LOCAL statement_timeout = '15000'");
      bInsert = b.query<{ sequence: string }>(RAW_INSERT_EVENT, [randomUUID()]);

      // PROOF: B is blocked by A.
      await waitUntilBlockedBy(admin, bPid, aPid);

      // Roll A back -> its event and its would-be position are discarded; B proceeds.
      await a.query('ROLLBACK');
      aOpen = false;
      const rb = await bInsert;
      bInsert = undefined;
      const seqB = BigInt(rb.rows[0]?.sequence ?? '-1');
      await b.query('COMMIT');
      bOpen = false;

      // No event or map row remains for A's storage sequence.
      const aEventCount = await withClient(admin, (c) =>
        c.query('SELECT 1 FROM qf_jarvis.event WHERE sequence = $1', [seqA.toString()]),
      );
      expect(aEventCount.rowCount).toBe(0);
      const aMapCount = await withClient(admin, (c) =>
        c.query(
          'SELECT 1 FROM qf_jarvis.projection_event_position WHERE event_storage_sequence = $1',
          [seqA.toString()],
        ),
      );
      expect(aMapCount.rowCount).toBe(0);

      // B REUSES A's position: allocator advanced by exactly 1, and B maps to posBefore+1.
      // B's raw storage identity is seqBefore+2 (A consumed seqBefore+1 permanently).
      expect(seqB).toBe(seqBefore + 2n);
      const rows = await mapRows(admin);
      const byPosition = new Map(rows.map((r) => [r.position, r.storageSeq]));
      expect(byPosition.get(posBefore + 1n)).toBe(seqB);
      expect(await allocatorLastPosition(admin)).toBe(posBefore + 1n);
    } finally {
      if (aOpen) await a.query('ROLLBACK').catch(() => undefined);
      if (bInsert !== undefined) await bInsert.catch(() => undefined);
      if (bOpen) await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  });

  it('many concurrent DISTINCT events produce dense positions with no duplicates and no deadlock', async () => {
    const before = await allocatorLastPosition(admin);
    const N = 12;
    await Promise.all(Array.from({ length: N }, () => storeValidatedEvent(admin, makeRecord())));
    const after = await allocatorLastPosition(admin);
    expect(after).toBe(before + BigInt(N));

    const rows = await mapRows(admin);
    const positions = rows.map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
    // Still fully dense 1..N overall.
    for (let i = 0; i < positions.length; i += 1) {
      expect(positions[i]).toBe(BigInt(i + 1));
    }
  });

  it('concurrent IDENTICAL event ids produce exactly one event and one position', async () => {
    const before = await allocatorLastPosition(admin);
    const record = makeRecord();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => storeValidatedEvent(admin, record)),
    );
    const stored = results.filter((r) => r.outcome === 'stored');
    const duplicate = results.filter((r) => r.outcome === 'duplicate');
    expect(stored).toHaveLength(1);
    expect(duplicate).toHaveLength(5);
    // Exactly ONE position allocated for the single winning insert.
    expect(await allocatorLastPosition(admin)).toBe(before + 1n);
  });
});

// ---------------------------------------------------------------------------
// Proof 6 — database enforcement
// ---------------------------------------------------------------------------

describe('the database enforces the invariant on every INSERT path', () => {
  it('a direct valid SQL INSERT receives a mapping; ON CONFLICT DO NOTHING allocates none', async () => {
    const before = await allocatorLastPosition(admin);
    const eventId = randomUUID();
    await withClient(admin, (c) => c.query(RAW_INSERT_EVENT, [eventId]));
    expect(await allocatorLastPosition(admin)).toBe(before + 1n);

    // Re-insert the same event_id with ON CONFLICT DO NOTHING: no row, so no AFTER INSERT allocation.
    await withClient(admin, (c) =>
      c.query(
        `${RAW_INSERT_EVENT.replace('RETURNING sequence', '')}
         ON CONFLICT ON CONSTRAINT event_event_id_unique DO NOTHING`,
        [eventId],
      ),
    );
    expect(await allocatorLastPosition(admin)).toBe(before + 1n);
  });

  it('a missing allocator singleton makes the event INSERT fail and roll back', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      // Remove the singleton within this transaction; the trigger will then find no row.
      await client.query('DELETE FROM qf_jarvis.projection_event_position_allocator');
      await expect(client.query(RAW_INSERT_EVENT, [randomUUID()])).rejects.toThrow(
        /allocator singleton row is missing/,
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // The allocator row is intact (the delete rolled back with the failed insert).
    const n = await withClient(admin, (c) =>
      c.query('SELECT count(*)::int AS n FROM qf_jarvis.projection_event_position_allocator'),
    );
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });

  it('the position map is append-only — UPDATE and DELETE are refused', async () => {
    await expect(
      withClient(admin, (c) =>
        c.query('UPDATE qf_jarvis.projection_event_position SET position = position + 1000'),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withClient(admin, (c) => c.query('DELETE FROM qf_jarvis.projection_event_position')),
    ).rejects.toThrow(/append-only/);
  });

  it('a mapping row cannot reference a non-existent event (FK integrity)', async () => {
    await expect(
      withClient(admin, (c) =>
        c.query(
          'INSERT INTO qf_jarvis.projection_event_position (position, event_storage_sequence) VALUES (999999, 88888888)',
        ),
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Proof 7 — role security
// ---------------------------------------------------------------------------

describe('role security — least-privilege ingestion and projection roles', () => {
  it('the ingestion role can insert an event and the SECURITY DEFINER trigger allocates a position', async () => {
    const before = await allocatorLastPosition(admin);
    const record = makeRecord();
    // Connect AS the least-privilege ingestion role; it has INSERT on event only.
    const outcome = await storeValidatedEvent(requireRuntimePool(), record);
    expect(outcome.outcome).toBe('stored');
    expect(await allocatorLastPosition(admin)).toBe(before + 1n);
  });

  it('the ingestion role CANNOT read or mutate the allocator or the map directly', async () => {
    const runtime = requireRuntimePool();
    await expect(
      withClient(runtime, (c) =>
        c.query('SELECT last_position FROM qf_jarvis.projection_event_position_allocator'),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withClient(runtime, (c) =>
        c.query('SELECT position FROM qf_jarvis.projection_event_position'),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withClient(runtime, (c) =>
        c.query('UPDATE qf_jarvis.projection_event_position_allocator SET last_position = 0'),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withClient(runtime, (c) =>
        c.query(
          'INSERT INTO qf_jarvis.projection_event_position (position, event_storage_sequence) VALUES (1, 1)',
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('the ingestion role cannot call the SECURITY DEFINER function directly', async () => {
    await expect(
      withClient(requireRuntimePool(), (c) =>
        c.query('SELECT qf_jarvis.assign_projection_event_position()'),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('the projection role can read the map (columns) but not the allocator or a payload', async () => {
    const projection = requireProjectionPool();
    // Can read the map's granted columns.
    await expect(
      withClient(projection, (c) =>
        c.query('SELECT position, event_storage_sequence FROM qf_jarvis.projection_event_position'),
      ),
    ).resolves.toBeDefined();
    // Cannot read the allocator at all.
    await expect(
      withClient(projection, (c) =>
        c.query('SELECT last_position FROM qf_jarvis.projection_event_position_allocator'),
      ),
    ).rejects.toThrow(/permission denied/);
    // Cannot read a payload from the event log.
    await expect(
      withClient(projection, (c) => c.query('SELECT payload FROM qf_jarvis.event')),
    ).rejects.toThrow(/permission denied/);
    // Cannot mutate the map.
    await expect(
      withClient(projection, (c) => c.query('DELETE FROM qf_jarvis.projection_event_position')),
    ).rejects.toThrow(/permission denied|append-only/);
  });

  it('managed aliases and PUBLIC have no access to the allocator, map, or definer function', async () => {
    for (const role of MANAGED_ROLES) {
      const map = await withClient(admin, (c) =>
        c.query<{ g: boolean }>('SELECT has_table_privilege($1, $2, $3) AS g', [
          role,
          'qf_jarvis.projection_event_position',
          'SELECT',
        ]),
      );
      expect(map.rows[0]?.g).toBe(false);
      const alloc = await withClient(admin, (c) =>
        c.query<{ g: boolean }>('SELECT has_table_privilege($1, $2, $3) AS g', [
          role,
          'qf_jarvis.projection_event_position_allocator',
          'SELECT',
        ]),
      );
      expect(alloc.rows[0]?.g).toBe(false);
    }
  });

  it('the definer function has a locked search_path and grants EXECUTE to no runtime role or PUBLIC', async () => {
    const info = await withClient(admin, (c) =>
      c.query<{ secdef: boolean; config: string[] | null; acl: string | null }>(
        `SELECT p.prosecdef AS secdef,
                p.proconfig AS config,
                pg_catalog.array_to_string(p.proacl, ',') AS acl
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'qf_jarvis' AND p.proname = 'assign_projection_event_position'`,
      ),
    );
    const row = info.rows[0];
    expect(row?.secdef).toBe(true);
    expect(row?.config).toEqual(['search_path=pg_catalog, pg_temp']);
    // EXECUTE availability to the runtime/projection roles and PUBLIC:
    for (const role of [RUNTIME_ROLE, PROJECTION_ROLE]) {
      const g = await withClient(admin, (c) =>
        c.query<{ g: boolean }>('SELECT has_function_privilege($1, $2, $3) AS g', [
          role,
          'qf_jarvis.assign_projection_event_position()',
          'EXECUTE',
        ]),
      );
      expect(g.rows[0]?.g).toBe(false);
    }
    const pub = await withClient(admin, (c) =>
      c.query<{ g: boolean }>('SELECT has_function_privilege($1, $2, $3) AS g', [
        'public',
        'qf_jarvis.assign_projection_event_position()',
        'EXECUTE',
      ]),
    );
    expect(pub.rows[0]?.g).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Proof 8 (integration part) — the internal position reader
// ---------------------------------------------------------------------------

describe('the internal position reader returns metadata-only frozen events', () => {
  it('resolves a position to exactly {position, eventType, eventVersion, acceptedAt}, frozen', async () => {
    const record = makeRecord({ eventType: 'qf.reader.probe', eventVersion: 3 });
    await storeValidatedEvent(admin, record);
    const top = await allocatorLastPosition(admin);

    const event = await withClient(admin, (c) => readEventAtPosition(c, top));
    expect(event).not.toBeNull();
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.keys(event as object).sort()).toEqual([
      'acceptedAt',
      'eventType',
      'eventVersion',
      'position',
    ]);
    expect(event?.position).toBe(top);
    expect(event?.eventType).toBe('qf.reader.probe');
    expect(event?.eventVersion).toBe(3);
    expect(typeof event?.acceptedAt).toBe('string');
    // The raw storage identity is NOT exposed on the returned object.
    expect(event as object).not.toHaveProperty('sequence');
    expect(event as object).not.toHaveProperty('event_storage_sequence');
    expect(event as object).not.toHaveProperty('payload');
  });

  it('returns null for a position with no mapped event yet', async () => {
    const top = await allocatorLastPosition(admin);
    const event = await withClient(admin, (c) => readEventAtPosition(c, top + 10_000n));
    expect(event).toBeNull();
  });

  it('rejects a non-positive position before any SQL', async () => {
    await expect(withClient(admin, (c) => readEventAtPosition(c, 0n))).rejects.toThrow(
      ProjectionInputError,
    );
    await expect(withClient(admin, (c) => readEventAtPosition(c, -1n))).rejects.toThrow(
      ProjectionInputError,
    );
  });
});

// ---------------------------------------------------------------------------
// Proof 2 — deterministic one-time backfill of PRE-0005 events
// ---------------------------------------------------------------------------

describe('migration 0005 backfills pre-existing events deterministically', () => {
  it('assigns dense positions 1..N in raw-storage order without mutating any event row', async () => {
    // Build a migrations directory that stops at 0004, so we can create a realistic PRE-0005 database
    // with raw-identity gaps, then apply ONLY 0005 and prove the backfill. This uses a temp directory;
    // the production migrator is unchanged (no target-version support is added).
    const dir = await mkdtemp(join(tmpdir(), 'qf-0005-backfill-'));
    try {
      const src = defaultMigrationsDirectory();
      for (const f of [
        '0001_event_log.sql',
        '0002_event_runtime_grants.sql',
        '0003_ingestion_rejection_and_event_conflict.sql',
        '0004_projection_foundation.sql',
      ]) {
        await copyFile(join(src, f), join(dir, f));
      }

      await resetTestDatabase(admin);
      await ensureManagedRolesExist(admin);
      await ensureRuntimeRoleExists(admin, RUNTIME_PASSWORD);
      await ensureProjectionRoleExists(admin, PROJECTION_PASSWORD);
      await runMigrations(admin, dir); // 0001..0004 only — NO allocator/trigger yet.

      // Create events with RAW IDENTITY GAPS (benign duplicates consume identity values).
      const idA = randomUUID();
      const idB = randomUUID();
      await storeValidatedEvent(admin, makeRecord({ eventId: idA }));
      await storeValidatedEvent(admin, makeRecord({ eventId: idA })); // duplicate: consumes an identity
      await storeValidatedEvent(admin, makeRecord({ eventId: idB }));

      const rawSeqs = await withClient(admin, (c) =>
        c.query<{ sequence: string }>('SELECT sequence FROM qf_jarvis.event ORDER BY sequence'),
      );
      const seqs = rawSeqs.rows.map((r) => BigInt(r.sequence));
      expect(seqs).toHaveLength(2);
      const [seq0, seq1] = seqs;
      expect(seq0).toBeDefined();
      expect(seq1).toBeDefined();
      // The raw identity has a gap (the duplicate consumed one).
      expect((seq1 ?? 0n) > (seq0 ?? 0n) + 1n).toBe(true);

      // Snapshot the events to prove 0005 does not mutate them.
      const beforeEvents = await withClient(admin, (c) =>
        c.query('SELECT sequence, event_id, accepted_at FROM qf_jarvis.event ORDER BY sequence'),
      );

      // Now apply 0005 (copy it in and re-run the migrator).
      await copyFile(
        join(src, '0005_projection_event_positions.sql'),
        join(dir, '0005_projection_event_positions.sql'),
      );
      const applied = await runMigrations(admin, dir);
      expect(applied.applied.map((m) => m.filename)).toStrictEqual([
        '0005_projection_event_positions.sql',
      ]);

      // Backfill: dense 1..N ordered by raw storage sequence.
      const map = await mapRows(admin);
      expect(map).toHaveLength(2);
      expect(map[0]).toEqual({ position: 1n, storageSeq: seqs[0] });
      expect(map[1]).toEqual({ position: 2n, storageSeq: seqs[1] });

      // Allocator ends at N.
      expect(await allocatorLastPosition(admin)).toBe(2n);

      // Every existing event has exactly one mapping; no event row was mutated.
      const afterEvents = await withClient(admin, (c) =>
        c.query('SELECT sequence, event_id, accepted_at FROM qf_jarvis.event ORDER BY sequence'),
      );
      expect(afterEvents.rows).toStrictEqual(beforeEvents.rows);
      const mapped = await withClient(admin, (c) =>
        c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM qf_jarvis.event e
           WHERE NOT EXISTS (SELECT 1 FROM qf_jarvis.projection_event_position m
                             WHERE m.event_storage_sequence = e.sequence)`,
        ),
      );
      expect((mapped.rows[0] as { n: number }).n).toBe(0);

      // A NEW event after backfill continues densely at N+1.
      await storeValidatedEvent(admin, makeRecord());
      expect(await allocatorLastPosition(admin)).toBe(3n);
    } finally {
      await rm(dir, { recursive: true, force: true });
      // Restore the full schema for any later file that shares this database.
      await resetTestDatabase(admin);
      await runMigrations(admin, defaultMigrationsDirectory());
    }
  });
});

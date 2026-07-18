/**
 * Stage 3.3.5 — restart and fault behaviour for the complete `createEventIngestor` boundary, against
 * real PostgreSQL 17 (ADR-0033).
 *
 * These prove idempotent recovery across process/connection boundaries and under two faults that a
 * real deployment must survive:
 *
 * - **Pool restart** — closing the runtime pool and re-ingesting the same signed event returns a
 *   duplicate, not a second accepted row; a conflicting redelivery after a restart still records one
 *   conflict and throws.
 * - **Pre-COMMIT callback failure** — PostgreSQL executes the event INSERT, the transaction callback
 *   then fails BEFORE COMMIT, and **production `withTransaction` issues the ROLLBACK** (the test
 *   injector issues no statements of its own). COMMIT is never attempted, the uncommitted write
 *   disappears, and a healthy retry stores exactly once.
 * - **Unknown COMMIT result (acknowledgement loss)** — the server COMMITs but the caller receives a
 *   connection-lost error. A commit error is NOT assumed to mean rollback: the row is durable, and
 *   the recovery mechanism is an eventId-idempotent RETRY, which returns `duplicate` and leaves
 *   exactly one accepted row. This is a DIFFERENT failure class from the pre-COMMIT callback failure.
 *
 * The two faults are injected by a TEST-ONLY pool wrapper — no production failpoint or debug hook is
 * added. All fixtures are synthetic; no managed database and no live transport.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ConflictingEventDigestError,
  withClient,
  type DatabaseClient,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';

import { createEventIngestor, type EventIngestor, type IngestResult } from '../index.js';
import { TEST_KEY_ID, testRegistry } from './fixtures/registry.js';
import { signEnvelope } from './fixtures/signer.js';
import { testPrivateKey } from './fixtures/test-keys.js';
import { VALID_CANONICAL_EVENT } from './fixtures/canonical-event.js';
import {
  closeTestPool,
  createRuntimePool,
  createTestPool,
  ensureManagedRolesExist,
  ensureRuntimeRoleExists,
  migrateTestDatabase,
  resetSchema,
} from './fixtures/db-harness.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const SIGNED_AT = '2026-07-15T12:00:00.000Z';

const adminPool: DatabasePool = createTestPool('qf-ingest-fault-admin');
const RUNTIME_PASSWORD = randomUUID();
const registry = testRegistry();

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sign(rawBody: Uint8Array): unknown {
  return signEnvelope({
    rawBody,
    keyId: TEST_KEY_ID,
    signedAt: SIGNED_AT,
    privateKey: testPrivateKey,
  });
}

function validSigned(overrides: Record<string, unknown> = {}): {
  rawBody: Uint8Array;
  envelope: unknown;
} {
  const rawBody = jsonBytes({ ...VALID_CANONICAL_EVENT, ...overrides });
  return { rawBody, envelope: sign(rawBody) };
}

async function countEvents(eventId: string): Promise<number> {
  return withClient(adminPool, async (client) => {
    const r = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM qf_jarvis.event WHERE event_id = $1`,
      [eventId],
    );
    return Number.parseInt(r.rows[0]?.count ?? '0', 10);
  });
}

async function countConflicts(eventId: string): Promise<number> {
  return withClient(adminPool, async (client) => {
    const r = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM qf_jarvis.event_conflict WHERE event_id = $1`,
      [eventId],
    );
    return Number.parseInt(r.rows[0]?.count ?? '0', 10);
  });
}

/** The TOTAL ingestion_rejection row count (rejections carry no eventId), for before/after deltas. */
async function countRejections(): Promise<number> {
  return withClient(adminPool, async (client) => {
    const r = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM qf_jarvis.ingestion_rejection`,
    );
    return Number.parseInt(r.rows[0]?.count ?? '0', 10);
  });
}

/** The first SQL keyword, uppercased — enough to recognise INSERT / COMMIT / ROLLBACK. */
function firstVerb(text: string): string {
  return text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
}

/**
 * A per-statement fault. `forward()` runs the CURRENT statement on the real client and resolves with
 * its result. A fault decides what to do around that — it never issues extra statements of its own,
 * so it can never manufacture a rollback: any ROLLBACK observed in a test comes from PRODUCTION
 * `withTransaction`, not from the injector.
 */
type ClientFault = (verb: string, forward: () => Promise<unknown>) => Promise<unknown>;

/** A faulty pool plus the ordered log of every SQL verb the store issued through it. */
interface FaultyPool {
  readonly pool: DatabasePool;
  readonly observed: string[];
}

/**
 * Wrap a real pool so borrowed clients pass every statement through `fault`, recording the verb of
 * each attempted statement in order. TEST-ONLY: the production `pool`/`withTransaction` path is
 * unchanged; this only decorates `connect()`.
 */
function makeFaultyPool(real: DatabasePool, fault: ClientFault): FaultyPool {
  const observed: string[] = [];
  const connect = async (): Promise<DatabaseClient> => {
    const client = await real.connect();
    const rawQuery = (client.query as (t: string, v?: unknown[]) => Promise<unknown>).bind(client);
    const wrapped = {
      query: (text: string, values?: unknown[]): Promise<unknown> => {
        const verb = firstVerb(text);
        observed.push(verb); // the ATTEMPTED statement, whether or not the fault forwards it
        return fault(verb, () => rawQuery(text, values));
      },
      release: (err?: Error): void => {
        client.release(err);
      },
    };
    return wrapped as unknown as DatabaseClient;
  };
  return { pool: { connect } as unknown as DatabasePool, observed };
}

/**
 * A REAL pre-commit callback failure. The event INSERT is **forwarded and completes on PostgreSQL**
 * (its row exists inside the still-open transaction); only AFTER the real INSERT result resolves does
 * the fault throw, so the failure surfaces from the store's transaction callback BEFORE control ever
 * returns to `withTransaction`'s COMMIT. The injector issues NO ROLLBACK and never touches COMMIT —
 * production `withTransaction` observes the callback rejection and runs ROLLBACK itself.
 */
function failAfterInsertBeforeCommitOnce(): ClientFault {
  let armed = true;
  return async (verb, forward) => {
    const result = await forward(); // the real statement (incl. the event INSERT) reaches PostgreSQL
    if (armed && verb === 'INSERT') {
      armed = false;
      throw new Error('synthetic failure after PostgreSQL INSERT and before COMMIT');
    }
    return result;
  };
}

/**
 * Let COMMIT reach the server (the row IS durably committed), then throw a connection-lost error to
 * the caller exactly once — the ambiguous "unknown commit result" a real client can observe.
 */
function commitThenLoseAckOnce(): ClientFault {
  let armed = true;
  return async (verb, forward) => {
    const result = await forward();
    if (armed && verb === 'COMMIT') {
      armed = false;
      throw new Error('synthetic connection reset after server COMMIT');
    }
    return result;
  };
}

beforeAll(async () => {
  await resetSchema(adminPool);
  await ensureManagedRolesExist(adminPool);
  await ensureRuntimeRoleExists(adminPool, RUNTIME_PASSWORD);
  await migrateTestDatabase(adminPool, 'qf-ingest-fault-migrate');
});

afterAll(async () => {
  await closeTestPool(adminPool);
});

// ---------------------------------------------------------------------------
// A + B. Pool restart
// ---------------------------------------------------------------------------

describe('A/B. pool restart — idempotency survives a fresh pool', () => {
  it('re-ingesting the same event through a NEW runtime pool returns duplicate, not a second row', async () => {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });

    const pool1 = createRuntimePool(RUNTIME_PASSWORD, 'qf-fault-restart-1');
    const stored = await createEventIngestor({ pool: pool1, keyRegistry: registry }).ingest(
      rawBody,
      envelope,
      NOW,
    );
    expect(stored.outcome).toBe('stored');
    await closeTestPool(pool1); // full pool shutdown

    const pool2 = createRuntimePool(RUNTIME_PASSWORD, 'qf-fault-restart-2');
    const again = await createEventIngestor({ pool: pool2, keyRegistry: registry }).ingest(
      rawBody,
      envelope,
      NOW,
    );
    await closeTestPool(pool2);

    expect(again.outcome).toBe('duplicate');
    if (again.outcome === 'duplicate' && stored.outcome === 'stored') {
      expect(again.sequence).toBe(stored.sequence);
    }
    expect(await countEvents(eventId)).toBe(1);
  });

  it('a conflicting redelivery after a restart records one conflict and throws', async () => {
    const eventId = randomUUID();
    const original = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });

    const pool1 = createRuntimePool(RUNTIME_PASSWORD, 'qf-fault-restart-3');
    await createEventIngestor({ pool: pool1, keyRegistry: registry }).ingest(
      original.rawBody,
      original.envelope,
      NOW,
    );
    await closeTestPool(pool1);

    const conflicting = validSigned({ eventId, emittedAt: '2026-07-11T09:00:09Z' });
    const pool2 = createRuntimePool(RUNTIME_PASSWORD, 'qf-fault-restart-4');
    const ingestor2 = createEventIngestor({ pool: pool2, keyRegistry: registry });
    let thrown: unknown;
    try {
      await ingestor2.ingest(conflicting.rawBody, conflicting.envelope, NOW);
    } catch (error: unknown) {
      thrown = error;
    }
    await closeTestPool(pool2);

    expect(thrown).toBeInstanceOf(ConflictingEventDigestError);
    expect(await countConflicts(eventId)).toBe(1);
    expect(await countEvents(eventId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C. Failure AFTER the INSERT, BEFORE COMMIT — production withTransaction rolls back
// ---------------------------------------------------------------------------

describe('C. pre-COMMIT callback failure — PostgreSQL ran the INSERT, the callback then failed, and PRODUCTION withTransaction issued ROLLBACK (COMMIT never attempted)', () => {
  it('INSERT reaches PostgreSQL, the callback throws, withTransaction ROLLS BACK, and a healthy retry stores exactly once', async () => {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });

    // Capture the rejection count BEFORE, to prove an infrastructure failure adds no rejection row.
    const rejectionsBefore = await countRejections();

    const faulty = makeFaultyPool(adminPool, failAfterInsertBeforeCommitOnce());
    const faultyIngestor: EventIngestor = createEventIngestor({
      pool: faulty.pool,
      keyRegistry: registry,
    });

    // The caller sees the ORIGINAL synthetic INFRASTRUCTURE error, not a domain result.
    let thrown: unknown;
    try {
      await faultyIngestor.ingest(rawBody, envelope, NOW);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ConflictingEventDigestError);
    expect((thrown as Error).message).toBe(
      'synthetic failure after PostgreSQL INSERT and before COMMIT',
    );

    // The EXACT observed sequence proves the real production path: BEGIN, then SET TRANSACTION
    // ISOLATION LEVEL READ COMMITTED, then the event INSERT (forwarded and completed on PostgreSQL),
    // then ROLLBACK — issued by production `withTransaction`'s callback-error path, NOT by the
    // injector (which issues no statements of its own). COMMIT is NEVER attempted.
    expect(faulty.observed).toStrictEqual(['BEGIN', 'SET', 'INSERT', 'ROLLBACK']);
    expect(faulty.observed).not.toContain('COMMIT');

    // The uncommitted write disappeared: no event row, no conflict row, and — because this was an
    // infrastructure failure, not a domain rejection — no ingestion_rejection row was added.
    expect(await countEvents(eventId)).toBe(0);
    expect(await countConflicts(eventId)).toBe(0);
    expect(await countRejections()).toBe(rejectionsBefore);

    // A healthy retry stores exactly once, with no conflict row and still no new rejection.
    const healthy = createEventIngestor({ pool: adminPool, keyRegistry: registry });
    const retry = await healthy.ingest(rawBody, envelope, NOW);
    expect(retry.outcome).toBe('stored');
    expect(await countEvents(eventId)).toBe(1);
    expect(await countConflicts(eventId)).toBe(0);
    expect(await countRejections()).toBe(rejectionsBefore);
  });
});

// ---------------------------------------------------------------------------
// D. Unknown COMMIT result (acknowledgement loss)
// ---------------------------------------------------------------------------

describe('D. unknown COMMIT result — the row is durable; idempotent retry recovers', () => {
  it('surfaces an infrastructure error after a real commit, and a retry returns duplicate', async () => {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });

    const faultyIngestor: EventIngestor = createEventIngestor({
      pool: makeFaultyPool(adminPool, commitThenLoseAckOnce()).pool,
      keyRegistry: registry,
    });

    // 1. The server COMMITs, but the caller observes a connection-lost error — an ambiguous result.
    let thrown: unknown;
    try {
      await faultyIngestor.ingest(rawBody, envelope, NOW);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ConflictingEventDigestError);
    expect((thrown as Error).message).toContain('after server COMMIT');

    // 2. The row IS durable — a commit error must NOT be assumed to mean rollback.
    expect(await countEvents(eventId)).toBe(1);

    // 3. The recovery mechanism is an eventId-idempotent retry through a healthy pool.
    const healthy = createEventIngestor({ pool: adminPool, keyRegistry: registry });
    const retry: IngestResult = await healthy.ingest(rawBody, envelope, NOW);
    expect(retry.outcome).toBe('duplicate');

    // 4. Still exactly one accepted row — the retry created nothing new.
    expect(await countEvents(eventId)).toBe(1);
  });
});

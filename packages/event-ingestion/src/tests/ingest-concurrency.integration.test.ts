/**
 * Stage 3.3.5 — concurrency, duplicate-key policy and transaction-isolation proofs for the complete
 * `createEventIngestor` boundary, against real PostgreSQL 17 (ADR-0033).
 *
 * These prove the boundary is correct under real concurrent clients at READ COMMITTED: identical
 * deliveries collapse to one stored row with the rest benign duplicates; conflicting deliveries
 * preserve exactly one accepted event and append one conflict row per refused conflicting delivery;
 * independent events never interfere; the least-privileged runtime role races the same way with no
 * broadened privilege; and a duplicate object member name is refused with the fixed
 * contract-validation-failed / invalid-format mapping, recording nothing sender-controlled.
 *
 * All fixtures are synthetic. No live QuickFurno data, no managed database, no live transport.
 */
import { createHash, randomUUID } from 'node:crypto';

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
import { testPrivateKey, altPrivateKey } from './fixtures/test-keys.js';
import { VALID_CANONICAL_EVENT } from './fixtures/canonical-event.js';
import {
  closeTestPool,
  createRuntimePool,
  createTestPool,
  ensureManagedRolesExist,
  ensureRuntimeRoleExists,
  migrateTestDatabase,
  resetSchema,
  RUNTIME_ROLE,
} from './fixtures/db-harness.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const SIGNED_AT = '2026-07-15T12:00:00.000Z';

// Wide pools so many ingests are genuinely in flight at once — a real race, not a queue of one.
const pool: DatabasePool = createTestPool('qf-ingest-conc', 24);
const RUNTIME_PASSWORD = randomUUID();
const runtimePool: DatabasePool = createRuntimePool(RUNTIME_PASSWORD, 'qf-ingest-conc-runtime', 24);

const registry = testRegistry();
const ingestor: EventIngestor = createEventIngestor({ pool, keyRegistry: registry });
const runtimeIngestor: EventIngestor = createEventIngestor({
  pool: runtimePool,
  keyRegistry: registry,
});

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sign(rawBody: Uint8Array, privateKey = testPrivateKey): unknown {
  return signEnvelope({ rawBody, keyId: TEST_KEY_ID, signedAt: SIGNED_AT, privateKey });
}

/** A valid signed canonical event with optional overrides. */
function validSigned(overrides: Record<string, unknown> = {}): {
  rawBody: Uint8Array;
  envelope: unknown;
} {
  const rawBody = jsonBytes({ ...VALID_CANONICAL_EVENT, ...overrides });
  return { rawBody, envelope: sign(rawBody) };
}

async function countTable(table: string, where = ''): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM qf_jarvis.${table} ${where}`,
    );
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  });
}

beforeAll(async () => {
  await resetSchema(pool);
  await ensureManagedRolesExist(pool);
  await ensureRuntimeRoleExists(pool, RUNTIME_PASSWORD);
  await migrateTestDatabase(pool, 'qf-ingest-conc-migrate');
});

afterAll(async () => {
  await closeTestPool(runtimePool);
  await closeTestPool(pool);
});

// ---------------------------------------------------------------------------
// A. Identical concurrent delivery
// ---------------------------------------------------------------------------

describe('A. identical concurrent delivery — one stored, the rest benign duplicates', () => {
  it('stores exactly once across 32 concurrent identical ingests', async () => {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });

    const results = await Promise.all(
      Array.from({ length: 32 }, () => ingestor.ingest(rawBody, envelope, NOW)),
    );

    const stored = results.filter((r) => r.outcome === 'stored');
    const duplicate = results.filter((r) => r.outcome === 'duplicate');
    expect(stored).toHaveLength(1);
    expect(duplicate).toHaveLength(31);
    expect(results.some((r) => r.outcome === 'rejected')).toBe(false);

    // Every result references the SAME accepted row.
    const sequences = new Set(results.map((r) => (r as { sequence?: string }).sequence));
    expect(sequences.size).toBe(1);
    const acceptedAts = new Set(
      results.map((r) => (r as { acceptedAt?: Date }).acceptedAt?.getTime()),
    );
    expect(acceptedAts.size).toBe(1);

    // Exactly one event row; no conflict rows; and — as the first test to run in this freshly
    // migrated schema — no ingestion-rejection rows at all. Nothing was updated or replaced.
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(0);
    expect(await countTable('ingestion_rejection')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Conflicting concurrent delivery
// ---------------------------------------------------------------------------

describe('B. conflicting concurrent delivery — one wins, the other is all conflicts', () => {
  it('keeps exactly one accepted event and one conflict row per refused conflicting delivery', async () => {
    const eventId = randomUUID();
    // Two valid variants of the SAME eventId (different emittedAt → different semantic digest).
    const variantA = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });
    const variantB = validSigned({ eventId, emittedAt: '2026-07-11T09:00:09Z' });

    const deliveries = [
      ...Array.from({ length: 16 }, () => variantA),
      ...Array.from({ length: 16 }, () => variantB),
    ];
    const settled = await Promise.allSettled(
      deliveries.map((d) => ingestor.ingest(d.rawBody, d.envelope, NOW)),
    );

    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<IngestResult> => s.status === 'fulfilled',
    );
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');

    // Winner-agnostic invariants: exactly one stored, 15 duplicates of the winning variant,
    // and 16 ConflictingEventDigestError for the losing variant.
    const stored = fulfilled.filter((s) => s.value.outcome === 'stored');
    const duplicate = fulfilled.filter((s) => s.value.outcome === 'duplicate');
    expect(stored).toHaveLength(1);
    expect(duplicate).toHaveLength(15);
    expect(rejected).toHaveLength(16);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ConflictingEventDigestError);
      expect((r.reason as ConflictingEventDigestError).eventId).toBe(eventId);
    }

    // Exactly one accepted event; exactly 16 conflict rows; no ingestion-rejection rows.
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(16);

    // The accepted row is one of the two variants, and the conflict rows all record the OTHER
    // variant's body digest — the original was never overwritten.
    const accepted = await withClient(pool, async (client) => {
      const r = await client.query<{ body_digest: Buffer }>(
        `SELECT body_digest FROM qf_jarvis.event WHERE event_id = $1`,
        [eventId],
      );
      return r.rows[0]?.body_digest;
    });
    const conflictDigests = await withClient(pool, async (client) => {
      const r = await client.query<{ conflicting_body_digest: Buffer }>(
        `SELECT DISTINCT conflicting_body_digest FROM qf_jarvis.event_conflict WHERE event_id = $1`,
        [eventId],
      );
      return r.rows.map((row) => row.conflicting_body_digest.toString('hex'));
    });
    expect(accepted).toBeInstanceOf(Buffer);
    const acceptedHex = Buffer.isBuffer(accepted) ? accepted.toString('hex') : '';
    // All conflict rows record ONE digest (the loser's), and it differs from the accepted (winner's).
    expect(conflictDigests).toHaveLength(1);
    expect(conflictDigests[0]).not.toBe(acceptedHex);
  });
});

// ---------------------------------------------------------------------------
// C. Independent event concurrency
// ---------------------------------------------------------------------------

describe('C. independent events — each stores once, no cross-event interference', () => {
  it('stores 40 distinct events concurrently with unique sequences and no false classification', async () => {
    const eventIds = Array.from({ length: 40 }, () => randomUUID());
    const results = await Promise.all(
      eventIds.map((eventId) => {
        const { rawBody, envelope } = validSigned({ eventId });
        return ingestor.ingest(rawBody, envelope, NOW);
      }),
    );

    // Every distinct event stored exactly once — no false duplicate/conflict.
    expect(results.every((r) => r.outcome === 'stored')).toBe(true);
    const sequences = new Set(results.map((r) => (r as { sequence: string }).sequence));
    expect(sequences.size).toBe(40);

    for (const eventId of eventIds) {
      expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    }
    // No conflicts and no rejections were produced by independent events.
    const conflicts = await Promise.all(
      eventIds.map((id) => countTable('event_conflict', `WHERE event_id = '${id}'`)),
    );
    expect(conflicts.every((c) => c === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Runtime-role concurrency
// ---------------------------------------------------------------------------

describe('D. runtime-role races — same invariants under least privilege, no broadening', () => {
  it('identical race through the runtime pool: one stored, N-1 duplicate, all invariants hold', async () => {
    const N = 24;
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });

    // Capture rejection count BEFORE, so the test does not depend on being first in the file.
    const rejectionsBefore = await countTable('ingestion_rejection');

    const results = await Promise.all(
      Array.from({ length: N }, () => runtimeIngestor.ingest(rawBody, envelope, NOW)),
    );

    const stored = results.filter((r) => r.outcome === 'stored');
    const duplicate = results.filter((r) => r.outcome === 'duplicate');
    expect(stored).toHaveLength(1);
    expect(duplicate).toHaveLength(N - 1);
    // Zero rejected DOMAIN results.
    expect(results.some((r) => r.outcome === 'rejected')).toBe(false);
    // All results reference the SAME accepted row (sequence and acceptedAt).
    expect(new Set(results.map((r) => (r as { sequence?: string }).sequence)).size).toBe(1);
    expect(
      new Set(results.map((r) => (r as { acceptedAt?: Date }).acceptedAt?.getTime())).size,
    ).toBe(1);
    // Exactly one event row; zero conflict rows for this eventId; rejection count UNCHANGED.
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(0);
    expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore);
    // No overwrite/replacement: the single stored row's digest is the one the deliveries carried.
    const storedDigest = await withClient(pool, async (client) => {
      const r = await client.query<{ body_digest: Buffer }>(
        `SELECT body_digest FROM qf_jarvis.event WHERE event_id = $1`,
        [eventId],
      );
      return r.rows[0]?.body_digest.toString('hex');
    });
    expect(storedDigest).toBe(createHash('sha256').update(rawBody).digest('hex'));
  });

  it('conflicting race through the runtime pool: one accepted, one conflict row per loser', async () => {
    const eventId = randomUUID();
    const variantA = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });
    const variantB = validSigned({ eventId, emittedAt: '2026-07-11T09:00:09Z' });
    const deliveries = [
      ...Array.from({ length: 8 }, () => variantA),
      ...Array.from({ length: 8 }, () => variantB),
    ];

    const rejectionsBefore = await countTable('ingestion_rejection');

    const settled = await Promise.allSettled(
      deliveries.map((d) => runtimeIngestor.ingest(d.rawBody, d.envelope, NOW)),
    );
    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<IngestResult> => s.status === 'fulfilled',
    );
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');

    // Winner-agnostic: exactly one stored, exactly seven duplicate, exactly eight rejected promises,
    // and every rejection is a ConflictingEventDigestError. No fulfilled result is a domain rejection.
    expect(fulfilled.filter((s) => s.value.outcome === 'stored')).toHaveLength(1);
    expect(fulfilled.filter((s) => s.value.outcome === 'duplicate')).toHaveLength(7);
    expect(fulfilled.some((s) => s.value.outcome === 'rejected')).toBe(false);
    expect(rejected).toHaveLength(8);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ConflictingEventDigestError);
      expect((r.reason as ConflictingEventDigestError).eventId).toBe(eventId);
    }

    // Exactly one accepted event, exactly eight conflict rows, rejection count UNCHANGED.
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(8);
    expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore);

    // All eight conflict rows record ONE digest (the loser's), and it differs from the accepted
    // (winner's) — the accepted event was never overwritten. Either variant may win.
    const accepted = await withClient(pool, async (client) => {
      const r = await client.query<{ body_digest: Buffer }>(
        `SELECT body_digest FROM qf_jarvis.event WHERE event_id = $1`,
        [eventId],
      );
      return r.rows[0]?.body_digest.toString('hex');
    });
    const conflictDigests = await withClient(pool, async (client) => {
      const r = await client.query<{ conflicting_body_digest: Buffer }>(
        `SELECT DISTINCT conflicting_body_digest FROM qf_jarvis.event_conflict WHERE event_id = $1`,
        [eventId],
      );
      return r.rows.map((row) => row.conflicting_body_digest.toString('hex'));
    });
    const digestA = createHash('sha256').update(variantA.rawBody).digest('hex');
    const digestB = createHash('sha256').update(variantB.rawBody).digest('hex');
    expect([digestA, digestB]).toContain(accepted); // the winner is one of the two variants
    expect(conflictDigests).toHaveLength(1);
    expect(conflictDigests[0]).not.toBe(accepted);
    expect([digestA, digestB]).toContain(conflictDigests[0]); // the loser is the other variant
  });

  it('the runtime role has NO read access to audit-table content and no broadened privilege', async () => {
    const priv = await withClient(pool, async (client) => {
      const checks = new Map<string, boolean | undefined>();
      // Column-level SELECT on AUDIT-TABLE content must be denied — the runtime writes those tables
      // (INSERT on caller columns) but must not read their bounded evidence back. (The event log's
      // own SELECT grant, used for digest classification, is the existing 0002 design and is not an
      // audit table — it is deliberately not probed here.)
      const columnSelectProbes: readonly [string, string][] = [
        ['event_conflict', 'conflicting_body_digest'],
        ['event_conflict', 'conflicting_correlation_id'],
        ['event_conflict', 'conflicting_signature_key_id'],
        ['ingestion_rejection', 'reason_code'],
        ['ingestion_rejection', 'issue_codes'],
        ['ingestion_rejection', 'key_id'],
      ];
      for (const [table, column] of columnSelectProbes) {
        const r = await client.query<{ granted: boolean }>(
          `SELECT has_column_privilege($1, 'qf_jarvis.${table}', $2, 'SELECT') AS granted`,
          [RUNTIME_ROLE, column],
        );
        checks.set(`${table}.${column}.SELECT`, r.rows[0]?.granted);
      }
      // Table-level mutation of the immutable log must be denied (UPDATE/DELETE are table privileges).
      for (const [table, tablePriv] of [
        ['event', 'UPDATE'],
        ['event', 'DELETE'],
        ['event_conflict', 'DELETE'],
        ['ingestion_rejection', 'DELETE'],
      ] as const) {
        const r = await client.query<{ granted: boolean }>(
          `SELECT has_table_privilege($1, 'qf_jarvis.${table}', $2) AS granted`,
          [RUNTIME_ROLE, tablePriv],
        );
        checks.set(`${table}.${tablePriv}`, r.rows[0]?.granted);
      }
      return checks;
    });
    for (const [, granted] of priv) {
      expect(granted).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Duplicate object-key policy at the full boundary (ADR-0033)
// ---------------------------------------------------------------------------

describe('duplicate object keys — refused with the fixed mapping, nothing sender-controlled stored', () => {
  /** Sign an EXACT raw JSON string (so duplicates survive) and ingest it. */
  async function ingestRaw(rawJson: string): Promise<IngestResult> {
    const rawBody = new TextEncoder().encode(rawJson);
    return ingestor.ingest(rawBody, sign(rawBody), NOW);
  }

  async function readRejection(sequence: string): Promise<{
    reason_code: string;
    key_id: string | null;
    body_digest: Buffer | null;
    issue_codes: string[];
    issue_count: number;
    issues_truncated: boolean;
  }> {
    return withClient(pool, async (client) => {
      const r = await client.query<{
        reason_code: string;
        key_id: string | null;
        body_digest: Buffer | null;
        issue_codes: string[];
        issue_count: number;
        issues_truncated: boolean;
      }>(
        `SELECT reason_code, key_id, body_digest, issue_codes, issue_count, issues_truncated
           FROM qf_jarvis.ingestion_rejection WHERE sequence = $1`,
        [sequence],
      );
      const row = r.rows[0];
      if (row === undefined) throw new Error(`no rejection row at sequence ${sequence}`);
      return row;
    });
  }

  it('rejects a top-level duplicate and records only contract-validation-failed / invalid-format', async () => {
    const eventId = randomUUID();
    const valid = JSON.stringify({ ...VALID_CANONICAL_EVENT, eventId });
    // A duplicate correlationId with a distinctive sentinel value — must never be persisted.
    const raw = `{"correlationId":"DUP-SENTINEL-9f9f9f",${valid.slice(1)}`;

    const before = await countTable('event', `WHERE event_id = '${eventId}'`);
    const result = await ingestRaw(raw);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('contract-validation-failed');

    const row = await readRejection(result.rejectionSequence);
    expect(row.reason_code).toBe('contract-validation-failed');
    expect(row.issue_codes).toStrictEqual(['invalid-format']);
    expect(row.issue_count).toBe(1);
    expect(row.issues_truncated).toBe(false);
    // The ingestor records no key_id/body_digest for a preparation rejection.
    expect(row.key_id).toBeNull();
    expect(row.body_digest).toBeNull();
    // No event row was written for the refused body.
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(before);

    // The duplicated key name / value never appears anywhere in the stored row.
    const rowText = JSON.stringify(row);
    expect(rowText).not.toContain('DUP-SENTINEL-9f9f9f');
    expect(rowText).not.toContain('correlationId');
  });

  it('rejects a nested duplicate the same way', async () => {
    const raw = '{"eventType":"x","payload":{"secretDup":1,"secretDup":2}}';
    const result = await ingestRaw(raw);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    const row = await readRejection(result.rejectionSequence);
    expect(row.issue_codes).toStrictEqual(['invalid-format']);
    expect(JSON.stringify(row)).not.toContain('secretDup');
  });

  it('an INVALID SIGNATURE with duplicate keys is refused by signature verification FIRST', async () => {
    // Signed by the wrong key: signature-invalid must win over duplicate-key detection, which
    // never runs because parsing never starts on an unauthenticated body.
    const rawBody = new TextEncoder().encode('{"a":1,"a":2}');
    const forged = signEnvelope({
      rawBody,
      keyId: TEST_KEY_ID,
      signedAt: SIGNED_AT,
      privateKey: altPrivateKey,
    });
    const result = await ingestor.ingest(rawBody, forged, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('signature-invalid');
    const row = await readRejection(result.rejectionSequence);
    expect(row.reason_code).toBe('signature-invalid');
    expect(row.issue_codes).toStrictEqual([]);
  });

  it('an OVERSIZED duplicate-key body is still refused as body-too-large (size wins)', async () => {
    // A > 256 KiB body with duplicate keys: the size guard fires before any parsing.
    const filler = 'x'.repeat(300_000);
    const rawBody = new TextEncoder().encode(`{"a":1,"a":2,"pad":"${filler}"}`);
    const result = await ingestor.ingest(rawBody, sign(rawBody), NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('body-too-large');
  });
});

// ---------------------------------------------------------------------------
// Transaction-isolation proof (READ COMMITTED)
// ---------------------------------------------------------------------------

describe('transaction isolation — DIRECTLY observed inside storeValidatedEvent’s own transaction', () => {
  /** The first SQL keyword, uppercased. */
  function firstVerb(text: string): string {
    return text.trim().split(/\s+/)[0]?.toUpperCase() ?? '';
  }

  /**
   * A TEST-ONLY forwarding pool. It records the store's statements in order and, IMMEDIATELY before
   * the store's own event INSERT, runs `SELECT current_setting('transaction_isolation')` on the SAME
   * underlying client — calling the real `client.query` DIRECTLY (never the wrapper), so there is no
   * wrapper recursion — to observe the effective isolation of the store's actual transaction.
   */
  function makeIsolationObservingPool(real: DatabasePool): {
    pool: DatabasePool;
    observed: string[];
    isolation: { value: string | null };
  } {
    const observed: string[] = [];
    const isolation: { value: string | null } = { value: null };
    const connect = async (): Promise<DatabaseClient> => {
      const client = await real.connect();
      const rawQuery = (client.query as (t: string, v?: unknown[]) => Promise<unknown>).bind(
        client,
      );
      let observedOnce = false;
      const wrapped = {
        query: async (text: string, values?: unknown[]): Promise<unknown> => {
          if (!observedOnce && /INSERT\s+INTO\s+qf_jarvis\.event\b/i.test(text)) {
            observedOnce = true;
            observed.push('SELECT'); // the observer read, sequenced right before the INSERT
            const r = (await rawQuery(
              "SELECT current_setting('transaction_isolation') AS isolation",
            )) as { rows: { isolation: string }[] };
            isolation.value = r.rows[0]?.isolation ?? null;
          }
          observed.push(firstVerb(text));
          return rawQuery(text, values);
        },
        release: (err?: Error): void => {
          client.release(err);
        },
      };
      return wrapped as unknown as DatabaseClient;
    };
    return { pool: { connect } as unknown as DatabasePool, observed, isolation };
  }

  it('the store BEGINs, SETs READ COMMITTED first, then INSERTs — observed at READ COMMITTED', async () => {
    const observing = makeIsolationObservingPool(pool);
    const observingIngestor = createEventIngestor({ pool: observing.pool, keyRegistry: registry });

    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });
    const result = await observingIngestor.ingest(rawBody, envelope, NOW);

    // The event stored exactly once through the observed transaction.
    expect(result.outcome).toBe('stored');
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);

    // The effective isolation of the store's OWN transaction, read on its OWN connection, is
    // READ COMMITTED — the level the race classification relies on.
    expect(observing.isolation.value).toBe('read committed');

    // Required first-delivery statement order: BEGIN, SET READ COMMITTED (first after BEGIN),
    // observer SELECT, INSERT, COMMIT.
    expect(observing.observed).toStrictEqual(['BEGIN', 'SET', 'SELECT', 'INSERT', 'COMMIT']);
    expect(observing.observed[1]).toBe('SET'); // the SET is the first statement after BEGIN
  });
});

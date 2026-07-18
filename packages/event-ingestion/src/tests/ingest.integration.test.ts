/**
 * `createEventIngestor().ingest` against a real PostgreSQL — the full transactional ingest
 * composition (Stage 3.3.4, ADR-0032).
 *
 * These prove the boundary end to end: verify → (reject) → prepare → (reject) → persist, with every
 * signature and preparation rejection recorded in `ingestion_rejection`, accepted deliveries stored
 * idempotently, conflicts committed-then-thrown, failure paths propagated, and the runtime role
 * exercising the whole thing under column-level least privilege.
 *
 * All fixtures are synthetic — obviously-synthetic keys, digests, and a copied Phase-2 canonical
 * event. No real name, phone, email, address, coordinate, or QuickFurno record appears.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ConflictingEventDigestError,
  withClient,
  type DatabasePool,
} from '@qf-jarvis/event-backbone';

import {
  createEventIngestor,
  DEFAULT_FRESHNESS_WINDOW_MS,
  MAX_RAW_BODY_BYTES,
  verifySignature,
  type EventIngestor,
} from '../index.js';
import { prepareValidatedEventFromVerifiedRawBody } from '../ingest/prepare-validated-event.js';
import { TEST_KEY_ID, testRegistry } from './fixtures/registry.js';
import { signEnvelope } from './fixtures/signer.js';
import { altPrivateKey, testPrivateKey } from './fixtures/test-keys.js';
import { VALID_CANONICAL_EVENT } from './fixtures/canonical-event.js';
import {
  closeTestPool,
  createRuntimePool,
  createTestPool,
  ensureManagedRolesExist,
  ensureRuntimeRoleExists,
  MANAGED_ROLES,
  migrateTestDatabase,
  resetSchema,
  RUNTIME_ROLE,
} from './fixtures/db-harness.js';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const SIGNED_AT = '2026-07-15T12:00:00.000Z';

const pool: DatabasePool = createTestPool('qf-ingest-test');
const RUNTIME_PASSWORD = randomUUID();
const runtimePool: DatabasePool = createRuntimePool(RUNTIME_PASSWORD, 'qf-ingest-runtime');

const registry = testRegistry();
const ingestor: EventIngestor = createEventIngestor({ pool, keyRegistry: registry });

/** Encode a value as UTF-8 JSON bytes. */
function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Sign a raw body with the primary test key at SIGNED_AT (unless overridden). */
function sign(
  rawBody: Uint8Array,
  overrides: { keyId?: string; signedAt?: string; privateKey?: typeof testPrivateKey } = {},
): unknown {
  return signEnvelope({
    rawBody,
    keyId: overrides.keyId ?? TEST_KEY_ID,
    signedAt: overrides.signedAt ?? SIGNED_AT,
    privateKey: overrides.privateKey ?? testPrivateKey,
  });
}

/** A valid signed canonical event (with optional field overrides). */
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

interface RejectionRow {
  reason_code: string;
  key_id: string | null;
  body_digest: Buffer | null;
  issue_codes: string[];
  issue_count: number;
  issues_truncated: boolean;
}

async function readRejection(sequence: string): Promise<RejectionRow> {
  return withClient(pool, async (client) => {
    const result = await client.query<RejectionRow>(
      `SELECT reason_code, key_id, body_digest, issue_codes, issue_count, issues_truncated
         FROM qf_jarvis.ingestion_rejection WHERE sequence = $1`,
      [sequence],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error(`Expected an ingestion_rejection row at sequence ${sequence}`);
    }
    return row;
  });
}

beforeAll(async () => {
  await resetSchema(pool);
  await ensureManagedRolesExist(pool);
  await ensureRuntimeRoleExists(pool, RUNTIME_PASSWORD);
  await migrateTestDatabase(pool, 'qf-ingest-migrate');
});

afterAll(async () => {
  await closeTestPool(runtimePool);
  await closeTestPool(pool);
});

// ---------------------------------------------------------------------------
// A. Signature failures
// ---------------------------------------------------------------------------

describe('A. signature/freshness rejections — every reason records exactly one audit row', () => {
  /** Each case yields the rawBody, the (possibly hostile) envelope, and the ingestor to use. */
  const cases: readonly {
    readonly reason: string;
    readonly rawBody: Uint8Array;
    readonly envelope: unknown;
    readonly use?: EventIngestor;
  }[] = [
    {
      reason: 'body-too-large',
      rawBody: new Uint8Array(MAX_RAW_BODY_BYTES + 1),
      envelope: sign(jsonBytes({ a: 1 })),
    },
    { reason: 'signature-missing', rawBody: jsonBytes({ a: 1 }), envelope: null },
    {
      reason: 'signature-malformed',
      rawBody: jsonBytes({ a: 1 }),
      envelope: { ...(sign(jsonBytes({ a: 1 })) as object), extra: 'x' },
    },
    {
      reason: 'unsupported-algorithm',
      rawBody: jsonBytes({ a: 1 }),
      envelope: { ...(sign(jsonBytes({ a: 1 })) as object), algorithm: 'hmac-sha256' },
    },
    {
      reason: 'signed-at-malformed',
      rawBody: jsonBytes({ a: 1 }),
      envelope: { ...(sign(jsonBytes({ a: 1 })) as object), signedAt: '2026-07-15T12:00:00Z' },
    },
    {
      reason: 'unknown-key-id',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 }), { keyId: 'test-unregistered' }),
    },
    {
      reason: 'key-revoked',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 })),
      use: createEventIngestor({ pool, keyRegistry: testRegistry({ status: 'revoked' }) }),
    },
    {
      reason: 'key-not-yet-valid',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 })),
      use: createEventIngestor({
        pool,
        keyRegistry: testRegistry({ validFrom: '2026-07-16T00:00:00.000Z' }),
      }),
    },
    {
      reason: 'key-expired',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 })),
      use: createEventIngestor({
        pool,
        keyRegistry: testRegistry({ validUntil: '2026-07-14T00:00:00.000Z' }),
      }),
    },
    {
      reason: 'replay-window-expired',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 }), {
        signedAt: new Date(NOW.getTime() - DEFAULT_FRESHNESS_WINDOW_MS - 1).toISOString(),
      }),
    },
    {
      reason: 'replay-window-future',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 }), {
        signedAt: new Date(NOW.getTime() + DEFAULT_FRESHNESS_WINDOW_MS + 1).toISOString(),
      }),
    },
    {
      // Signature made for a DIFFERENT body than the one ingested.
      reason: 'body-digest-mismatch',
      rawBody: jsonBytes({ a: 2 }),
      envelope: sign(jsonBytes({ a: 1 })),
    },
    {
      // A forgery: correctly shaped, signed by an unregistered key under a registered keyId.
      reason: 'signature-invalid',
      rawBody: jsonBytes({ a: 1 }),
      envelope: sign(jsonBytes({ a: 1 }), { keyId: TEST_KEY_ID, privateKey: altPrivateKey }),
    },
  ];

  it.each(cases)(
    'rejects with reason $reason and records one payload-free row',
    async (testCase) => {
      const rejectionsBefore = await countTable('ingestion_rejection');
      const eventsBefore = await countTable('event');
      const conflictsBefore = await countTable('event_conflict');

      const result = await (testCase.use ?? ingestor).ingest(
        testCase.rawBody,
        testCase.envelope,
        NOW,
      );

      expect(result.outcome).toBe('rejected');
      if (result.outcome !== 'rejected') return;
      expect(result.reason).toBe(testCase.reason);
      expect(result.rejectionSequence).toBeDefined();
      expect(result.recordedAt).toBeInstanceOf(Date);

      // Exactly one new rejection row; no event; no conflict.
      expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore + 1);
      expect(await countTable('event')).toBe(eventsBefore);
      expect(await countTable('event_conflict')).toBe(conflictsBefore);

      const row = await readRejection(result.rejectionSequence);
      expect(row.reason_code).toBe(testCase.reason);
      // The verification failure result exposes no safe key/body evidence, so both are null.
      expect(row.key_id).toBeNull();
      expect(row.body_digest).toBeNull();
      expect(row.issue_codes).toStrictEqual([]);
      expect(row.issue_count).toBe(0);
      expect(row.issues_truncated).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// B. Preparation failures
// ---------------------------------------------------------------------------

describe('B. preparation rejections — safe issue codes only, no path/message/payload', () => {
  /** Verify + prepare a signed body as the ORACLE for what the ingest row should hold. */
  function prepareOracle(rawBody: Uint8Array, envelope: unknown) {
    const v = verifySignature(rawBody, envelope, NOW, registry);
    expect(v.ok).toBe(true);
    if (!v.ok) throw new Error('fixture body failed verification');
    const prep = prepareValidatedEventFromVerifiedRawBody({
      verification: v,
      verifiedRawBody: rawBody,
    });
    expect(prep.ok).toBe(false);
    if (prep.ok) throw new Error('fixture body unexpectedly prepared');
    return prep;
  }

  async function assertMatchesOracle(rawBody: Uint8Array, envelope: unknown): Promise<void> {
    const oracle = prepareOracle(rawBody, envelope);
    const eventsBefore = await countTable('event');
    const result = await ingestor.ingest(rawBody, envelope, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe(oracle.reason);
    expect(await countTable('event')).toBe(eventsBefore); // no event written

    const row = await readRejection(result.rejectionSequence);
    expect(row.reason_code).toBe(oracle.reason);
    expect(row.key_id).toBeNull();
    expect(row.body_digest).toBeNull();
    // issue_codes = distinct safe codes of the retained issues, sorted; count = retained issues.
    const expectedCodes = [...new Set(oracle.issues.map((i) => i.code))].sort();
    expect(row.issue_codes).toStrictEqual(expectedCodes);
    expect(row.issue_count).toBe(oracle.issues.length);
    expect(row.issues_truncated).toBe(oracle.issuesTruncated);
    // No path/message ever reaches the row — the schema has no such column, and the codes are closed.
    for (const code of row.issue_codes) {
      expect([
        'required',
        'invalid-type',
        'invalid-format',
        'invalid-value',
        'unknown-field',
        'constraint-violation',
        'malformed-body',
      ]).toContain(code);
    }
  }

  it('malformed body (not JSON) → contract-validation-failed / malformed-body', async () => {
    const rawBody = new TextEncoder().encode('this is not json');
    const envelope = sign(rawBody);
    const result = await ingestor.ingest(rawBody, envelope, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('contract-validation-failed');
    const row = await readRejection(result.rejectionSequence);
    expect(row.issue_codes).toStrictEqual(['malformed-body']);
    expect(row.issue_count).toBe(1);
    expect(row.issues_truncated).toBe(false);
  });

  it('contract validation failure (registered type@version, invalid envelope)', async () => {
    const { rawBody, envelope } = validSigned({ correlationId: 'not-a-uuid' });
    await assertMatchesOracle(rawBody, envelope);
  });

  it('unknown event type', async () => {
    const { rawBody, envelope } = validSigned({ eventType: 'qf.unknown.thing' });
    const result = await ingestor.ingest(rawBody, envelope, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('unknown-event-type');
    const row = await readRejection(result.rejectionSequence);
    expect(row.issue_codes).toStrictEqual(['invalid-value']);
    expect(row.issue_count).toBe(1);
  });

  it('unknown event version', async () => {
    const { rawBody, envelope } = validSigned({ eventVersion: 999 });
    const result = await ingestor.ingest(rawBody, envelope, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('unknown-event-version');
    const row = await readRejection(result.rejectionSequence);
    expect(row.issue_codes).toStrictEqual(['invalid-value']);
    expect(row.issue_count).toBe(1);
  });

  it('several issues sharing one code → issue_count exceeds distinct-code count, truncated false', async () => {
    // Two top-level envelope fields of the wrong type both map to code invalid-type at distinct
    // paths — retained as two issues, compressed to one code, with no truncation.
    const { rawBody, envelope } = validSigned({ eventId: 123, occurredAt: 456 });
    const oracle = prepareOracle(rawBody, envelope);
    const distinct = new Set(oracle.issues.map((i) => i.code));
    expect(oracle.issues.length).toBeGreaterThan(distinct.size); // shared code
    expect(oracle.issuesTruncated).toBe(false);
    await assertMatchesOracle(rawBody, envelope);
  });

  it('multiple distinct issue codes', async () => {
    // A wrong-type field (invalid-type) and a wrong source literal (invalid-value) yield two
    // DISTINCT safe codes.
    const rawBody = jsonBytes({ ...VALID_CANONICAL_EVENT, eventId: 123, source: 'not-core' });
    const envelope = sign(rawBody);
    const oracle = prepareOracle(rawBody, envelope);
    expect(new Set(oracle.issues.map((i) => i.code)).size).toBeGreaterThanOrEqual(2);
    await assertMatchesOracle(rawBody, envelope);
  });

  it('issue truncation true when more than the cap of unique issues exist', async () => {
    // A large invalid evidence array yields many issues at distinct indexed paths, exceeding the cap.
    const evidence = Array.from({ length: 30 }, () => ({}));
    const broken: Record<string, unknown> = {
      ...VALID_CANONICAL_EVENT,
      payload: {
        recommendation: {
          ...(VALID_CANONICAL_EVENT.payload.recommendation as Record<string, unknown>),
          evidence,
        },
      },
    };
    const rawBody = jsonBytes(broken);
    const envelope = sign(rawBody);
    const oracle = prepareOracle(rawBody, envelope);
    expect(oracle.issuesTruncated).toBe(true);
    await assertMatchesOracle(rawBody, envelope);
  });
});

// ---------------------------------------------------------------------------
// C. Accepted persistence
// ---------------------------------------------------------------------------

describe('C. accepted deliveries — stored, duplicate, conflict', () => {
  /** A fresh valid event with a unique eventId, signed. */
  function freshEvent(overrides: Record<string, unknown> = {}): {
    rawBody: Uint8Array;
    envelope: unknown;
    eventId: string;
  } {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId, ...overrides });
    return { rawBody, envelope, eventId };
  }

  it('stores a first delivery and records no rejection', async () => {
    const { rawBody, envelope, eventId } = freshEvent();
    const rejectionsBefore = await countTable('ingestion_rejection');
    const result = await ingestor.ingest(rawBody, envelope, NOW);
    expect(result.outcome).toBe('stored');
    if (result.outcome !== 'stored') return;
    expect(BigInt(result.sequence)).toBeGreaterThan(0n);
    expect(result.acceptedAt).toBeInstanceOf(Date);
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(0);
  });

  it('classifies a same-digest redelivery as a benign duplicate, and records no rejection', async () => {
    const { rawBody, envelope, eventId } = freshEvent();
    const first = await ingestor.ingest(rawBody, envelope, NOW);
    const rejectionsBefore = await countTable('ingestion_rejection');
    const second = await ingestor.ingest(rawBody, envelope, NOW);
    expect(first.outcome).toBe('stored');
    expect(second.outcome).toBe('duplicate');
    if (first.outcome !== 'stored' || second.outcome !== 'duplicate') return;
    expect(second.sequence).toBe(first.sequence);
    expect(second.acceptedAt.getTime()).toBe(first.acceptedAt.getTime());
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(0);
  });

  it('throws ConflictingEventDigestError for a different-digest redelivery, and records the conflict — not a rejection', async () => {
    const eventId = randomUUID();
    const original = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });
    await ingestor.ingest(original.rawBody, original.envelope, NOW);

    const conflicting = validSigned({ eventId, emittedAt: '2026-07-11T09:00:07Z' });
    const rejectionsBefore = await countTable('ingestion_rejection');

    let thrown: unknown;
    try {
      await ingestor.ingest(conflicting.rawBody, conflicting.envelope, NOW);
      throw new Error('expected a ConflictingEventDigestError');
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConflictingEventDigestError);
    // The conflict row committed before the throw (a fresh read sees it); no rejection was written.
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(1);
    expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore);
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
  });

  it('records a SEPARATE conflict row for each repeated conflicting redelivery, original unchanged', async () => {
    const eventId = randomUUID();
    const original = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });
    await ingestor.ingest(original.rawBody, original.envelope, NOW);
    const before = await withClient(pool, async (client) => {
      const r = await client.query<{ emitted_at: Date; sequence: string }>(
        'SELECT emitted_at, sequence FROM qf_jarvis.event WHERE event_id = $1',
        [eventId],
      );
      return r.rows[0];
    });

    for (const emittedAt of ['2026-07-11T09:00:07Z', '2026-07-11T09:00:08Z']) {
      const conflicting = validSigned({ eventId, emittedAt });
      await expect(
        ingestor.ingest(conflicting.rawBody, conflicting.envelope, NOW),
      ).rejects.toBeInstanceOf(ConflictingEventDigestError);
    }
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(2);

    // The original accepted event is unchanged.
    const after = await withClient(pool, async (client) => {
      const r = await client.query<{ emitted_at: Date; sequence: string }>(
        'SELECT emitted_at, sequence FROM qf_jarvis.event WHERE event_id = $1',
        [eventId],
      );
      return r.rows[0];
    });
    expect(after?.sequence).toBe(before?.sequence);
    expect(after?.emitted_at.getTime()).toBe(before?.emitted_at.getTime());
    expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D. Failure paths
// ---------------------------------------------------------------------------

describe('D. infrastructure failures propagate; no domain relabelling, no partial state', () => {
  async function withTempFailConstraint(table: string, fn: () => Promise<void>): Promise<void> {
    // `sequence` is GENERATED ALWAYS AS IDENTITY on all three append-only tables, so it is never
    // null on a new row; a NOT-VALID CHECK requiring it to be null fails every fresh INSERT while
    // leaving already-committed rows untouched. This forces the write to fail with a known
    // constraint name without depending on any table-specific column.
    await withClient(pool, (client) =>
      client.query(
        `ALTER TABLE qf_jarvis.${table} ADD CONSTRAINT tmp_force_fail CHECK (sequence IS NULL) NOT VALID`,
      ),
    );
    try {
      await fn();
    } finally {
      await withClient(pool, (client) =>
        client.query(`ALTER TABLE qf_jarvis.${table} DROP CONSTRAINT tmp_force_fail`),
      );
    }
  }

  it('a rejection-insert failure propagates and does not return a rejected result', async () => {
    const rawBody = jsonBytes({ a: 1 });
    const envelope = null; // signature-missing → rejection path
    await withTempFailConstraint('ingestion_rejection', async () => {
      const rejectionsBefore = await countTable('ingestion_rejection');
      await expect(ingestor.ingest(rawBody, envelope, NOW)).rejects.toMatchObject({
        constraint: 'tmp_force_fail',
      });
      expect(await countTable('ingestion_rejection')).toBe(rejectionsBefore); // no partial row
    });
  });

  it('an event-insert failure propagates', async () => {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });
    await withTempFailConstraint('event', async () => {
      await expect(ingestor.ingest(rawBody, envelope, NOW)).rejects.toMatchObject({
        constraint: 'tmp_force_fail',
      });
      expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(0);
    });
  });

  it('a conflict-insert failure propagates as a database error, NOT ConflictingEventDigestError', async () => {
    const eventId = randomUUID();
    const original = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });
    await ingestor.ingest(original.rawBody, original.envelope, NOW);
    const conflicting = validSigned({ eventId, emittedAt: '2026-07-11T09:00:07Z' });

    await withTempFailConstraint('event_conflict', async () => {
      let thrown: unknown;
      try {
        await ingestor.ingest(conflicting.rawBody, conflicting.envelope, NOW);
        throw new Error('expected a database error');
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).not.toBeInstanceOf(ConflictingEventDigestError);
      expect(String((thrown as { constraint?: string }).constraint)).toBe('tmp_force_fail');
      // Rolled back: no conflict row, original still stands.
      expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(0);
      expect(await countTable('event', `WHERE event_id = '${eventId}'`)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// E. Runtime role
// ---------------------------------------------------------------------------

describe('E. the full ingest runs under the least-privileged runtime connection', () => {
  const runtimeIngestor: EventIngestor = createEventIngestor({
    pool: runtimePool,
    keyRegistry: registry,
  });

  it('records a signature rejection through the runtime connection', async () => {
    const result = await runtimeIngestor.ingest(jsonBytes({ a: 1 }), null, NOW);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.reason).toBe('signature-missing');
    expect(BigInt(result.rejectionSequence)).toBeGreaterThan(0n);
  });

  it('stores and de-duplicates through the runtime connection', async () => {
    const eventId = randomUUID();
    const { rawBody, envelope } = validSigned({ eventId });
    const first = await runtimeIngestor.ingest(rawBody, envelope, NOW);
    const second = await runtimeIngestor.ingest(rawBody, envelope, NOW);
    expect(first.outcome).toBe('stored');
    expect(second.outcome).toBe('duplicate');
  });

  it('commits a conflict then throws, through the runtime connection', async () => {
    const eventId = randomUUID();
    const original = validSigned({ eventId, emittedAt: '2026-07-11T09:00:05Z' });
    await runtimeIngestor.ingest(original.rawBody, original.envelope, NOW);
    const conflicting = validSigned({ eventId, emittedAt: '2026-07-11T09:00:07Z' });
    await expect(
      runtimeIngestor.ingest(conflicting.rawBody, conflicting.envelope, NOW),
    ).rejects.toBeInstanceOf(ConflictingEventDigestError);
    expect(await countTable('event_conflict', `WHERE event_id = '${eventId}'`)).toBe(1);
  });

  it('still cannot read audit-table content (no privilege broadening)', async () => {
    await expect(
      withClient(runtimePool, (client) =>
        client.query('SELECT reason_code FROM qf_jarvis.ingestion_rejection'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withClient(runtimePool, (client) =>
        client.query('SELECT event_id FROM qf_jarvis.event_conflict'),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('PUBLIC and managed roles have no access to the audit tables', async () => {
    for (const grantee of ['public', ...MANAGED_ROLES]) {
      const priv = await withClient(pool, async (client) => {
        const r = await client.query<{ usage: boolean }>(
          `SELECT has_schema_privilege($1, 'qf_jarvis', 'USAGE') AS usage`,
          [grantee],
        );
        return r.rows[0]?.usage;
      });
      expect(priv).toBe(false);
    }
    // The runtime role owns nothing new.
    const owns = await withClient(pool, async (client) => {
      const r = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_roles r ON r.oid = c.relowner WHERE r.rolname = $1`,
        [RUNTIME_ROLE],
      );
      return r.rows[0]?.count;
    });
    expect(owns).toBe('0');
  });
});

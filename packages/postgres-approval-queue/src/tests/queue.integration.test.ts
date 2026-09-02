/**
 * QFJ-P08 — the durable approval queue, against a real PostgreSQL (ADR-0081).
 *
 * These are the tests the slice exists for. The approval-runtime foundation proved the SEMANTICS
 * against in-memory values, which cannot demonstrate the three properties that matter once asks
 * outlive a process:
 *
 *   1. an ask survives a restart, and a decision recorded later still correlates to it;
 *   2. two overlapping asks for the same action are impossible — the durable answer to
 *      `ApprovalDecisionV1` carrying no `approvalRequestId`;
 *   3. an exact replay of either artifact is one durable effect, under genuine contention.
 *
 * None is provable without a database, so these FAIL rather than skip when one is absent. Every
 * recommendation and request is built through the REAL merged runtimes; a hand-assembled fixture
 * would prove only that this package agrees with itself.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabasePool } from '@qf-jarvis/event-backbone';
import type { ApprovalRequestV1 } from '@qf-jarvis/contracts';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';

import { PostgresApprovalQueueError, createPostgresApprovalQueue } from '../index.js';
import type { PostgresApprovalQueue } from '../index.js';
import {
  REQ_CREATED_AT,
  approvalRequest,
  closeDatabasePool,
  coreDecision,
  createTestPool,
  ensureLoginRole,
  recommendationSource,
  resetAndMigrate,
  testDatabaseConfig,
  testDatabaseConfigAs,
  twoActionSource,
  withClient,
  type DatabasePool,
} from './harness.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(
  new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
);

let pool: DatabasePool;
let queue: PostgresApprovalQueue;

beforeAll(async () => {
  pool = createTestPool('qf-p08-queue-test');
  await resetAndMigrate(pool, testDatabaseConfig('qf-p08-queue-test'));
  queue = createPostgresApprovalQueue({ pool });
}, 180_000);

afterAll(async () => {
  await closeDatabasePool(pool);
});

beforeEach(async () => {
  await withClient(pool, async (client) => {
    // All five at once: they reference each other, so PostgreSQL requires one statement. TRUNCATE
    // bypasses the append-only triggers by design -- this is test teardown, not a runtime
    // capability, and the runtime role is granted neither DELETE nor TRUNCATE.
    await client.query(
      `TRUNCATE qf_jarvis.approval_queue_audit,
                qf_jarvis.approval_request_decision_link,
                qf_jarvis.approval_active_slot,
                qf_jarvis.approval_decision_record,
                qf_jarvis.approval_request_record`,
    );
  });
});

function expectCode(promise: Promise<unknown>, code: string, label = code): Promise<void> {
  return expect(promise, label).rejects.toMatchObject({ code });
}

async function auditTypes(approvalRequestId: string): Promise<string[]> {
  return (await queue.readAuditForRequest(approvalRequestId)).map((row) => row.eventType);
}

/**
 * A two-party rendezvous, for the races `Promise.all` alone does not reliably produce.
 *
 * `Promise.all` USUALLY interleaves two sessions the way a concurrency test needs — and "usually" is
 * exactly how a concurrency regression gets merged on a quiet CI run. These barriers hold both
 * sessions at the one instruction boundary that matters, so the interleaving is a fact of the test
 * rather than a property of the machine it ran on.
 */
interface Barrier {
  readonly arriveAndWait: () => Promise<void>;
}

function createBarrier(parties: number): Barrier {
  let arrived = 0;
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arriveAndWait: async (): Promise<void> => {
      arrived += 1;
      if (arrived >= parties) {
        release?.();
      }
      await opened;
    },
  };
}

/**
 * The real pool, with every session held at the decision lookup.
 *
 * A facade rather than a patched client: `withQueueTransaction` uses exactly `pool.connect()`,
 * `client.query(...)` and `client.release()`, so forwarding those three is the whole surface and
 * nothing of `pg`'s internals is reached into. After a session's FIRST read of the decision table
 * returns, it waits — so when the barrier opens, every party has already looked and found nothing,
 * which is precisely the state where the loser's `ON CONFLICT DO NOTHING` reports zero rows for a
 * decision it is entitled to reuse.
 */
function poolHeldAtDecisionLookup(real: DatabasePool, gate: Barrier): DatabasePool {
  const forward = real.query.bind(real) as unknown as (...args: readonly unknown[]) => unknown;
  return {
    query: (...args: readonly unknown[]): unknown => forward(...args),
    connect: async (): Promise<unknown> => {
      const client = await real.connect();
      const run = client.query.bind(client) as unknown as (
        ...args: readonly unknown[]
      ) => Promise<unknown>;
      let held = false;
      return {
        query: async (...args: readonly unknown[]): Promise<unknown> => {
          const result = await run(...args);
          const text = args[0];
          if (
            !held &&
            typeof text === 'string' &&
            text.includes('FROM qf_jarvis.approval_decision_record')
          ) {
            held = true;
            await gate.arriveAndWait();
          }
          return result;
        },
        release: (): void => {
          client.release();
        },
      };
    },
  } as unknown as DatabasePool;
}

/** A pool that answers nothing and counts every attempt, for the "no SQL was run" proofs. */
function countingPool(): { readonly pool: DatabasePool; readonly calls: () => number } {
  let calls = 0;
  const refuse = (): never => {
    calls += 1;
    throw new Error('the test pool was reached, which this specification forbids');
  };
  return {
    pool: { query: refuse, connect: refuse } as unknown as DatabasePool,
    calls: (): number => calls,
  };
}

async function slotPointer(source: RecommendationRuntimeResult, index = 0): Promise<unknown> {
  const action = source.recommendation.proposedActions[index];
  return withClient(pool, async (client) => {
    const result = await client.query(
      `SELECT active_approval_request_id FROM qf_jarvis.approval_active_slot
        WHERE recommendation_id = $1 AND proposed_action_id = $2`,
      [source.recommendation.recommendationId, action?.actionId],
    );
    return (result.rows[0] as { active_approval_request_id: unknown } | undefined)
      ?.active_approval_request_id;
  });
}

// ---------------------------------------------------------------------------
// Migration and schema.
// ---------------------------------------------------------------------------

describe('migration 0009 and the schema it creates', () => {
  it('leaves migrations 0001-0008 byte-identical and adds exactly one 0009', () => {
    const locked: Readonly<Record<string, string>> = {
      '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
      '0002_event_runtime_grants.sql':
        '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
      '0003_ingestion_rejection_and_event_conflict.sql':
        '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
      '0004_projection_foundation.sql':
        '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
      '0005_projection_event_positions.sql':
        '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
      '0006_projection_failure_operations.sql':
        'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
      '0007_subject_activity_projection.sql':
        '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
      '0008_conversation_control_persistence.sql':
        'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
    };
    for (const [file, expected] of Object.entries(locked)) {
      const actual = createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, file)))
        .digest('hex');
      expect(actual, file).toBe(expected);
    }
    const sql = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(sql).toHaveLength(13);
    expect(sql[9]).toBe('0010_execution_replay_claim.sql');
    expect(sql[10]).toBe('0011_riya_conversation_continuity.sql');
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((n) => n.startsWith('0014'))).toBe(false);
  });

  it('creates exactly the five approval tables, in qf_jarvis and nowhere else', async () => {
    const rows = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_name LIKE 'approval\\_%'`,
      );
      return result.rows as { table_schema: string; table_name: string }[];
    });
    expect(rows.map((r) => r.table_name).sort()).toEqual([
      'approval_active_slot',
      'approval_decision_record',
      'approval_queue_audit',
      'approval_request_decision_link',
      'approval_request_record',
    ]);
    for (const row of rows) {
      expect(row.table_schema).toBe('qf_jarvis');
    }
  });

  it('keys the slot on (recommendation, action) and the link on the REQUEST', async () => {
    const constraints = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'qf_jarvis' AND t.relname LIKE 'approval\\_%'`,
      );
      return new Map(
        (result.rows as { conname: string; definition: string }[]).map((r) => [
          r.conname,
          r.definition,
        ]),
      );
    });
    // A slot keyed on the recommendation alone would collapse every action into one slot.
    expect(constraints.get('approval_active_slot_pk')).toBe(
      'PRIMARY KEY (recommendation_id, proposed_action_id)',
    );
    // One ask is answered at most once...
    expect(constraints.get('approval_request_decision_link_approval_request_id_key')).toBe(
      'UNIQUE (approval_request_id)',
    );
    // ...but one decision may answer several asks, so the LINK must not make decision_id unique.
    // (The decision RECORD legitimately does: one row per Core decision.)
    const linkConstraints = [...constraints.entries()]
      .filter(([name]) => name.startsWith('approval_request_decision_link_'))
      .map(([, definition]) => definition);
    expect(linkConstraints).not.toContain('UNIQUE (decision_id)');
    expect(constraints.get('approval_decision_record_decision_id_key')).toBe(
      'UNIQUE (decision_id)',
    );
    // The slot's pointer reference carries the action identity on BOTH sides, so a non-null pointer
    // structurally belongs to the slot holding it.
    expect(constraints.get('approval_active_slot_request_fk')).toBe(
      'FOREIGN KEY (recommendation_id, proposed_action_id, active_approval_request_id) ' +
        'REFERENCES qf_jarvis.approval_request_record' +
        '(recommendation_id, proposed_action_id, approval_request_id)',
    );
    expect(constraints.get('approval_request_record_action_request_key')).toBe(
      'UNIQUE (recommendation_id, proposed_action_id, approval_request_id)',
    );
  });

  it('refuses an UPDATE or DELETE on every append-only table', async () => {
    const source = recommendationSource('a1a1a1a1');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision: coreDecision(source, [
        { actionId: request.proposedActionId, decision: 'approved' },
      ]),
    });

    await withClient(pool, async (client) => {
      for (const statement of [
        `UPDATE qf_jarvis.approval_request_record SET action_fingerprint = repeat('a', 64)`,
        'DELETE FROM qf_jarvis.approval_request_record',
        `UPDATE qf_jarvis.approval_decision_record SET decided_at = now()`,
        'DELETE FROM qf_jarvis.approval_decision_record',
        `UPDATE qf_jarvis.approval_request_decision_link SET selected_action_decision = 'rejected'`,
        'DELETE FROM qf_jarvis.approval_request_decision_link',
        `UPDATE qf_jarvis.approval_queue_audit SET event_type = 'DECISION_LINKED'`,
        'DELETE FROM qf_jarvis.approval_queue_audit',
        'DELETE FROM qf_jarvis.approval_active_slot',
      ]) {
        await expect(client.query(statement), statement).rejects.toBeDefined();
      }
    });
  });

  it('refuses moving a slot to a different action, and refuses a non-Core decision row', async () => {
    const source = recommendationSource('a2a2a2a2');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    await withClient(pool, async (client) => {
      await expect(
        client.query(
          `UPDATE qf_jarvis.approval_active_slot SET proposed_action_id = gen_random_uuid()`,
        ),
      ).rejects.toBeDefined();
      // The storage layer refuses to hold a decision Core could not have issued, independently of
      // the adapter's own contract check.
      await expect(
        client.query(
          `INSERT INTO qf_jarvis.approval_decision_record
             (decision_id, recommendation_id, decided_at, decision_payload)
           VALUES (gen_random_uuid(), $1, now(),
                   jsonb_build_object('decisionId', gen_random_uuid()::text,
                                      'recommendationId', $1::text,
                                      'issuer', 'qf-jarvis',
                                      'outcome', 'approved'))`,
          [source.recommendation.recommendationId],
        ),
      ).rejects.toBeDefined();
    });
  });

  it('refuses a slot pointer that names a request belonging to a DIFFERENT action', async () => {
    // The correction PR #84's final review asked for. The slot-key trigger stops the KEY moving, and
    // the runtime role holds UPDATE on the pointer -- so with a single-column foreign key the pointer
    // was the way around the trigger: action A's slot could be made to name action B's request, and
    // the database would have accepted it. The composite reference is what closes that.
    const source = twoActionSource('a3a3a3a3');
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, { actionIndex: 1 });
    await queue.enqueueRequest({ source, request: a });
    await queue.enqueueRequest({ source, request: b });

    await withClient(pool, async (client) => {
      // Direct SQL, deliberately bypassing the adapter: this must be refused by the DATABASE.
      await expect(
        client.query(
          `UPDATE qf_jarvis.approval_active_slot
              SET active_approval_request_id = $3
            WHERE recommendation_id = $1 AND proposed_action_id = $2`,
          [source.recommendation.recommendationId, first.actionId, b.approvalRequestId],
        ),
        "action A's slot pointed at action B's request",
      ).rejects.toMatchObject({ code: '23503' });
    });

    // Neither pointer moved.
    expect(await slotPointer(source, 0)).toBe(a.approvalRequestId);
    expect(await slotPointer(source, 1)).toBe(b.approvalRequestId);

    await withClient(pool, async (client) => {
      // NULL is still a valid pointer: under MATCH SIMPLE a composite key with a NULL column is
      // satisfied, and NULL is how "no outstanding ask" is expressed. Re-pointing at the SAME
      // action's own request is valid too.
      await client.query(
        `UPDATE qf_jarvis.approval_active_slot SET active_approval_request_id = NULL
          WHERE recommendation_id = $1 AND proposed_action_id = $2`,
        [source.recommendation.recommendationId, first.actionId],
      );
      await client.query(
        `UPDATE qf_jarvis.approval_active_slot SET active_approval_request_id = $3
          WHERE recommendation_id = $1 AND proposed_action_id = $2`,
        [source.recommendation.recommendationId, first.actionId, a.approvalRequestId],
      );
    });
    expect(await slotPointer(source, 0)).toBe(a.approvalRequestId);
  }, 90_000);

  it('revokes every approval table from PUBLIC', async () => {
    const grants = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT has_table_privilege('public', 'qf_jarvis.approval_request_record', 'SELECT') AS a,
                has_table_privilege('public', 'qf_jarvis.approval_active_slot', 'SELECT') AS b,
                has_table_privilege('public', 'qf_jarvis.approval_decision_record', 'SELECT') AS c,
                has_table_privilege('public', 'qf_jarvis.approval_request_decision_link', 'SELECT') AS d,
                has_table_privilege('public', 'qf_jarvis.approval_queue_audit', 'SELECT') AS e`,
      );
      return result.rows[0] as Record<string, boolean>;
    });
    expect(Object.values(grants)).toEqual([false, false, false, false, false]);
  });

  it('is ready against the migrated schema, and needs no schema_migration privilege', async () => {
    await expect(queue.assertReady()).resolves.toBeUndefined();
    // Readiness trusts the ACTUAL schema, not a recorded checksum row -- and a deployment principal
    // has no operational reason to read migration tooling state.
    await withClient(pool, async (client) => {
      await client.query('REVOKE ALL ON qf_jarvis.schema_migration FROM PUBLIC');
    });
    await expect(queue.assertReady()).resolves.toBeUndefined();
  });

  it('refuses readiness when a table, trigger or constraint is missing', async () => {
    const damage = async (sql: string): Promise<void> => {
      await withClient(pool, async (client) => {
        await client.query(sql);
      });
      await expectCode(queue.assertReady(), 'schema-incompatible', sql);
      await resetAndMigrate(pool, testDatabaseConfig('qf-p08-queue-test'));
    };
    await damage('DROP TABLE qf_jarvis.approval_queue_audit');
    await damage(
      'ALTER TABLE qf_jarvis.approval_request_record DISABLE TRIGGER approval_request_record_append_only_trigger',
    );
    await damage(
      'ALTER TABLE qf_jarvis.approval_active_slot DISABLE TRIGGER approval_active_slot_guard_trigger',
    );
    await damage(
      'ALTER TABLE qf_jarvis.approval_decision_record DROP CONSTRAINT approval_decision_record_issuer_is_core',
    );
  }, 300_000);

  it('refuses readiness against the OLD single-column slot foreign key', async () => {
    // The exact shape this migration originally shipped. It has the same NAME and resolves perfectly
    // well, so an existence check passes it -- and it leaves the invariant unenforced. A database
    // still carrying it is not one this adapter's guarantee holds on, so startup refuses rather than
    // trusting itself never to write the wrong pointer.
    await withClient(pool, async (client) => {
      await client.query(
        'ALTER TABLE qf_jarvis.approval_active_slot DROP CONSTRAINT approval_active_slot_request_fk',
      );
      await client.query(
        `ALTER TABLE qf_jarvis.approval_active_slot
           ADD CONSTRAINT approval_active_slot_request_fk
           FOREIGN KEY (active_approval_request_id)
           REFERENCES qf_jarvis.approval_request_record (approval_request_id)`,
      );
    });
    await expectCode(queue.assertReady(), 'schema-incompatible', 'single-column slot FK');
    await resetAndMigrate(pool, testDatabaseConfig('qf-p08-queue-test'));
  }, 300_000);

  it('refuses readiness when the composite request UNIQUE is gone', async () => {
    // Renamed rather than dropped, on purpose: the foreign key depends on the INDEX and survives a
    // rename, so the slot FK is still the correct composite one and the ONLY thing missing is the
    // named UNIQUE the FK is built on. That isolates this check instead of letting the FK check
    // above pass the test for it.
    await withClient(pool, async (client) => {
      await client.query(
        `ALTER TABLE qf_jarvis.approval_request_record
           RENAME CONSTRAINT approval_request_record_action_request_key TO approval_request_record_renamed`,
      );
    });
    await expectCode(queue.assertReady(), 'schema-incompatible', 'missing composite UNIQUE');
    await resetAndMigrate(pool, testDatabaseConfig('qf-p08-queue-test'));
  }, 300_000);

  it('refuses readiness when the database is unavailable', async () => {
    const dead = createTestPool('qf-p08-queue-dead');
    await closeDatabasePool(dead);
    const deadQueue = createPostgresApprovalQueue({ pool: dead });
    await expectCode(deadQueue.assertReady(), 'database-unavailable');
  });

  describe('the migration-issued least-privilege role', () => {
    const RUNTIME_ROLE = 'qf_jarvis_runtime';
    const LOCAL_ONLY_PASSWORD = 'local-p08q-only';

    beforeAll(async () => {
      // Created BEFORE migrating, so 0009's conditional grant block actually fires for it.
      await ensureLoginRole(pool, RUNTIME_ROLE, LOCAL_ONLY_PASSWORD);
      await resetAndMigrate(pool, testDatabaseConfig('qf-p08-queue-test'));
    }, 180_000);

    it('is ready, and holds no DELETE or TRUNCATE anywhere', async () => {
      const rolePool = createDatabasePool(
        testDatabaseConfigAs(RUNTIME_ROLE, LOCAL_ONLY_PASSWORD, 'qf-p08-queue-role'),
      );
      try {
        await expect(
          createPostgresApprovalQueue({ pool: rolePool }).assertReady(),
        ).resolves.toBeUndefined();
      } finally {
        await closeDatabasePool(rolePool);
      }

      const privileges = await withClient(pool, async (client) => {
        const result = await client.query(
          `SELECT grantee, table_name, privilege_type
             FROM information_schema.table_privileges
            WHERE table_schema = 'qf_jarvis' AND grantee = $1
              AND table_name LIKE 'approval\\_%'`,
          [RUNTIME_ROLE],
        );
        return result.rows as { table_name: string; privilege_type: string }[];
      });
      // Read and append only. UPDATE appears nowhere at table level -- the slot pointer is a
      // COLUMN-level grant, so the runtime cannot move a slot's key even if the trigger were dropped.
      expect([...new Set(privileges.map((p) => p.privilege_type))].sort()).toEqual([
        'INSERT',
        'SELECT',
      ]);
      const columnUpdates = await withClient(pool, async (client) => {
        const result = await client.query(
          `SELECT table_name, column_name FROM information_schema.column_privileges
            WHERE table_schema = 'qf_jarvis' AND grantee = $1 AND privilege_type = 'UPDATE'
              AND table_name LIKE 'approval\\_%'`,
          [RUNTIME_ROLE],
        );
        return result.rows as { table_name: string; column_name: string }[];
      });
      expect(columnUpdates).toEqual([
        { table_name: 'approval_active_slot', column_name: 'active_approval_request_id' },
      ]);
    }, 120_000);
  });
});

// ---------------------------------------------------------------------------
// Enqueue.
// ---------------------------------------------------------------------------

describe('enqueueRequest', () => {
  it('durably stores an ask, and a brand new pool reads it back', async () => {
    const source = recommendationSource('b1b1b1b1');
    const request = approvalRequest(source);

    const created = await queue.enqueueRequest({ source, request });
    expect(created.outcome).toBe('CREATED');
    expect(created.request).toEqual(request);
    expect(await auditTypes(request.approvalRequestId)).toEqual(['REQUEST_ENQUEUED']);
    expect(await slotPointer(source)).toBe(request.approvalRequestId);

    // A completely separate pool: nothing survives except the database.
    const other = createTestPool('qf-p08-queue-restart');
    try {
      const restarted = createPostgresApprovalQueue({ pool: other });
      const record = await restarted.readRequest(request.approvalRequestId);
      expect(record.request).toEqual(request);
      // The canonical source came back too, so a later decision can be re-proved against it.
      expect(record.source.recommendation).toEqual(source.recommendation);
      expect(record.source.actionBindings).toEqual(source.actionBindings);
    } finally {
      await closeDatabasePool(other);
    }
  }, 60_000);

  it('replays an exact reissue read-only, appending no second audit row', async () => {
    const source = recommendationSource('b2b2b2b2');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const replay = await queue.enqueueRequest({ source, request });
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.request).toEqual(request);
    // Nothing happened this time.
    expect(await auditTypes(request.approvalRequestId)).toEqual(['REQUEST_ENQUEUED']);
  }, 60_000);

  it('refuses the same request id naming a different ask', async () => {
    const source = recommendationSource('b3b3b3b3');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const tampered: ApprovalRequestV1 = { ...request, expiresAt: '2026-08-03T11:00:00Z' };
    await expectCode(queue.enqueueRequest({ source, request: tampered }), 'request-conflict');
  }, 60_000);

  it('refuses a SECOND active ask for the same action', async () => {
    // The invariant: ApprovalDecisionV1 carries no approvalRequestId, so two open asks for one
    // action would make an arriving decision ambiguous between them.
    const source = recommendationSource('b4b4b4b4');
    const first = approvalRequest(source);
    await queue.enqueueRequest({ source, request: first });

    const second = approvalRequest(source, {
      createdAt: '2026-08-02T11:00:00Z',
      expiresAt: '2026-08-03T11:00:00Z',
    });
    expect(second.approvalRequestId).not.toBe(first.approvalRequestId);
    await expectCode(queue.enqueueRequest({ source, request: second }), 'active-request-conflict');

    // Zero effect: the slot still names the first, and the loser wrote nothing.
    expect(await slotPointer(source)).toBe(first.approvalRequestId);
    expect(await auditTypes(second.approvalRequestId)).toEqual([]);
    await expectCode(queue.readRequest(second.approvalRequestId), 'request-not-found');
  }, 60_000);

  it('allows concurrent asks for DIFFERENT actions of one recommendation', async () => {
    // Different keys, different slot rows: the invariant is per action, not per recommendation.
    const source = twoActionSource('b5b5b5b5');
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, { actionIndex: 1 });
    expect((await queue.enqueueRequest({ source, request: a })).outcome).toBe('CREATED');
    expect((await queue.enqueueRequest({ source, request: b })).outcome).toBe('CREATED');
    expect(await slotPointer(source, 0)).toBe(a.approvalRequestId);
    expect(await slotPointer(source, 1)).toBe(b.approvalRequestId);
  }, 60_000);

  it('replaces an ask that had already expired at the new ask’s own instant', async () => {
    // The comparison is against the INCOMING request's createdAt -- a causal instant the caller
    // stated -- never a clock this process read. Two runs of the same sequence therefore agree.
    const source = recommendationSource('b6b6b6b6');
    const old = approvalRequest(source, {
      createdAt: '2026-08-02T09:30:00Z',
      expiresAt: '2026-08-02T10:00:00Z',
    });
    await queue.enqueueRequest({ source, request: old });

    const fresh = approvalRequest(source, {
      createdAt: '2026-08-02T10:00:00Z',
      expiresAt: '2026-08-03T10:00:00Z',
    });
    expect((await queue.enqueueRequest({ source, request: fresh })).outcome).toBe('CREATED');
    expect(await slotPointer(source)).toBe(fresh.approvalRequestId);

    // The replacement is explained in the audit, exactly once, against the ask that expired.
    expect(await auditTypes(old.approvalRequestId)).toEqual([
      'REQUEST_ENQUEUED',
      'REQUEST_EXPIRY_OBSERVED',
    ]);
    expect(await auditTypes(fresh.approvalRequestId)).toEqual(['REQUEST_ENQUEUED']);
    // And the expired ask is still readable: it was not deleted, only superseded.
    expect((await queue.readRequest(old.approvalRequestId)).request).toEqual(old);
  }, 60_000);

  it('stores the CANONICAL source, not whatever the caller attached', async () => {
    const source = recommendationSource('b7b7b7b7');
    const request = approvalRequest(source);
    await queue.enqueueRequest({
      source: { ...source, extraKey: 'ignored' } as unknown as RecommendationRuntimeResult,
      request,
    });
    const stored = await withClient(pool, async (client) => {
      const result = await client.query(
        'SELECT source_snapshot FROM qf_jarvis.approval_request_record WHERE approval_request_id = $1',
        [request.approvalRequestId],
      );
      return (result.rows[0] as { source_snapshot: Record<string, unknown> }).source_snapshot;
    });
    expect(Object.keys(stored).sort()).toEqual(['actionBindings', 'recommendation']);
  }, 60_000);

  it('refuses a tampered request or a tampered source', async () => {
    const source = recommendationSource('b8b8b8b8');
    const request = approvalRequest(source);

    // Every field a laundering attempt would have to move. The runtime rebuild catches all of them
    // without this package restating a single approval rule.
    for (const over of [
      { risk: 'low-risk-reversible' },
      { requestedAuthority: 'delegated-approver' },
      { requestingAgent: 'jarvis' },
      { requestingAgentVersion: 'anisha.v2' },
      { summary: 'A different description of the same action.' },
      { actionFingerprint: 'a'.repeat(64) },
      // `policy` is deliberately NOT in this list. It is a caller-stated citation, not a value
      // derived from the recommendation, so a different policy is a different legitimate ask --
      // and reusing an id for one is caught as `request-conflict` by the spec above, not here.
    ]) {
      await expectCode(
        queue.enqueueRequest({ source, request: { ...request, ...over } as ApprovalRequestV1 }),
        'binding-invalid',
        JSON.stringify(over),
      );
    }

    // Anti-substitution, at storage time: same ids, changed action content.
    const action = source.recommendation.proposedActions[0];
    if (action === undefined) {
      throw new Error('unreachable');
    }
    const mutated = {
      recommendation: {
        ...source.recommendation,
        proposedActions: [{ ...action, parameters: { channel: 'sms', delayHours: 1 } }],
      },
      actionBindings: source.actionBindings,
    } as unknown as RecommendationRuntimeResult;
    await expectCode(queue.enqueueRequest({ source: mutated, request }), 'binding-invalid');
  }, 120_000);

  it('refuses an informational recommendation and a malformed input', async () => {
    const informational = recommendationSource('b9b9b9b9', {
      risk: 'informational',
      requiredApproval: 'none',
      proposedActions: [],
    });
    const other = recommendationSource('babababa');
    const request = approvalRequest(other);
    // No action to ask about, and the request contract refuses an informational risk anyway.
    await expectCode(queue.enqueueRequest({ source: informational, request }), 'binding-invalid');

    const malformed: readonly [string, unknown][] = [
      ['undefined', undefined],
      ['null', null],
      ['string', 'input'],
      ['empty object', {}],
      ['source without request', { source: other }],
    ];
    for (const [label, bad] of malformed) {
      await expectCode(queue.enqueueRequest(bad as never), 'invalid-input', label);
    }
  }, 60_000);

  it('lets exactly one of two concurrent overlapping asks win', async () => {
    // Genuine contention across two separate sessions on the same slot row.
    const source = recommendationSource('bcbcbcbc');
    const a = approvalRequest(source);
    const b = approvalRequest(source, {
      createdAt: '2026-08-02T10:30:00Z',
      expiresAt: '2026-08-03T10:30:00Z',
    });

    const poolTwo = createTestPool('qf-p08-queue-race');
    try {
      const other = createPostgresApprovalQueue({ pool: poolTwo });
      const results = await Promise.allSettled([
        queue.enqueueRequest({ source, request: a }),
        other.enqueueRequest({ source, request: b }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: 'active-request-conflict' });

      // One request row, one slot target, one enqueue audit.
      const counts = await withClient(pool, async (client) => {
        const result = await client.query(
          `SELECT (SELECT count(*)::text FROM qf_jarvis.approval_request_record) AS requests,
                  (SELECT count(*)::text FROM qf_jarvis.approval_queue_audit) AS audits`,
        );
        return result.rows[0] as { requests: string; audits: string };
      });
      expect(counts).toEqual({ requests: '1', audits: '1' });
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);

  it('gives both callers the same result for a concurrent exact duplicate', async () => {
    const source = recommendationSource('bdbdbdbd');
    const request = approvalRequest(source);
    const poolTwo = createTestPool('qf-p08-queue-dup');
    try {
      const other = createPostgresApprovalQueue({ pool: poolTwo });
      const [a, b] = await Promise.all([
        queue.enqueueRequest({ source, request }),
        other.enqueueRequest({ source, request }),
      ]);
      expect(a.request).toEqual(b.request);
      expect([a.outcome, b.outcome].sort()).toEqual(['CREATED', 'REPLAYED']);
      // One durable effect, one audit row.
      expect(await auditTypes(request.approvalRequestId)).toEqual(['REQUEST_ENQUEUED']);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The active queue.
// ---------------------------------------------------------------------------

describe('listActiveRequests', () => {
  it('derives active at the CALLER’s instant, and survives a restart', async () => {
    const source = twoActionSource('c1c1c1c1');
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, {
      actionIndex: 1,
      createdAt: REQ_CREATED_AT,
      expiresAt: '2026-08-02T18:00:00Z',
    });
    await queue.enqueueRequest({ source, request: a });
    await queue.enqueueRequest({ source, request: b });

    const other = createTestPool('qf-p08-queue-active');
    try {
      const restarted = createPostgresApprovalQueue({ pool: other });
      const active = await restarted.listActiveRequests({
        observedAt: '2026-08-02T12:00:00Z',
        limit: 50,
      });
      // Soonest expiry first, deterministically.
      expect(active.map((e) => e.approvalRequestId)).toEqual([
        b.approvalRequestId,
        a.approvalRequestId,
      ]);

      // Observed later, `b` has expired -- without anything being written.
      const later = await restarted.listActiveRequests({
        observedAt: '2026-08-02T19:00:00Z',
        limit: 50,
      });
      expect(later.map((e) => e.approvalRequestId)).toEqual([a.approvalRequestId]);
    } finally {
      await closeDatabasePool(other);
    }
  }, 60_000);

  it('returns a minimal projection with no rationale, evidence or action parameters', async () => {
    const source = recommendationSource('c2c2c2c2');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const [entry] = await queue.listActiveRequests({
      observedAt: '2026-08-02T12:00:00Z',
      limit: 10,
    });
    expect(entry).toBeDefined();
    if (entry === undefined) {
      throw new Error('unreachable');
    }
    expect(Object.keys(entry).sort()).toEqual([
      'approvalRequestId',
      'correlationId',
      'createdAt',
      'expiresAt',
      'policy',
      'proposedActionId',
      'recommendationId',
      'requestedAuthority',
      'requestingAgent',
      'requestingAgentVersion',
      'risk',
      'summary',
    ]);
    // A queue listing is read far more often than it is acted on, so it carries no business detail.
    const serialized = JSON.stringify(entry);
    for (const forbidden of [
      'Two follow-ups have gone unanswered',
      'vendor.unresponsive',
      'whatsapp',
      'delayHours',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
    expect(Object.isFrozen(entry)).toBe(true);
  }, 60_000);

  it('drops a decided request from the active list', async () => {
    const source = recommendationSource('c3c3c3c3');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision: coreDecision(source, [
        { actionId: request.proposedActionId, decision: 'approved' },
      ]),
    });
    expect(
      await queue.listActiveRequests({ observedAt: '2026-08-02T13:00:00Z', limit: 10 }),
    ).toEqual([]);
  }, 60_000);

  it('refuses a missing instant or an unbounded limit', async () => {
    for (const input of [
      {},
      { observedAt: '2026-08-02T12:00:00Z' },
      { observedAt: '', limit: 10 },
      { observedAt: '2026-08-02T12:00:00Z', limit: 0 },
      { observedAt: '2026-08-02T12:00:00Z', limit: 5000 },
      { observedAt: '2026-08-02T12:00:00Z', limit: 1.5 },
    ]) {
      await expectCode(
        queue.listActiveRequests(input as never),
        'invalid-input',
        JSON.stringify(input),
      );
    }
  });

  it('refuses a malformed observation instant by the CONTRACT’s grammar', async () => {
    // `typeof string && length > 0` accepted every one of these and handed it to PostgreSQL, where a
    // caller's mistake came back as a driver error and then `database-unavailable` -- an outage
    // reported for a typo. The grammar is `utcTimestampSchema`'s, not one invented here.
    for (const observedAt of [
      '',
      'not-a-time',
      'now()',
      '2026-08-02', // date only
      '2026-08-02T12:00:00', // no zone at all
      '2026-08-02 12:00:00Z', // space instead of T
      '2026-08-02T12:00:00+05:30', // a local offset: two systems would have to agree on a tz database
      '2026-08-02t12:00:00z', // lowercase designators
      '2026-02-30T00:00:00Z', // well-formed, parses, and does not exist
      '2026-13-02T00:00:00Z', // impossible month
      '2026-08-02T25:00:00Z', // impossible hour
      '2026-08-02T12:60:00Z', // impossible minute
      ' 2026-08-02T12:00:00Z', // leading whitespace
      '2026-08-02T12:00:00Z ', // trailing whitespace
      "2026-08-02T12:00:00Z'; DROP TABLE qf_jarvis.approval_request_record; --",
    ]) {
      await expectCode(
        queue.listActiveRequests({ observedAt, limit: 10 }),
        'invalid-input',
        JSON.stringify(observedAt),
      );
    }
    for (const [index, observedAt] of [
      undefined,
      null,
      12345,
      1_754_136_000_000,
      {},
      [],
      true,
    ].entries()) {
      await expectCode(
        queue.listActiveRequests({ observedAt, limit: 10 } as never),
        'invalid-input',
        `non-string #${String(index)} (${typeof observedAt})`,
      );
    }
  }, 60_000);

  it('reaches the database ZERO times for a malformed instant', async () => {
    // The refusal must be a validation, not a round trip that happens to fail. A pool that throws on
    // contact proves it: if anything reached it the error would be that, not `invalid-input`.
    const counting = countingPool();
    const isolated = createPostgresApprovalQueue({ pool: counting.pool });
    for (const observedAt of ['', 'not-a-time', '2026-02-30T00:00:00Z', '2026-08-02']) {
      await expectCode(
        isolated.listActiveRequests({ observedAt, limit: 10 }),
        'invalid-input',
        observedAt,
      );
    }
    // And the same for the limit, which is validated on the same pre-SQL path.
    await expectCode(
      isolated.listActiveRequests({ observedAt: '2026-08-02T12:00:00Z', limit: 5000 }),
      'invalid-input',
    );
    expect(counting.calls()).toBe(0);
  });

  it('accepts every well-formed UTC instant the contract admits', async () => {
    const source = recommendationSource('c4c4c4c4');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    for (const observedAt of [
      '2026-08-02T12:00:00Z',
      '2026-08-02T12:00:00.5Z',
      '2026-08-02T12:00:00.123456789Z',
      '2026-08-02T23:59:59Z',
    ]) {
      const active = await queue.listActiveRequests({ observedAt, limit: 10 });
      expect(
        active.map((e) => e.approvalRequestId),
        observedAt,
      ).toEqual([request.approvalRequestId]);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Recording a decision.
// ---------------------------------------------------------------------------

describe('recordDecision', () => {
  it('stores the decision verbatim, links it, and clears only this slot', async () => {
    const source = recommendationSource('d1d1d1d1');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const result = await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision,
    });

    expect(result.outcome).toBe('CREATED');
    expect(result.correlation.approvalRequestId).toBe(request.approvalRequestId);
    expect(result.correlation.actionDecision).toEqual({
      actionId: request.proposedActionId,
      decision: 'approved',
    });
    expect(result.correlation.decision).toEqual(decision);
    expect(await slotPointer(source)).toBeNull();
    expect(await auditTypes(request.approvalRequestId)).toEqual([
      'REQUEST_ENQUEUED',
      'DECISION_LINKED',
    ]);

    // Restart: the correlation is re-derived from durable evidence, not replayed from a summary.
    const other = createTestPool('qf-p08-queue-decision-restart');
    try {
      const restarted = createPostgresApprovalQueue({ pool: other });
      const read = await restarted.readDecisionForRequest(request.approvalRequestId);
      expect(read.decision).toEqual(decision);
      expect(read.actionDecision.decision).toBe('approved');
      expect(read.actionFingerprint).toBe(request.actionFingerprint);
    } finally {
      await closeDatabasePool(other);
    }
  }, 60_000);

  it('replays an exact reissue read-only, appending no second audit row', async () => {
    const source = recommendationSource('d2d2d2d2');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    const first = await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision,
    });
    const replay = await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision,
    });
    expect(replay.outcome).toBe('REPLAYED');
    expect(replay.correlation).toEqual(first.correlation);
    expect(await auditTypes(request.approvalRequestId)).toEqual([
      'REQUEST_ENQUEUED',
      'DECISION_LINKED',
    ]);
  }, 60_000);

  it('refuses a second, different decision for an already-answered ask', async () => {
    const source = recommendationSource('d3d3d3d3');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision: coreDecision(source, [
        { actionId: request.proposedActionId, decision: 'approved' },
      ]),
    });
    await expectCode(
      queue.recordDecision({
        approvalRequestId: request.approvalRequestId,
        decision: coreDecision(source, [
          { actionId: request.proposedActionId, decision: 'rejected' },
        ]),
      }),
      'request-already-decided',
    );
  }, 60_000);

  it('refuses the same decision id carrying different content', async () => {
    const source = twoActionSource('d4d4d4d4');
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, { actionIndex: 1 });
    await queue.enqueueRequest({ source, request: a });
    await queue.enqueueRequest({ source, request: b });

    const decision = coreDecision(source, [
      { actionId: first.actionId, decision: 'approved' },
      { actionId: second.actionId, decision: 'approved' },
    ]);
    await queue.recordDecision({ approvalRequestId: a.approvalRequestId, decision });

    // Same decisionId, different payload.
    const altered = { ...decision, reasonCode: 'core.reconsidered' };
    await expectCode(
      queue.recordDecision({ approvalRequestId: b.approvalRequestId, decision: altered }),
      'decision-conflict',
    );
  }, 60_000);

  it('links ONE decision to the asks for two different actions', async () => {
    // ApprovalDecisionV1 is recommendation-level: one Core answer legitimately covers A and B.
    const source = twoActionSource('d5d5d5d5');
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, { actionIndex: 1 });
    await queue.enqueueRequest({ source, request: a });
    await queue.enqueueRequest({ source, request: b });

    // Partial approval: A rejected, B approved, overall approved.
    const decision = coreDecision(source, [
      { actionId: first.actionId, decision: 'rejected' },
      { actionId: second.actionId, decision: 'approved' },
    ]);

    const resultA = await queue.recordDecision({
      approvalRequestId: a.approvalRequestId,
      decision,
    });
    const resultB = await queue.recordDecision({
      approvalRequestId: b.approvalRequestId,
      decision,
    });

    // The per-action verdict wins for each action; the overall outcome does not overwrite it.
    expect(resultA.correlation.decision.outcome).toBe('approved');
    expect(resultA.correlation.actionDecision.decision).toBe('rejected');
    expect(resultB.correlation.actionDecision.decision).toBe('approved');

    const counts = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT (SELECT count(*)::text FROM qf_jarvis.approval_decision_record) AS decisions,
                (SELECT count(*)::text FROM qf_jarvis.approval_request_decision_link) AS links,
                (SELECT count(*)::text FROM qf_jarvis.approval_queue_audit
                  WHERE event_type = 'DECISION_LINKED') AS linked_audits`,
      );
      return result.rows[0] as Record<string, string>;
    });
    // ONE decision row, TWO links, TWO audit rows.
    expect(counts).toEqual({ decisions: '1', links: '2', linked_audits: '2' });
    expect(await slotPointer(source, 0)).toBeNull();
    expect(await slotPointer(source, 1)).toBeNull();
  }, 90_000);

  it('does NOT clear a newer slot when an expired ask is decided late', async () => {
    // A1 expires and A2 replaces it. A historically valid Core decision for A1 may still arrive --
    // and must not clear the slot belonging to its replacement.
    const source = recommendationSource('d6d6d6d6');
    const older = approvalRequest(source, {
      createdAt: '2026-08-02T09:30:00Z',
      expiresAt: '2026-08-02T10:00:00Z',
    });
    await queue.enqueueRequest({ source, request: older });

    const newer = approvalRequest(source, {
      createdAt: '2026-08-02T10:00:00Z',
      expiresAt: '2026-08-03T10:00:00Z',
    });
    await queue.enqueueRequest({ source, request: newer });
    expect(await slotPointer(source)).toBe(newer.approvalRequestId);

    // Decided inside A1's own validity window, which is what makes it historically valid.
    const lateDecision = coreDecision(
      source,
      [{ actionId: older.proposedActionId, decision: 'approved' }],
      { decidedAt: '2026-08-02T09:45:00Z' },
    );
    const result = await queue.recordDecision({
      approvalRequestId: older.approvalRequestId,
      decision: lateDecision,
    });
    expect(result.outcome).toBe('CREATED');

    // The newer ask is untouched and still active.
    expect(await slotPointer(source)).toBe(newer.approvalRequestId);
    const active = await queue.listActiveRequests({
      observedAt: '2026-08-02T12:00:00Z',
      limit: 10,
    });
    expect(active.map((e) => e.approvalRequestId)).toEqual([newer.approvalRequestId]);
  }, 90_000);

  it('refuses a decision that does not correlate to the stored ask', async () => {
    const source = recommendationSource('d7d7d7d7');
    const foreign = recommendationSource('d8d8d8d8');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const foreignAction = foreign.recommendation.proposedActions[0];
    if (foreignAction === undefined) {
      throw new Error('unreachable');
    }
    for (const decision of [
      // A different recommendation entirely.
      coreDecision(foreign, [{ actionId: foreignAction.actionId, decision: 'approved' }]),
      // Right recommendation, an action that is not in it.
      coreDecision(source, [{ actionId: foreignAction.actionId, decision: 'approved' }]),
      // Right recommendation, silent about the requested action.
      coreDecision(source, [], { outcome: 'rejected' }),
      // A different correlation thread.
      coreDecision(source, [{ actionId: request.proposedActionId, decision: 'approved' }], {
        correlationId: '77777777-8888-4999-8aaa-bbbbbbbbbbbb',
      }),
      // Decided after the ask expired: expiry is not approval, and a late yes is not a yes.
      coreDecision(source, [{ actionId: request.proposedActionId, decision: 'approved' }], {
        decidedAt: '2026-08-03T11:00:00Z',
      }),
      // Decided before the ask was made.
      coreDecision(source, [{ actionId: request.proposedActionId, decision: 'approved' }], {
        decidedAt: '2026-08-02T09:30:00Z',
      }),
    ]) {
      await expectCode(
        queue.recordDecision({ approvalRequestId: request.approvalRequestId, decision }),
        'binding-invalid',
        decision.decisionId,
      );
    }
    // Nothing was written by any of them.
    expect(await auditTypes(request.approvalRequestId)).toEqual(['REQUEST_ENQUEUED']);
    expect(await slotPointer(source)).toBe(request.approvalRequestId);
  }, 120_000);

  it('refuses a decision Core could not have issued, and a missing ask', async () => {
    const source = recommendationSource('d9d9d9d9');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    const approved = [{ actionId: request.proposedActionId, decision: 'approved' as const }];

    for (const over of [
      { issuer: 'qf-jarvis' },
      { decidedBy: { actorType: 'agent', agentId: 'anisha' } },
      { outcome: 'rejected' },
      { outcome: 'pending' },
    ]) {
      await expectCode(
        queue.recordDecision({
          approvalRequestId: request.approvalRequestId,
          decision: coreDecision(source, approved, over),
        }),
        'invalid-input',
        JSON.stringify(over),
      );
    }

    await expectCode(
      queue.recordDecision({
        approvalRequestId: 'ffffffff-0000-4000-8000-000000000001',
        decision: coreDecision(source, approved),
      }),
      'request-not-found',
    );
    for (const bad of ['not-a-uuid', '', undefined]) {
      await expectCode(
        queue.recordDecision({
          approvalRequestId: bad,
          decision: coreDecision(source, approved),
        } as never),
        'invalid-input',
        String(bad),
      );
    }
  }, 90_000);

  it('carries no authorization, execution or consent field in the result', async () => {
    const source = recommendationSource('dadadada');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    const result = await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision: coreDecision(source, [
        { actionId: request.proposedActionId, decision: 'approved' },
      ]),
    });
    expect(Object.keys(result).sort()).toEqual(['correlation', 'outcome']);
    const surface = result.correlation as unknown as Record<string, unknown>;
    for (const forbidden of [
      'isAuthorized',
      'canExecute',
      'canSend',
      'communicationAuthorized',
      'consentValid',
      'status',
      'pending',
      'approved',
      'idempotencyKey',
      'recipient',
    ]) {
      expect(surface[forbidden], forbidden).toBeUndefined();
    }
  }, 60_000);

  it('resolves a concurrent exact duplicate to one durable effect', async () => {
    const source = recommendationSource('dbdbdbdb');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);

    const poolTwo = createTestPool('qf-p08-queue-dec-dup');
    try {
      const other = createPostgresApprovalQueue({ pool: poolTwo });
      const [a, b] = await Promise.all([
        queue.recordDecision({ approvalRequestId: request.approvalRequestId, decision }),
        other.recordDecision({ approvalRequestId: request.approvalRequestId, decision }),
      ]);
      expect(a.correlation).toEqual(b.correlation);
      expect([a.outcome, b.outcome].sort()).toEqual(['CREATED', 'REPLAYED']);
      expect(await auditTypes(request.approvalRequestId)).toEqual([
        'REQUEST_ENQUEUED',
        'DECISION_LINKED',
      ]);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);

  it('records ONE shared decision from two concurrent requests, held at the barrier', async () => {
    // The defect PR #84's final review found. A decision is RECOMMENDATION-level, so the requests for
    // actions A and B may lawfully record the same one at the same time. Both look, neither finds it,
    // both insert; one wins the identity and the other's `ON CONFLICT DO NOTHING` reports zero rows.
    // That said only "someone else won the decision ROW" -- never "someone else answered MY ask" --
    // and treating it as a duplicate race sent the loser to reconcile against a link the winner had
    // no reason to create. `repository-invariant`, for an entirely lawful sequence.
    const source = twoActionSource('dededede');
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, { actionIndex: 1 });
    await queue.enqueueRequest({ source, request: a });
    await queue.enqueueRequest({ source, request: b });

    // Partial approval: overall approved, A rejected, B approved. Each ask must get ITS verdict.
    const decision = coreDecision(source, [
      { actionId: first.actionId, decision: 'rejected' },
      { actionId: second.actionId, decision: 'approved' },
    ]);

    const gate = createBarrier(2);
    const poolOne = createTestPool('qf-p08-queue-shared-a');
    const poolTwo = createTestPool('qf-p08-queue-shared-b');
    try {
      const sideA = createPostgresApprovalQueue({ pool: poolHeldAtDecisionLookup(poolOne, gate) });
      const sideB = createPostgresApprovalQueue({ pool: poolHeldAtDecisionLookup(poolTwo, gate) });
      const [resultA, resultB] = await Promise.all([
        sideA.recordDecision({ approvalRequestId: a.approvalRequestId, decision }),
        sideB.recordDecision({ approvalRequestId: b.approvalRequestId, decision }),
      ]);

      // BOTH succeed. Neither leaks repository-invariant, database-unavailable or the sentinel.
      expect(resultA.outcome).toBe('CREATED');
      expect(resultB.outcome).toBe('CREATED');
      // Each ask keeps its OWN verdict; the overall outcome does not overwrite it.
      expect(resultA.correlation.decision.outcome).toBe('approved');
      expect(resultA.correlation.actionDecision.decision).toBe('rejected');
      expect(resultB.correlation.actionDecision.decision).toBe('approved');
    } finally {
      await closeDatabasePool(poolOne);
      await closeDatabasePool(poolTwo);
    }

    const counts = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT (SELECT count(*)::text FROM qf_jarvis.approval_decision_record) AS decisions,
                (SELECT count(*)::text FROM qf_jarvis.approval_request_decision_link) AS links,
                (SELECT count(*)::text FROM qf_jarvis.approval_queue_audit
                  WHERE event_type = 'DECISION_LINKED') AS linked_audits`,
      );
      return result.rows[0] as Record<string, string>;
    });
    // ONE decision row, TWO links, TWO audit rows -- the same durable shape as the sequential case.
    expect(counts).toEqual({ decisions: '1', links: '2', linked_audits: '2' });
    expect(await slotPointer(source, 0)).toBeNull();
    expect(await slotPointer(source, 1)).toBeNull();

    // And re-read from durable evidence, each request still correlates to its own verdict.
    expect((await queue.readDecisionForRequest(a.approvalRequestId)).actionDecision.decision).toBe(
      'rejected',
    );
    expect((await queue.readDecisionForRequest(b.approvalRequestId)).actionDecision.decision).toBe(
      'approved',
    );
  }, 120_000);

  it('refuses the loser when two concurrent requests share a decision ID but not its content', async () => {
    // Same rendezvous, opposite verdict. One decision identity wins; the other caller is told the
    // identity already names something else, and its candidate link and audit roll back with it.
    const source = twoActionSource('dfdfdfdf');
    const [first, second] = source.recommendation.proposedActions;
    if (first === undefined || second === undefined) {
      throw new Error('unreachable');
    }
    const a = approvalRequest(source, { actionIndex: 0 });
    const b = approvalRequest(source, { actionIndex: 1 });
    await queue.enqueueRequest({ source, request: a });
    await queue.enqueueRequest({ source, request: b });

    const sharedId = 'eeeeeeee-9999-4000-8000-777777777777';
    const decisionOne = coreDecision(
      source,
      [
        { actionId: first.actionId, decision: 'approved' },
        { actionId: second.actionId, decision: 'approved' },
      ],
      { decisionId: sharedId },
    );
    const decisionTwo = coreDecision(
      source,
      [
        { actionId: first.actionId, decision: 'rejected' },
        { actionId: second.actionId, decision: 'rejected' },
      ],
      { decisionId: sharedId },
    );

    const gate = createBarrier(2);
    const poolOne = createTestPool('qf-p08-queue-split-a');
    const poolTwo = createTestPool('qf-p08-queue-split-b');
    let results: PromiseSettledResult<unknown>[];
    try {
      const sideA = createPostgresApprovalQueue({ pool: poolHeldAtDecisionLookup(poolOne, gate) });
      const sideB = createPostgresApprovalQueue({ pool: poolHeldAtDecisionLookup(poolTwo, gate) });
      results = await Promise.allSettled([
        sideA.recordDecision({ approvalRequestId: a.approvalRequestId, decision: decisionOne }),
        sideB.recordDecision({ approvalRequestId: b.approvalRequestId, decision: decisionTwo }),
      ]);
    } finally {
      await closeDatabasePool(poolOne);
      await closeDatabasePool(poolTwo);
    }

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r) => r.status === 'rejected');
    expect(loser?.reason).toMatchObject({ code: 'decision-conflict' });

    // Exactly one durable decision payload, one link, one audit row: the loser wrote nothing.
    const counts = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT (SELECT count(*)::text FROM qf_jarvis.approval_decision_record) AS decisions,
                (SELECT count(*)::text FROM qf_jarvis.approval_request_decision_link) AS links,
                (SELECT count(*)::text FROM qf_jarvis.approval_queue_audit
                  WHERE event_type = 'DECISION_LINKED') AS linked_audits`,
      );
      return result.rows[0] as Record<string, string>;
    });
    expect(counts).toEqual({ decisions: '1', links: '1', linked_audits: '1' });

    // The losing ask remains unanswered and still active -- nothing about it was decided.
    const undecided = results[0]?.status === 'rejected' ? a : b;
    await expectCode(
      queue.readDecisionForRequest(undecided.approvalRequestId),
      'request-not-found',
    );
    expect(
      (await queue.listActiveRequests({ observedAt: '2026-08-02T13:00:00Z', limit: 10 })).map(
        (e) => e.approvalRequestId,
      ),
    ).toEqual([undecided.approvalRequestId]);
  }, 120_000);

  it('lets exactly one of two concurrent CONFLICTING decisions win', async () => {
    const source = recommendationSource('dcdcdcdc');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const poolTwo = createTestPool('qf-p08-queue-dec-conflict');
    try {
      const other = createPostgresApprovalQueue({ pool: poolTwo });
      const results = await Promise.allSettled([
        queue.recordDecision({
          approvalRequestId: request.approvalRequestId,
          decision: coreDecision(source, [
            { actionId: request.proposedActionId, decision: 'approved' },
          ]),
        }),
        other.recordDecision({
          approvalRequestId: request.approvalRequestId,
          decision: coreDecision(source, [
            { actionId: request.proposedActionId, decision: 'rejected' },
          ]),
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected');
      expect(loser?.reason).toMatchObject({ code: 'request-already-decided' });

      // The loser's candidate decision row rolled back with its transaction.
      const counts = await withClient(pool, async (client) => {
        const result = await client.query(
          `SELECT (SELECT count(*)::text FROM qf_jarvis.approval_decision_record) AS decisions,
                  (SELECT count(*)::text FROM qf_jarvis.approval_request_decision_link) AS links`,
        );
        return result.rows[0] as Record<string, string>;
      });
      expect(counts).toEqual({ decisions: '1', links: '1' });
      expect(await auditTypes(request.approvalRequestId)).toEqual([
        'REQUEST_ENQUEUED',
        'DECISION_LINKED',
      ]);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The audit.
// ---------------------------------------------------------------------------

describe('the content-free audit', () => {
  it('records references only, in append order', async () => {
    const source = recommendationSource('e1e1e1e1');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    const decision = coreDecision(source, [
      { actionId: request.proposedActionId, decision: 'approved' },
    ]);
    await queue.recordDecision({ approvalRequestId: request.approvalRequestId, decision });

    const audit = await queue.readAuditForRequest(request.approvalRequestId);
    expect(audit.map((r) => r.eventType)).toEqual(['REQUEST_ENQUEUED', 'DECISION_LINKED']);
    expect(audit[0]?.sequence).toBeLessThan(audit[1]?.sequence ?? 0);
    expect(audit[0]?.decisionId).toBeUndefined();
    expect(audit[1]?.decisionId).toBe(decision.decisionId);
    expect(Object.keys(audit[1] ?? {}).sort()).toEqual([
      'approvalRequestId',
      'decisionId',
      'eventType',
      'proposedActionId',
      'recommendationId',
      'recordedAt',
      'sequence',
    ]);

    // No business content anywhere in the audit table.
    const serialized = JSON.stringify(audit);
    for (const forbidden of [
      'Schedule a follow-up',
      'Two follow-ups have gone unanswered',
      'approval.policy',
      'human.approver.1',
      'whatsapp',
      request.actionFingerprint,
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  }, 60_000);

  it('leaks nothing in a refusal', async () => {
    const source = recommendationSource('e2e2e2e2');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    const caught = await queue
      .enqueueRequest({ source, request: { ...request, risk: 'low-risk-reversible' } })
      .then(
        () => undefined,
        (error: unknown) => error as Error,
      );
    expect(caught).toBeInstanceOf(PostgresApprovalQueueError);
    const serialized = `${caught?.message ?? ''} ${String(caught?.stack)}`;
    for (const secret of [
      request.approvalRequestId,
      request.actionFingerprint,
      source.recommendation.recommendationId,
      'Schedule a follow-up',
      'approval.policy',
      'qf_jarvis',
      '127.0.0.1',
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// A stored row is untrusted evidence.
// ---------------------------------------------------------------------------

describe('durable evidence is re-proved on read', () => {
  it('refuses a request row whose stored source was altered in place', async () => {
    const source = recommendationSource('f1f1f1f1');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });

    // Edit the stored snapshot behind the adapter's back. The append-only trigger forbids UPDATE,
    // so this uses a fresh row inserted with a mutated snapshot -- the shape a bad restore produces.
    await withClient(pool, async (client) => {
      await client.query('ALTER TABLE qf_jarvis.approval_request_record DISABLE TRIGGER USER');
      await client.query(
        `UPDATE qf_jarvis.approval_request_record
            SET source_snapshot = jsonb_set(source_snapshot,
                  '{recommendation,proposedActions,0,summary}', '"Silently reworded."')
          WHERE approval_request_id = $1`,
        [request.approvalRequestId],
      );
      await client.query('ALTER TABLE qf_jarvis.approval_request_record ENABLE TRIGGER USER');
    });

    // The stored request's fingerprint no longer matches the stored action content.
    await expectCode(
      queue.recordDecision({
        approvalRequestId: request.approvalRequestId,
        decision: coreDecision(source, [
          { actionId: request.proposedActionId, decision: 'approved' },
        ]),
      }),
      'binding-invalid',
    );
    await resetAndMigrate(pool, testDatabaseConfig('qf-p08-queue-test'));
  }, 120_000);
});

// ---------------------------------------------------------------------------
// A rejected verdict is recorded, and confers nothing either way.
// ---------------------------------------------------------------------------

describe('a rejected action', () => {
  it('is recorded exactly as Core stated it', async () => {
    const source = recommendationSource('f2f2f2f2');
    const request = approvalRequest(source);
    await queue.enqueueRequest({ source, request });
    const decision = coreDecision(
      source,
      [{ actionId: request.proposedActionId, decision: 'rejected' }],
      { outcome: 'changes-requested' },
    );
    const result = await queue.recordDecision({
      approvalRequestId: request.approvalRequestId,
      decision,
    });
    // `changes-requested` is a final observation, not a pending state and not a retry.
    expect(result.correlation.decision.outcome).toBe('changes-requested');
    expect(result.correlation.actionDecision.decision).toBe('rejected');

    const link = await withClient(pool, async (client) => {
      const r = await client.query(
        'SELECT selected_action_decision FROM qf_jarvis.approval_request_decision_link WHERE approval_request_id = $1',
        [request.approvalRequestId],
      );
      return (r.rows[0] as { selected_action_decision: string }).selected_action_decision;
    });
    expect(link).toBe('rejected');
    expect(await slotPointer(source)).toBeNull();
  }, 60_000);
});

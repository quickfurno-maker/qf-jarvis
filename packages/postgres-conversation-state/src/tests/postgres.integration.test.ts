/**
 * QFJ-P08-B2 — durable conversation control, against a real PostgreSQL (ADR-0077).
 *
 * These are the tests the phase exists for. QFJ-P08-A proved the control semantics against an
 * in-process fake, which cannot demonstrate the two properties that actually matter in production:
 * that a human takeover survives a restart, and that two concurrent processes cannot both win.
 * Neither is provable without a database, so these tests FAIL rather than skip when one is absent.
 *
 * Every guard lives in `database-harness.ts`: loopback host, test-shaped database name, and a
 * refusal of anything Supabase-, QuickFurno- or production-shaped. The managed database is never
 * touched and still carries migration 0001 only.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createConversationControlCommand } from '@qf-jarvis/conversation-control';
import type { ConversationControlCommandInput } from '@qf-jarvis/conversation-control';

import { createPostgresConversationStateAdapter } from '../index.js';
import type { PostgresConversationStateAdapter } from '../index.js';
import {
  closeDatabasePool,
  createTestPool,
  resetAndMigrate,
  testDatabaseConfig,
  seedConversation,
  withClient,
  type DatabasePool,
} from './database-harness.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(
  new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
);

const TENANT_A = 'tenant.a';
const TENANT_B = 'tenant.b';
const CONVERSATION = 'conv.shared';
const AT = (n: number): string => `2026-08-0${String(n)}T00:00:00.000Z`;

let pool: DatabasePool;
let adapter: PostgresConversationStateAdapter;

beforeAll(async () => {
  pool = createTestPool('qf-p08b2-test');
  await resetAndMigrate(pool, testDatabaseConfig('qf-p08b2-test'));
  adapter = createPostgresConversationStateAdapter({ pool });
}, 120_000);

afterAll(async () => {
  await closeDatabasePool(pool);
});

beforeEach(async () => {
  await withClient(pool, async (client) => {
    // The ledger references the state, so it goes first. TRUNCATE bypasses the row triggers by
    // design -- this is test teardown, not a runtime capability, and the runtime role is granted
    // neither DELETE nor TRUNCATE.
    await client.query('TRUNCATE qf_jarvis.conversation_control_command');
    await client.query('TRUNCATE qf_jarvis.conversation_runtime_state CASCADE');
  });
});

function command(over: Partial<ConversationControlCommandInput> = {}) {
  return createConversationControlCommand({
    commandId: 'ctrl.1',
    conversationId: CONVERSATION,
    expectedRevision: 0,
    action: 'TAKE_OWNERSHIP',
    operatorRef: 'operator.synthetic.1',
    issuedAt: AT(1),
    ...over,
  });
}

const keyA = { tenantId: TENANT_A, conversationId: CONVERSATION };
const keyB = { tenantId: TENANT_B, conversationId: CONVERSATION };

async function ledgerRows(tenantId: string): Promise<readonly Record<string, unknown>[]> {
  return withClient(pool, async (client) => {
    const result = await client.query(
      'SELECT * FROM qf_jarvis.conversation_control_command WHERE tenant_id = $1 ORDER BY sequence',
      [tenantId],
    );
    return result.rows as Record<string, unknown>[];
  });
}

// ---------------------------------------------------------------------------
// Migration and schema.
// ---------------------------------------------------------------------------

describe('migration 0008 and the schema it creates', () => {
  it('leaves migrations 0001-0007 byte-identical', () => {
    // The ledger's locked checksums. A change to any of them is a rewrite of applied history.
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
    };
    for (const [file, expected] of Object.entries(locked)) {
      const actual = createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, file)))
        .digest('hex');
      expect(actual, file).toBe(expected);
    }
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))).toHaveLength(8);
  });

  it('applied 0008 and recorded it in the migration history', async () => {
    const digest = createHash('sha256')
      .update(readFileSync(join(MIGRATIONS_DIR, '0008_conversation_control_persistence.sql')))
      .digest('hex');
    const recorded = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT checksum FROM qf_jarvis.schema_migration WHERE filename = $1`,
        ['0008_conversation_control_persistence.sql'],
      );
      return result.rows[0] as { checksum?: unknown } | undefined;
    });
    expect(recorded).toBeDefined();
    // The runner stores the checksum; whatever its encoding, it must correspond to the file on disk.
    const stored = recorded?.checksum;
    const storedHex = Buffer.isBuffer(stored) ? stored.toString('hex') : String(stored);
    expect(storedHex.toLowerCase()).toContain(digest.slice(0, 16));
  });

  it('creates both tables in qf_jarvis and nothing in public', async () => {
    const rows = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT table_schema, table_name FROM information_schema.tables
          WHERE table_name IN ('conversation_runtime_state', 'conversation_control_command')`,
      );
      return result.rows as { table_schema: string; table_name: string }[];
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.table_schema).toBe('qf_jarvis');
    }
  });

  it('keys state by (tenant_id, conversation_id) and NOT by conversation alone', async () => {
    const constraints = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'qf_jarvis' AND t.relname = 'conversation_runtime_state'`,
      );
      return result.rows as { conname: string; definition: string }[];
    });
    const pk = constraints.find((c) => c.conname === 'conversation_runtime_state_pk');
    expect(pk?.definition).toBe('PRIMARY KEY (tenant_id, conversation_id)');
    // A conversation-only unique index would silently re-impose global uniqueness.
    expect(constraints.some((c) => c.definition.includes('UNIQUE (conversation_id)'))).toBe(false);
  });

  it('makes the command identity unique per tenant and references the state row', async () => {
    const constraints = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'qf_jarvis' AND t.relname = 'conversation_control_command'`,
      );
      return result.rows as { conname: string; definition: string }[];
    });
    expect(
      constraints.find((c) => c.conname === 'conversation_control_command_identity_unique')
        ?.definition,
    ).toBe('UNIQUE (tenant_id, command_id)');
    expect(
      constraints.find((c) => c.conname === 'conversation_control_command_state_fk')?.definition,
    ).toContain('FOREIGN KEY (tenant_id, conversation_id) REFERENCES');
  });

  it('refuses a state DELETE and any ledger UPDATE or DELETE', async () => {
    await seedConversation(pool, { tenantId: TENANT_A, conversationId: CONVERSATION });
    await adapter.applyControlCommand(keyA, command());

    await withClient(pool, async (client) => {
      await expect(
        client.query('DELETE FROM qf_jarvis.conversation_runtime_state WHERE tenant_id = $1', [
          TENANT_A,
        ]),
      ).rejects.toBeDefined();
    });
    await withClient(pool, async (client) => {
      await expect(
        client.query(`UPDATE qf_jarvis.conversation_control_command SET outcome = 'NO_CHANGE'`),
      ).rejects.toBeDefined();
      await expect(
        client.query('DELETE FROM qf_jarvis.conversation_control_command'),
      ).rejects.toBeDefined();
    });
  });

  it('refuses a direct insert that is already controlled, and any out-of-band revision move', async () => {
    await withClient(pool, async (client) => {
      // Importing an ALREADY-CONTROLLED conversation is deliberately not authorized (ADR-0076 §6).
      for (const [revision, takeover, paused] of [
        [1, false, false],
        [0, true, true],
        [0, false, true],
      ] as const) {
        await expect(
          client.query(
            `INSERT INTO qf_jarvis.conversation_runtime_state
               (tenant_id, conversation_id, revision, party_type, data_class,
                cancelled, subject_status, subject_ref, human_takeover, ai_paused, observed_at)
             VALUES ('tenant.x', 'conv.x', $1, 'CLIENT', 'HOSTED_ALLOWED', false, 'clear', NULL, $2, $3, '2026-08-01T00:00:00.000Z')`,
            [revision, takeover, paused],
          ),
        ).rejects.toBeDefined();
      }
    });

    await seedConversation(pool, { tenantId: TENANT_A, conversationId: CONVERSATION });
    await withClient(pool, async (client) => {
      // Every UPDATE must advance the ONE revision by exactly one -- this is what stops a second
      // writer moving a field without invalidating in-flight gates.
      await expect(
        client.query(
          `UPDATE qf_jarvis.conversation_runtime_state SET human_takeover = true
            WHERE tenant_id = $1 AND conversation_id = $2`,
          [TENANT_A, CONVERSATION],
        ),
      ).rejects.toBeDefined();
      await expect(
        client.query(
          `UPDATE qf_jarvis.conversation_runtime_state SET revision = 5
            WHERE tenant_id = $1 AND conversation_id = $2`,
          [TENANT_A, CONVERSATION],
        ),
      ).rejects.toBeDefined();
      await expect(
        client.query(
          `UPDATE qf_jarvis.conversation_runtime_state SET conversation_id = 'conv.renamed', revision = 1
            WHERE tenant_id = $1 AND conversation_id = $2`,
          [TENANT_A, CONVERSATION],
        ),
      ).rejects.toBeDefined();
    });
  });

  it('revokes both tables from PUBLIC', async () => {
    const grants = await withClient(pool, async (client) => {
      const result = await client.query(
        `SELECT has_table_privilege('public', 'qf_jarvis.conversation_runtime_state', 'SELECT') AS s,
                has_table_privilege('public', 'qf_jarvis.conversation_control_command', 'SELECT') AS l`,
      );
      return result.rows[0] as { s: boolean; l: boolean };
    });
    expect(grants.s).toBe(false);
    expect(grants.l).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Provisioning.
// ---------------------------------------------------------------------------

describe('trusted provisioning', () => {
  const input = {
    tenantId: TENANT_A,
    conversationId: CONVERSATION,
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    cancelled: false,
    subjectStatus: 'clear',
    observedAt: AT(1),
  };

  it('creates a row at revision 0, not taken over and not paused', async () => {
    const result = await adapter.provision(input);
    expect(result.outcome).toBe('CREATED');
    expect(result.state.revision).toBe(0);
    expect(result.state.humanTakeover).toBe(false);
    expect(result.state.aiPaused).toBe(false);
    expect(result.state.subjectRef).toBeUndefined();
  });

  it('isolates the same conversation id across two tenants', async () => {
    await adapter.provision(input);
    const other = await adapter.provision({ ...input, tenantId: TENANT_B, partyType: 'VENDOR' });
    expect(other.outcome).toBe('CREATED');
    expect((await adapter.read(keyA)).partyType).toBe('CLIENT');
    expect((await adapter.read(keyB)).partyType).toBe('VENDOR');
  });

  it('is idempotent on the Core-derived facts', async () => {
    await adapter.provision(input);
    const again = await adapter.provision(input);
    expect(again.outcome).toBe('ALREADY_PROVISIONED');
    expect(again.state.revision).toBe(0);
  });

  it('does NOT reset control state when re-provisioned after a takeover', async () => {
    // Provisioning is not synchronisation. A retry after an operator took over must not quietly
    // undo the takeover, which is exactly what "reset to the offered facts" would do.
    await adapter.provision(input);
    await adapter.applyControlCommand(keyA, command());

    const again = await adapter.provision(input);
    expect(again.outcome).toBe('ALREADY_PROVISIONED');
    expect(again.state.revision).toBe(1);
    expect(again.state.humanTakeover).toBe(true);
    expect(again.state.aiPaused).toBe(true);
  });

  it('refuses differing Core-derived facts without mutating anything', async () => {
    await adapter.provision(input);
    for (const over of [
      { partyType: 'VENDOR' },
      { dataClass: 'LOCAL_ONLY' },
      { cancelled: true },
      { subjectStatus: 'erased' },
      { subjectRef: 'subject.other' },
    ]) {
      await expect(adapter.provision({ ...input, ...over })).rejects.toMatchObject({
        code: 'provisioning-conflict',
      });
    }
    const unchanged = await adapter.read(keyA);
    expect(unchanged.partyType).toBe('CLIENT');
    expect(unchanged.cancelled).toBe(false);
    expect(unchanged.revision).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Read.
// ---------------------------------------------------------------------------

describe('tenant-scoped read', () => {
  it('returns the exact row and refuses a missing one, never provisioning it', async () => {
    await expect(adapter.read(keyA)).rejects.toMatchObject({ code: 'state-not-found' });
    await seedConversation(pool, {
      tenantId: TENANT_A,
      conversationId: CONVERSATION,
      subjectRef: 'subject.opaque',
      observedAt: '2026-07-25T00:00:00Z',
    });
    const state = await adapter.read(keyA);
    expect(state.tenantId).toBe(TENANT_A);
    expect(state.conversationId).toBe(CONVERSATION);
    expect(state.revision).toBe(0);
    expect(state.subjectRef).toBe('subject.opaque');
    expect(state.observedAt).toBe('2026-07-25T00:00:00Z');
    // Not lazily created.
    await expect(adapter.read(keyB)).rejects.toMatchObject({ code: 'state-not-found' });
  });
});

// ---------------------------------------------------------------------------
// Durable control.
// ---------------------------------------------------------------------------

describe('durable control semantics', () => {
  beforeEach(async () => {
    await seedConversation(pool, { tenantId: TENANT_A, conversationId: CONVERSATION });
  });

  it('TAKE then RELEASE then RESUME, each durable and each observed immediately', async () => {
    const taken = await adapter.applyControlCommand(keyA, command());
    expect(taken.outcome).toBe('APPLIED');
    let state = await adapter.read(keyA);
    expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([1, true, true]);
    // APPLIED stamps the operator's own instant, never a clock this adapter read.
    expect(state.observedAt).toBe(AT(1));

    const released = await adapter.applyControlCommand(
      keyA,
      command({
        commandId: 'ctrl.2',
        expectedRevision: 1,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(2),
      }),
    );
    expect(released.outcome).toBe('APPLIED');
    state = await adapter.read(keyA);
    // ADR-0054 E: releasing ownership never resumes AI.
    expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([2, false, true]);

    const resumed = await adapter.applyControlCommand(
      keyA,
      command({ commandId: 'ctrl.3', expectedRevision: 2, action: 'RESUME_AI', issuedAt: AT(3) }),
    );
    expect(resumed.outcome).toBe('APPLIED');
    state = await adapter.read(keyA);
    expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([3, false, false]);
  });

  it('survives a completely new pool — the restart proof', async () => {
    await adapter.applyControlCommand(keyA, command());
    await adapter.applyControlCommand(
      keyA,
      command({
        commandId: 'ctrl.2',
        expectedRevision: 1,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(2),
      }),
    );

    // A different pool is a different set of connections: nothing in this process's memory carries
    // the state across. This is the property the in-process fake could never demonstrate.
    const freshPool = createTestPool('qf-p08b2-restart');
    try {
      const fresh = createPostgresConversationStateAdapter({ pool: freshPool });
      const state = await fresh.read(keyA);
      expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([2, false, true]);

      const resumed = await fresh.applyControlCommand(
        keyA,
        command({ commandId: 'ctrl.3', expectedRevision: 2, action: 'RESUME_AI', issuedAt: AT(3) }),
      );
      expect(resumed.outcome).toBe('APPLIED');
      expect((await fresh.read(keyA)).aiPaused).toBe(false);
    } finally {
      await closeDatabasePool(freshPool);
    }
  }, 60_000);

  it('refuses RESUME under an active takeover, and records the refusal', async () => {
    await adapter.applyControlCommand(keyA, command());
    const refused = await adapter.applyControlCommand(
      keyA,
      command({ commandId: 'ctrl.2', expectedRevision: 1, action: 'RESUME_AI', issuedAt: AT(2) }),
    );
    expect(refused.outcome).toBe('REFUSED');
    expect(refused.reason).toBe('human-takeover-active');
    const state = await adapter.read(keyA);
    expect([state.revision, state.humanTakeover]).toEqual([1, true]);
    expect(await ledgerRows(TENANT_A)).toHaveLength(2);
  });

  it('records NO_CHANGE and stale refusals without moving the revision or observedAt', async () => {
    await adapter.applyControlCommand(keyA, command());
    const before = await adapter.read(keyA);

    const noChange = await adapter.applyControlCommand(
      keyA,
      command({ commandId: 'ctrl.2', expectedRevision: 1, issuedAt: AT(5) }),
    );
    expect(noChange.outcome).toBe('NO_CHANGE');

    for (const [id, expectedRevision] of [
      ['ctrl.3', 0],
      ['ctrl.4', 9],
    ] as const) {
      const stale = await adapter.applyControlCommand(
        keyA,
        command({ commandId: id, expectedRevision, action: 'RESUME_AI', issuedAt: AT(5) }),
      );
      expect(stale.outcome).toBe('REFUSED');
      expect(stale.reason).toBe('revision-mismatch');
    }

    const after = await adapter.read(keyA);
    expect(after.revision).toBe(before.revision);
    // Only an APPLIED decision moves observedAt.
    expect(after.observedAt).toBe(before.observedAt);
    // Four decisions, four durable records: a refusal that left no trace would be invisible to review.
    expect(await ledgerRows(TENANT_A)).toHaveLength(4);
  });

  it('never changes a Core-derived field, whatever the command', async () => {
    await withClient(pool, async (client) => {
      await client.query(
        `UPDATE qf_jarvis.conversation_runtime_state SET subject_ref = 'subject.opaque', revision = 1
          WHERE tenant_id = $1 AND conversation_id = $2`,
        [TENANT_A, CONVERSATION],
      );
    });
    const before = await adapter.read(keyA);

    await adapter.applyControlCommand(keyA, command({ expectedRevision: 1 }));
    await adapter.applyControlCommand(
      keyA,
      command({
        commandId: 'ctrl.2',
        expectedRevision: 2,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(2),
      }),
    );
    const after = await adapter.read(keyA);

    expect(after.partyType).toBe(before.partyType);
    expect(after.dataClass).toBe(before.dataClass);
    expect(after.cancelled).toBe(before.cancelled);
    expect(after.subjectStatus).toBe(before.subjectStatus);
    expect(after.subjectRef).toBe(before.subjectRef);
    expect(after.tenantId).toBe(TENANT_A);
  });

  it('refuses a command against a conversation that does not exist, writing no audit', async () => {
    await expect(adapter.applyControlCommand(keyB, command())).rejects.toMatchObject({
      code: 'state-not-found',
    });
    expect(await ledgerRows(TENANT_B)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Audit.
// ---------------------------------------------------------------------------

describe('the append-only audit', () => {
  beforeEach(async () => {
    await seedConversation(pool, { tenantId: TENANT_A, conversationId: CONVERSATION });
  });

  it('stores exactly the returned decision, content-free, with a database-stamped recorded_at', async () => {
    const decision = await adapter.applyControlCommand(
      keyA,
      command({ reasonRef: 'reason.escalation' }),
    );
    const rows = await ledgerRows(TENANT_A);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row['tenant_id']).toBe(TENANT_A);
    expect(row['command_id']).toBe('ctrl.1');
    expect(row['conversation_id']).toBe(CONVERSATION);
    expect(row['action']).toBe('TAKE_OWNERSHIP');
    expect(row['operator_ref']).toBe('operator.synthetic.1');
    expect(row['reason_ref']).toBe('reason.escalation');
    expect(row['outcome']).toBe(decision.outcome);
    expect(row['reason']).toBe(decision.reason);
    expect(String(row['resulting_revision'])).toBe(String(decision.nextState.revision));
    expect(row['resulting_human_takeover']).toBe(decision.nextState.humanTakeover);
    expect(row['resulting_ai_paused']).toBe(decision.nextState.aiPaused);
    expect(row['recorded_at']).toBeInstanceOf(Date);

    // The subject reference lives on the state row only: an operator audit must stay retainable after
    // subject erasure, which it can be precisely because it references no subject.
    expect(Object.keys(row)).not.toContain('subject_ref');
    const serialized = JSON.stringify(row).toLowerCase();
    for (const forbidden of ['message', 'body', 'prompt', 'reply', 'subject', 'email', 'phone']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('commits state and audit together — a failure after the update leaves neither', async () => {
    // A pool whose ledger INSERT always fails. If state and audit were not one transaction, the
    // takeover would land with no record of who did it.
    const failingPool = createTestPool('qf-p08b2-atomic');
    try {
      const original = failingPool.query.bind(failingPool);
      const brokenAdapter = createPostgresConversationStateAdapter({
        pool: {
          connect: async () => {
            const client = await failingPool.connect();
            const clientQuery = client.query.bind(client);
            client.query = ((text: unknown, values?: unknown) => {
              if (
                typeof text === 'string' &&
                text.includes('INSERT INTO qf_jarvis.conversation_control_command')
              ) {
                return Promise.reject(
                  Object.assign(new Error('injected ledger failure'), { code: '08006' }),
                );
              }
              return clientQuery(text as never, values as never);
            }) as typeof client.query;
            return client;
          },
          query: original,
        } as unknown as DatabasePool,
      });

      await expect(brokenAdapter.applyControlCommand(keyA, command())).rejects.toBeDefined();

      const state = await adapter.read(keyA);
      expect([state.revision, state.humanTakeover]).toEqual([0, false]);
      expect(await ledgerRows(TENANT_A)).toHaveLength(0);
    } finally {
      await closeDatabasePool(failingPool);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Durable idempotency.
// ---------------------------------------------------------------------------

describe('durable command idempotency', () => {
  beforeEach(async () => {
    await seedConversation(pool, { tenantId: TENANT_A, conversationId: CONVERSATION });
    await seedConversation(pool, { tenantId: TENANT_B, conversationId: CONVERSATION });
  });

  it('replays the ORIGINAL decision for an exact duplicate, even after the revision advanced', async () => {
    const first = await adapter.applyControlCommand(keyA, command());
    expect(first.outcome).toBe('APPLIED');

    // Move the conversation on, so a re-evaluation would now answer `revision-mismatch`.
    await adapter.applyControlCommand(
      keyA,
      command({
        commandId: 'ctrl.2',
        expectedRevision: 1,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(2),
      }),
    );
    expect((await adapter.read(keyA)).revision).toBe(2);

    // This is the crash-recovery case: the caller never saw the response and reissues.
    const replay = await adapter.applyControlCommand(keyA, command());
    expect(replay).toEqual(first);
    expect(replay.outcome).toBe('APPLIED');

    const state = await adapter.read(keyA);
    expect(state.revision).toBe(2);
    // Two commands, two rows. The replay appended nothing.
    expect(await ledgerRows(TENANT_A)).toHaveLength(2);
  });

  it('refuses a conflicting duplicate with zero effect', async () => {
    await adapter.applyControlCommand(keyA, command());
    const before = await adapter.read(keyA);

    for (const over of [
      { expectedRevision: 1 },
      { action: 'PAUSE_AI' as const },
      { operatorRef: 'operator.other' },
      { reasonRef: 'reason.x' },
      { issuedAt: AT(9) },
    ]) {
      await expect(adapter.applyControlCommand(keyA, command(over))).rejects.toMatchObject({
        code: 'command-conflict',
      });
    }

    const after = await adapter.read(keyA);
    expect(after.revision).toBe(before.revision);
    expect(await ledgerRows(TENANT_A)).toHaveLength(1);
  });

  it('scopes command ids per tenant', async () => {
    // The same command id under two tenants is two commands; a global unique would wrongly collide.
    const a = await adapter.applyControlCommand(keyA, command());
    const b = await adapter.applyControlCommand(keyB, command());
    expect(a.outcome).toBe('APPLIED');
    expect(b.outcome).toBe('APPLIED');
    expect((await adapter.read(keyA)).humanTakeover).toBe(true);
    expect((await adapter.read(keyB)).humanTakeover).toBe(true);
    expect(await ledgerRows(TENANT_A)).toHaveLength(1);
    expect(await ledgerRows(TENANT_B)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrency, with genuinely separate sessions.
// ---------------------------------------------------------------------------

describe('concurrency across separate sessions', () => {
  beforeEach(async () => {
    await seedConversation(pool, { tenantId: TENANT_A, conversationId: CONVERSATION });
    await seedConversation(pool, { tenantId: TENANT_B, conversationId: CONVERSATION });
  });

  it('lets exactly one of two different commands at the same revision apply', async () => {
    const poolTwo = createTestPool('qf-p08b2-concurrent');
    try {
      const other = createPostgresConversationStateAdapter({ pool: poolTwo });
      const [a, b] = await Promise.all([
        adapter.applyControlCommand(keyA, command()),
        other.applyControlCommand(
          keyA,
          command({ commandId: 'ctrl.2', action: 'PAUSE_AI', issuedAt: AT(2) }),
        ),
      ]);
      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(['APPLIED', 'REFUSED']);
      const refused = a.outcome === 'REFUSED' ? a : b;
      expect(refused.reason).toBe('revision-mismatch');

      // Exactly one increment. Both decisions are recorded.
      expect((await adapter.read(keyA)).revision).toBe(1);
      expect(await ledgerRows(TENANT_A)).toHaveLength(2);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);

  it('gives both callers the same decision for a concurrent exact duplicate', async () => {
    const poolTwo = createTestPool('qf-p08b2-dup');
    try {
      const other = createPostgresConversationStateAdapter({ pool: poolTwo });
      const [a, b] = await Promise.all([
        adapter.applyControlCommand(keyA, command()),
        other.applyControlCommand(keyA, command()),
      ]);
      // One effect, one record, and both callers learn what actually happened.
      expect(a).toEqual(b);
      expect(a.outcome).toBe('APPLIED');
      expect((await adapter.read(keyA)).revision).toBe(1);
      expect(await ledgerRows(TENANT_A)).toHaveLength(1);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);

  it('rolls the loser back entirely on a concurrent conflicting duplicate', async () => {
    const poolTwo = createTestPool('qf-p08b2-conflict');
    try {
      const other = createPostgresConversationStateAdapter({ pool: poolTwo });
      const results = await Promise.allSettled([
        adapter.applyControlCommand(keyA, command()),
        other.applyControlCommand(keyA, command({ action: 'PAUSE_AI', issuedAt: AT(2) })),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const loser = rejected[0];
      expect(loser).toBeDefined();
      expect(loser?.reason).toMatchObject({ code: 'command-conflict' });

      // The loser's candidate state update rolled back with its transaction: exactly one increment.
      expect((await adapter.read(keyA)).revision).toBe(1);
      expect(await ledgerRows(TENANT_A)).toHaveLength(1);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);

  it('does not let one conversation block another', async () => {
    const poolTwo = createTestPool('qf-p08b2-parallel');
    try {
      const other = createPostgresConversationStateAdapter({ pool: poolTwo });
      const [a, b] = await Promise.all([
        adapter.applyControlCommand(keyA, command()),
        other.applyControlCommand(keyB, command({ commandId: 'ctrl.b' })),
      ]);
      expect(a.outcome).toBe('APPLIED');
      expect(b.outcome).toBe('APPLIED');
      expect((await adapter.read(keyA)).revision).toBe(1);
      expect((await adapter.read(keyB)).revision).toBe(1);
    } finally {
      await closeDatabasePool(poolTwo);
    }
  }, 60_000);

  it('leaves the revision usable after a NO_CHANGE', async () => {
    await adapter.applyControlCommand(keyA, command());
    const noChange = await adapter.applyControlCommand(
      keyA,
      command({ commandId: 'ctrl.2', expectedRevision: 1, issuedAt: AT(2) }),
    );
    expect(noChange.outcome).toBe('NO_CHANGE');
    // A NO_CHANGE does not bump, so a following command at the SAME revision is legitimate.
    const released = await adapter.applyControlCommand(
      keyA,
      command({
        commandId: 'ctrl.3',
        expectedRevision: 1,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(3),
      }),
    );
    expect(released.outcome).toBe('APPLIED');
    expect((await adapter.read(keyA)).revision).toBe(2);
  });
});

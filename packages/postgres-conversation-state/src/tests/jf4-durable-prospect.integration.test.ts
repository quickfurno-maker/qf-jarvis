/**
 * JF-4B/C/D owner correction — PROSPECT is DURABLE (ADR-0150 §2a, migration 0014).
 *
 * ### What was wrong, and what these specs prove
 *
 * ADR-0150 added `PROSPECT` to the runtime vocabulary so Aarohi's acquisition turns could be routed
 * and decided. Migration `0008` had written the party CHECK with the three types that existed then, so
 * an acquisition conversation could be represented in memory, routed to Aarohi, and then refused by the
 * database the moment the authoritative store tried to persist it. A runtime party type the
 * authoritative store cannot hold is not a party type; it is a crash waiting for its first real
 * conversation.
 *
 * Migration `0014` widens exactly that one constraint. These specs prove the widening is real, that
 * nothing about the other three party types changed, that an unknown token is still refused at BOTH
 * layers, and — with a database actually taken to `0013` — that applying `0014` over existing rows
 * succeeds and turns a refusal into an acceptance.
 *
 * ### PostgreSQL required. These fail rather than skip.
 *
 * They run through the same guarded harness every other durable spec uses: loopback host, test-shaped
 * database name, migrations applied from `0001`. Nothing here touches a managed database — the managed
 * project still carries `0001` only, and JF-6 owns that parity.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createConversationControlCommand } from '@qf-jarvis/conversation-control';
import { migrateWithPreflight } from '@qf-jarvis/event-backbone';

import { createPostgresConversationStateAdapter } from '../index.js';
import type { PostgresConversationStateAdapter } from '../index.js';
import {
  closeDatabasePool,
  createTestPool,
  resetAndMigrate,
  seedConversation,
  testDatabaseConfig,
  withClient,
  type DatabasePool,
} from './database-harness.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(
  new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
);

const APPLICATION = 'qf-jf4-prospect';
const TENANT = 'tenant.jf4';
const AT = (n: number): string => `2026-09-0${String(n)}T00:00:00.000Z`;

/** The one constraint migration 0014 touches. Named, so a rename cannot pass silently. */
const PARTY_CHECK = 'conversation_runtime_state_party_type_known';

/** PostgreSQL class-23514 check_violation. Asserted by code, never by message text. */
const CHECK_VIOLATION = '23514';

let pool: DatabasePool;
let adapter: PostgresConversationStateAdapter;

/** One conversation per party type, so no spec depends on another's row. */
const conversationFor = (partyType: string): string => `conv.jf4.${partyType.toLowerCase()}`;

const provisioningInput = (partyType: string) => ({
  tenantId: TENANT,
  conversationId: conversationFor(partyType),
  partyType,
  dataClass: 'HOSTED_ALLOWED',
  cancelled: false,
  subjectStatus: 'clear',
  observedAt: AT(1),
});

const keyFor = (partyType: string) => ({
  tenantId: TENANT,
  conversationId: conversationFor(partyType),
});

/** Insert a row with `party_type` set DIRECTLY, bypassing every application-layer check. */
async function rawInsert(target: DatabasePool, partyType: string): Promise<void> {
  await withClient(target, async (client) => {
    await client.query(
      `INSERT INTO qf_jarvis.conversation_runtime_state
         (tenant_id, conversation_id, revision, party_type, data_class,
          cancelled, subject_status, subject_ref, human_takeover, ai_paused, observed_at)
       VALUES ($1, $2, 0, $3, 'HOSTED_ALLOWED', false, 'clear', null, false, false, $4)`,
      [TENANT, `raw.${partyType.toLowerCase()}`, partyType, AT(1)],
    );
  });
}

beforeAll(async () => {
  pool = createTestPool(APPLICATION);
  await resetAndMigrate(pool, testDatabaseConfig(APPLICATION));
  adapter = createPostgresConversationStateAdapter({ pool });
}, 120_000);

afterAll(async () => {
  await closeDatabasePool(pool);
});

beforeEach(async () => {
  await withClient(pool, async (client) => {
    // The ledger references the state, so it goes first. Test teardown, not a runtime capability.
    await client.query('TRUNCATE qf_jarvis.conversation_control_command');
    await client.query('TRUNCATE qf_jarvis.conversation_runtime_state CASCADE');
  });
});

// ---------------------------------------------------------------------------
// The migration itself.
// ---------------------------------------------------------------------------

describe('migration 0014 is applied and is narrow', () => {
  it('is recorded in the append-only migration history under its own checksum', async () => {
    const filename = '0014_conversation_prospect_party_type.sql';
    const expected = createHash('sha256')
      .update(readFileSync(join(MIGRATIONS_DIR, filename)))
      .digest('hex');
    const recorded = await withClient(pool, async (client) => {
      const result = await client.query<{ checksum: Buffer }>(
        'SELECT checksum FROM qf_jarvis.schema_migration WHERE filename = $1',
        [filename],
      );
      return result.rows[0]?.checksum;
    });
    expect(recorded).toBeDefined();
    // The runner checksums the exact file bytes; a re-encode would be a different migration.
    expect(recorded?.toString('hex')).toBe(expected);
  });

  it('left exactly ONE party CHECK in place, naming all four types', async () => {
    // One constraint, not two. A widened CHECK added BESIDE the old one would look like a widening
    // in the DDL and would still refuse PROSPECT at runtime.
    const definitions = await withClient(pool, async (client) => {
      const result = await client.query<{ conname: string; def: string }>(
        `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
           FROM pg_catalog.pg_constraint c
           JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'qf_jarvis'
            AND t.relname = 'conversation_runtime_state'
            AND c.contype = 'c'
            AND pg_get_constraintdef(c.oid) LIKE '%party_type%'`,
      );
      return result.rows;
    });
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.conname).toBe(PARTY_CHECK);
    for (const party of ['CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN']) {
      expect(definitions[0]?.def, party).toContain(party);
    }
  });
});

// ---------------------------------------------------------------------------
// (1,2,3) The three pre-existing party types are unchanged.
// ---------------------------------------------------------------------------

describe('CLIENT, VENDOR and UNKNOWN behave exactly as before', () => {
  it('(1,2,3) each provisions, reads and takes a control command unchanged', async () => {
    for (const party of ['CLIENT', 'VENDOR', 'UNKNOWN']) {
      const created = await adapter.provision(provisioningInput(party));
      expect(created.outcome, party).toBe('CREATED');
      expect(created.state.revision, party).toBe(0);
      expect(created.state.partyType, party).toBe(party);

      const read = await adapter.read(keyFor(party));
      expect(read.partyType, party).toBe(party);
      expect([read.revision, read.humanTakeover, read.aiPaused], party).toEqual([0, false, false]);

      const applied = await adapter.applyControlCommand(
        keyFor(party),
        createConversationControlCommand({
          commandId: `ctrl.${party.toLowerCase()}.1`,
          conversationId: conversationFor(party),
          expectedRevision: 0,
          action: 'TAKE_OWNERSHIP',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(2),
        }),
      );
      expect(applied.outcome, party).toBe('APPLIED');
      const after = await adapter.read(keyFor(party));
      expect([after.revision, after.humanTakeover, after.aiPaused], party).toEqual([1, true, true]);
      // The widened CHECK did not touch the party type of an existing row.
      expect(after.partyType, party).toBe(party);
    }
  });
});

// ---------------------------------------------------------------------------
// (4,5,6,7) PROSPECT, durably.
// ---------------------------------------------------------------------------

describe('a PROSPECT conversation is durable', () => {
  it('(4,5) provisions and reads back as PROSPECT', async () => {
    const created = await adapter.provision(provisioningInput('PROSPECT'));
    expect(created.outcome).toBe('CREATED');
    expect(created.state.partyType).toBe('PROSPECT');
    expect(created.state.revision).toBe(0);
    expect(created.state.humanTakeover).toBe(false);
    expect(created.state.aiPaused).toBe(false);
    expect(created.state.subjectRef).toBeUndefined();

    const read = await adapter.read(keyFor('PROSPECT'));
    expect(read.partyType).toBe('PROSPECT');
    expect(read.tenantId).toBe(TENANT);
    expect(read.dataClass).toBe('HOSTED_ALLOWED');
  });

  it('(6) accepts TAKE, RELEASE and RESUME under the same compare-and-set semantics', async () => {
    await adapter.provision(provisioningInput('PROSPECT'));
    const key = keyFor('PROSPECT');
    const command = (over: Record<string, unknown>) =>
      createConversationControlCommand({
        commandId: 'ctrl.p.1',
        conversationId: conversationFor('PROSPECT'),
        expectedRevision: 0,
        action: 'TAKE_OWNERSHIP',
        operatorRef: 'operator.synthetic.1',
        issuedAt: AT(2),
        ...over,
      });

    expect((await adapter.applyControlCommand(key, command({}))).outcome).toBe('APPLIED');
    let state = await adapter.read(key);
    expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([1, true, true]);

    const released = await adapter.applyControlCommand(
      key,
      command({
        commandId: 'ctrl.p.2',
        expectedRevision: 1,
        action: 'RELEASE_OWNERSHIP',
        issuedAt: AT(3),
      }),
    );
    expect(released.outcome).toBe('APPLIED');
    state = await adapter.read(key);
    // ADR-0054 E holds for PROSPECT too: releasing ownership never resumes AI.
    expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([2, false, true]);

    const resumed = await adapter.applyControlCommand(
      key,
      command({ commandId: 'ctrl.p.3', expectedRevision: 2, action: 'RESUME_AI', issuedAt: AT(4) }),
    );
    expect(resumed.outcome).toBe('APPLIED');
    state = await adapter.read(key);
    expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([3, false, false]);
    expect(state.partyType).toBe('PROSPECT');

    // A stale expected revision is still refused, and a refusal still changes nothing.
    const stale = await adapter.applyControlCommand(
      key,
      command({ commandId: 'ctrl.p.4', expectedRevision: 1, issuedAt: AT(5) }),
    );
    expect(stale.outcome).toBe('REFUSED');
    expect((await adapter.read(key)).revision).toBe(3);
  });

  it('(6) is idempotent on the Core-derived facts, and a differing party type is refused', async () => {
    await adapter.provision(provisioningInput('PROSPECT'));
    const again = await adapter.provision(provisioningInput('PROSPECT'));
    expect(again.outcome).toBe('ALREADY_PROVISIONED');
    expect(again.state.revision).toBe(0);
    expect(again.state.partyType).toBe('PROSPECT');

    // PROSPECT is a durable FACT about the conversation, not a routing hint that may drift.
    await expect(
      adapter.provision({ ...provisioningInput('PROSPECT'), partyType: 'CLIENT' }),
    ).rejects.toMatchObject({ code: 'provisioning-conflict' });
    expect((await adapter.read(keyFor('PROSPECT'))).partyType).toBe('PROSPECT');
  });

  it('(7) survives a completely new pool and adapter — the restart proof', async () => {
    await adapter.provision(provisioningInput('PROSPECT'));
    const key = keyFor('PROSPECT');
    await adapter.applyControlCommand(
      key,
      createConversationControlCommand({
        commandId: 'ctrl.p.restart.1',
        conversationId: conversationFor('PROSPECT'),
        expectedRevision: 0,
        action: 'TAKE_OWNERSHIP',
        operatorRef: 'operator.synthetic.1',
        issuedAt: AT(2),
      }),
    );

    // A different pool is a different set of connections: nothing in this process's memory carries
    // the party type or the takeover across.
    const freshPool = createTestPool('qf-jf4-prospect-restart');
    try {
      const fresh = createPostgresConversationStateAdapter({ pool: freshPool });
      const state = await fresh.read(key);
      expect(state.partyType).toBe('PROSPECT');
      expect([state.revision, state.humanTakeover, state.aiPaused]).toEqual([1, true, true]);

      const released = await fresh.applyControlCommand(
        key,
        createConversationControlCommand({
          commandId: 'ctrl.p.restart.2',
          conversationId: conversationFor('PROSPECT'),
          expectedRevision: 1,
          action: 'RELEASE_OWNERSHIP',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(3),
        }),
      );
      expect(released.outcome).toBe('APPLIED');
      expect((await fresh.read(key)).partyType).toBe('PROSPECT');
    } finally {
      await closeDatabasePool(freshPool);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// (8) An arbitrary token is refused at BOTH layers.
// ---------------------------------------------------------------------------

describe('an arbitrary party token is refused at both layers', () => {
  it('(8a) the application layer refuses it before any SQL runs', async () => {
    for (const token of ['ACQUISITION', 'prospect', 'PROSPECT ', 'LEAD', '']) {
      await expect(adapter.provision(provisioningInput(token)), token).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }
    // Nothing reached the database, so nothing was written under a bad token.
    const count = await withClient(pool, async (client) => {
      const result = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM qf_jarvis.conversation_runtime_state',
      );
      return result.rows[0]?.n;
    });
    expect(count).toBe(0);
  });

  it('(8b) the DB CHECK refuses it too, so 0014 is a widening and not a removal', async () => {
    // The point of the pair. If 0014 had dropped the constraint rather than replacing it, the
    // application-layer spec above would still pass and the store would accept any string forever.
    await expect(rawInsert(pool, 'ACQUISITION')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: PARTY_CHECK,
    });
    await expect(rawInsert(pool, 'prospect')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: PARTY_CHECK,
    });
    // And the four legitimate tokens pass the same CHECK.
    for (const party of ['CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN']) {
      await expect(rawInsert(pool, party), party).resolves.toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// (9) A database at 0013, migrated to 0014, with rows already in it.
// ---------------------------------------------------------------------------

describe('applying 0014 to a database already at 0013', () => {
  afterAll(async () => {
    // Leave the database fully migrated for whatever runs after this file.
    await resetAndMigrate(pool, testDatabaseConfig(APPLICATION));
  }, 120_000);

  it('(9) succeeds with existing rows intact, and turns the refusal into an acceptance', async () => {
    const config = testDatabaseConfig(APPLICATION);

    // A real database at 0013: the schema is rebuilt and the runner is asked to stop there.
    await withClient(pool, async (client) => {
      await client.query('DROP SCHEMA IF EXISTS qf_jarvis CASCADE');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    });
    await migrateWithPreflight(pool, config, MIGRATIONS_DIR, { throughVersion: 13 });

    const applied = async (): Promise<readonly string[]> =>
      withClient(pool, async (client) => {
        const result = await client.query<{ filename: string }>(
          'SELECT filename FROM qf_jarvis.schema_migration ORDER BY filename',
        );
        return result.rows.map((row) => row.filename);
      });
    const at13 = await applied();
    expect(at13).toHaveLength(13);
    expect(at13.some((file) => file.startsWith('0014'))).toBe(false);

    // Rows under the three types 0008 allowed, written before the widening.
    for (const party of ['CLIENT', 'VENDOR', 'UNKNOWN']) {
      await seedConversation(pool, {
        tenantId: TENANT,
        conversationId: conversationFor(party),
        partyType: party,
        observedAt: AT(1),
      });
    }
    // The blocker this correction closes, measured rather than asserted: at 0013 the database
    // refuses PROSPECT outright, which is why the runtime vocabulary alone was not enough.
    await expect(rawInsert(pool, 'PROSPECT')).rejects.toMatchObject({
      code: CHECK_VIOLATION,
      constraint: PARTY_CHECK,
    });

    // Forward exactly one migration, over the rows that are already there. Keep this historical
    // 0014 proof bounded so later migrations cannot silently broaden what this test is asserting.
    const result = await migrateWithPreflight(pool, config, MIGRATIONS_DIR, { throughVersion: 14 });
    expect(result.migration.applied.map((migration) => migration.filename)).toEqual([
      '0014_conversation_prospect_party_type.sql',
    ]);
    expect(await applied()).toHaveLength(14);

    // Every pre-existing row survived, at its original revision, party type and instant.
    const upgraded = createPostgresConversationStateAdapter({ pool });
    for (const party of ['CLIENT', 'VENDOR', 'UNKNOWN']) {
      const state = await upgraded.read(keyFor(party));
      expect(state.partyType, party).toBe(party);
      expect([state.revision, state.humanTakeover, state.aiPaused], party).toEqual([
        0,
        false,
        false,
      ]);
      expect(state.observedAt, party).toBe(AT(1));
    }

    // And what the constraint refused a moment ago is now accepted, through the adapter.
    const created = await upgraded.provision(provisioningInput('PROSPECT'));
    expect(created.outcome).toBe('CREATED');
    expect((await upgraded.read(keyFor('PROSPECT'))).partyType).toBe('PROSPECT');
  }, 180_000);
});

/**
 * Real PostgreSQL proofs (RWC-P2B, ADR-0095).
 *
 * These are the tests the phase exists for. Durability across a restart, a single winner under
 * genuine concurrency, tenant isolation, and the exact refusal a corrupt row produces are all claims
 * that an in-memory fake would satisfy without being true. Every one of them runs against a real
 * local PostgreSQL, and the suite FAILS rather than skips when there is none.
 *
 * The concurrency tests use DISTINCT backend connections from a real pool, so a "race" here is an
 * actual race between sessions rather than a sequence on one serialized connection.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { RIYA_CONVERSATION_PHASES } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PostgresRiyaContinuityStoreError,
  createPostgresRiyaConversationContinuityStore,
} from '../index.js';
import type { PostgresRiyaContinuityStore } from '../index.js';
import {
  closeDatabasePool,
  createTestPool,
  ensureLoginRole,
  resetAndMigrate,
  testDatabaseConfig,
  testDatabaseConfigAs,
  withClient,
  type DatabasePool,
} from './harness.js';
import {
  fullyDiscoveredState,
  initialState,
  stateForPhase,
  summaryReadyState,
} from './fixtures.js';

const APP = 'rwc-p2b-integration';
const RUNTIME_ROLE = 'qf_jarvis_runtime';
const LOCAL_ONLY_PASSWORD = 'local-rwc-p2b-only';
const TABLE = 'qf_jarvis.riya_conversation_continuity';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(
  new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
);

let pool: DatabasePool;

beforeAll(async () => {
  pool = createTestPool(APP);
  // The role must exist BEFORE the migrations run: 0011's grants are conditional on it, exactly as
  // 0002, 0007, 0008 and 0010 are, so a role created afterwards would receive nothing.
  await ensureLoginRole(pool, RUNTIME_ROLE, LOCAL_ONLY_PASSWORD);
  await resetAndMigrate(pool, testDatabaseConfig(APP));
});

afterAll(async () => {
  await closeDatabasePool(pool);
});

beforeEach(async () => {
  await withClient(pool, async (client) => {
    await client.query(`DELETE FROM ${TABLE}`);
  });
});

function store(): PostgresRiyaContinuityStore {
  return createPostgresRiyaConversationContinuityStore({ pool });
}

async function rowCount(): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${TABLE}`);
    return Number(result.rows[0]?.n ?? '0');
  });
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof PostgresRiyaContinuityStoreError
      ? error.code
      : `unexpected:${String(error)}`;
  }
  return 'no-error';
}

/**
 * Bring a conversation LEGALLY to `target` — born at 0, then one exact +1 compare-and-set per step.
 *
 * Tests that need a row at a nonzero revision must reach it the way production does. Seeding one by
 * direct INSERT would be the test asserting against a state the schema forbids, which is how a
 * durable rule ends up proven only against rows that could never exist.
 */
async function seedAtRevision(
  built: PostgresRiyaContinuityStore,
  make: (revision: number) => RiyaConversationContinuityStateV1,
  target: number,
): Promise<RiyaConversationContinuityStateV1> {
  const created = await built.createInitialIfAbsent({ state: make(0) });
  expect(created.disposition).toBe('CREATED');
  for (let revision = 0; revision < target; revision += 1) {
    const next = make(revision + 1);
    await expect(
      built.compareAndSet({ expectedRevision: revision, nextState: next }),
    ).resolves.toBe('UPDATED');
  }
  return make(target);
}

// ---------------------------------------------------------------------------
// 1. The migration itself
// ---------------------------------------------------------------------------

describe('(1) migration 0011', () => {
  it('creates the table with the exact composite key and NO conversation-only uniqueness', async () => {
    await withClient(pool, async (client) => {
      const table = await client.query<{ relrowsecurity: boolean; kind: string }>(
        `SELECT c.relrowsecurity, c.relkind::text AS kind
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'qf_jarvis' AND c.relname = 'riya_conversation_continuity'`,
      );
      expect(table.rowCount).toBe(1);
      expect(table.rows[0]?.kind).toBe('r');

      const indexes = await client.query<{ indexdef: string; indexname: string }>(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'qf_jarvis' AND tablename = 'riya_conversation_continuity'`,
      );
      const pk = indexes.rows.find((r) => r.indexname === 'riya_conversation_continuity_pk');
      expect(pk?.indexdef).toContain('UNIQUE');
      expect(pk?.indexdef).toContain('tenant_id');
      expect(pk?.indexdef).toContain('conversation_id');

      // The whole point of ADR-0076 section 3. A unique index on the conversation alone would merge
      // two tenants' conversations, and it must not exist under ANY name.
      for (const index of indexes.rows) {
        const isConversationOnly =
          index.indexdef.includes('(conversation_id)') && !index.indexdef.includes('tenant_id');
        expect(isConversationOnly, index.indexname).toBe(false);
      }
    });
  });

  it('declares the expected CHECK constraints, all validated', async () => {
    await withClient(pool, async (client) => {
      const checks = await client.query<{ conname: string; convalidated: boolean }>(
        `SELECT con.conname, con.convalidated
           FROM pg_constraint con
           JOIN pg_class c ON c.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'qf_jarvis'
            AND c.relname = 'riya_conversation_continuity'
            AND con.contype = 'c'
          ORDER BY con.conname`,
      );
      expect(checks.rows.map((r) => r.conname)).toStrictEqual([
        'riya_conversation_continuity_complete_iff_evidence',
        'riya_conversation_continuity_completion_ref_is_identifier',
        'riya_conversation_continuity_conversation_is_identifier',
        'riya_conversation_continuity_discovery_is_object',
        'riya_conversation_continuity_phase_known',
        'riya_conversation_continuity_provenance_is_object',
        'riya_conversation_continuity_revision_in_safe_range',
        'riya_conversation_continuity_summary_after',
        'riya_conversation_continuity_summary_before',
        'riya_conversation_continuity_tenant_is_identifier',
        'riya_conversation_continuity_version_is_one',
      ]);
      for (const row of checks.rows) {
        expect(row.convalidated, row.conname).toBe(true);
      }
    });
  });

  it("the phase CHECK holds exactly RWC-P2A's nine phases", async () => {
    await withClient(pool, async (client) => {
      const def = await client.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'riya_conversation_continuity_phase_known'`,
      );
      const text = def.rows[0]?.def ?? '';
      for (const phase of RIYA_CONVERSATION_PHASES) {
        expect(text, phase).toContain(`'${phase}'`);
      }
      // Nine and only nine: count the quoted literals so a tenth cannot be added unnoticed.
      expect(text.match(/'[A-Z_]+'::text/g)?.length).toBe(RIYA_CONVERSATION_PHASES.length);
    });
  });

  it('stores no transcript, contact, business-authority or channel column', async () => {
    await withClient(pool, async (client) => {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'qf_jarvis' AND table_name = 'riya_conversation_continuity'
          ORDER BY column_name`,
      );
      const names = columns.rows.map((r) => r.column_name);
      expect(names).toStrictEqual([
        'completion_evidence_ref',
        'continuity_revision',
        'conversation_id',
        'discovery',
        'field_provenance',
        'phase',
        'summary_confirmed',
        'tenant_id',
        'version',
      ]);
      for (const forbidden of [
        'channel',
        'user_id',
        'phone',
        'email',
        'name',
        'token',
        'cookie',
        'session',
        'transcript',
        'history',
        'recent_messages',
        'summary_text',
        'rolling_summary',
        'memory',
        'consent',
        'opt_out',
        'suppression',
        'can_submit',
        'lead_id',
        'vendor_id',
        'city',
        'price',
        'package',
        'provider',
        'source_event_ids',
        'rebuildable',
        'authoritative',
      ]) {
        expect(
          names.some((n) => n.includes(forbidden)),
          forbidden,
        ).toBe(false);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 2. load
// ---------------------------------------------------------------------------

describe('(2) load', () => {
  it('returns undefined for a conversation that has no state', async () => {
    await expect(
      store().load({ tenantId: 'tenant.a', conversationId: 'conv.absent' }),
    ).resolves.toBeUndefined();
  });

  it('returns the canonical frozen state for a stored conversation', async () => {
    const built = store();
    const state = summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 0 });
    await built.createInitialIfAbsent({ state });

    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.1' });
    expect(loaded).toStrictEqual(state);
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded?.discovery)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3-7. createInitialIfAbsent
// ---------------------------------------------------------------------------

describe('(3-7) createInitialIfAbsent', () => {
  it('(3) creates and reports CREATED with the canonical stored state', async () => {
    const state = initialState('tenant.a', 'conv.1');
    const result = await store().createInitialIfAbsent({ state });
    expect(result.disposition).toBe('CREATED');
    expect(result.state).toStrictEqual(state);
    expect(await rowCount()).toBe(1);
  });

  it('(4) a second create reports EXISTING and returns the WINNER, not the candidate', async () => {
    const built = store();
    // Both candidates are born at revision 0 (RWC-P2B-R1); they differ in CONTENT, which is what
    // identifies whose state came back. A nonzero loser candidate would now be refused as invalid
    // input and would prove nothing about who won.
    const winner = initialState('tenant.a', 'conv.1', 0, 'city.pune');
    await built.createInitialIfAbsent({ state: winner });

    const loser = initialState('tenant.a', 'conv.1', 0, 'city.mumbai');
    const result = await built.createInitialIfAbsent({ state: loser });

    expect(result.disposition).toBe('EXISTING');
    expect(result.state).toStrictEqual(winner);
    expect(result.state.discovery.locationRef).toBe('city.pune');
    expect(result.state).not.toStrictEqual(loser);
    expect(await rowCount()).toBe(1);
  });

  it('(4a) an EQUIVALENT candidate still returns the stored winner, not its own object', async () => {
    const built = store();
    const first = initialState('tenant.a', 'conv.1');
    await built.createInitialIfAbsent({ state: first });

    const equivalent = initialState('tenant.a', 'conv.1');
    const result = await built.createInitialIfAbsent({ state: equivalent });
    expect(result.disposition).toBe('EXISTING');
    expect(result.state).toStrictEqual(first);
    // Rebuilt from the row: never the identity of either candidate object.
    expect(result.state).not.toBe(equivalent);
    expect(result.state).not.toBe(first);
  });

  it('(5,6) twenty simultaneous first turns yield exactly one CREATED and one row', async () => {
    const built = store();
    const candidates = Array.from({ length: 20 }, (_, index) =>
      // Distinct candidates, so a returned state identifies WHICH call won. All at revision 0 --
      // an initial row is born there -- so the differentiator is CONTENT, not the counter.
      initialState('tenant.race', 'conv.race', 0, `city.c${String(index)}`),
    );

    const results = await Promise.all(
      candidates.map((state) => built.createInitialIfAbsent({ state })),
    );

    const created = results.filter((r) => r.disposition === 'CREATED');
    const existing = results.filter((r) => r.disposition === 'EXISTING');
    expect(created).toHaveLength(1);
    expect(existing).toHaveLength(19);
    expect(await rowCount()).toBe(1);

    // (6) EVERY caller — winner and losers alike — holds the same authoritative state.
    const winner = created[0]?.state;
    expect(winner).toBeDefined();
    for (const result of results) {
      expect(result.state).toStrictEqual(winner);
    }

    // And it is the state that is actually durable.
    const loaded = await built.load({ tenantId: 'tenant.race', conversationId: 'conv.race' });
    expect(loaded).toStrictEqual(winner);
  });

  it('(7) the same conversation id under two tenants stays two independent rows', async () => {
    const built = store();
    const a = initialState('tenant.a', 'conv.shared', 0);
    const b = summaryReadyState('tenant.b', 'conv.shared', { continuityRevision: 0 });

    expect((await built.createInitialIfAbsent({ state: a })).disposition).toBe('CREATED');
    expect((await built.createInitialIfAbsent({ state: b })).disposition).toBe('CREATED');
    expect(await rowCount()).toBe(2);

    expect(await built.load({ tenantId: 'tenant.a', conversationId: 'conv.shared' })).toStrictEqual(
      a,
    );
    expect(await built.load({ tenantId: 'tenant.b', conversationId: 'conv.shared' })).toStrictEqual(
      b,
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Restart durability
// ---------------------------------------------------------------------------

describe('(8) durability', () => {
  it('survives closing and recreating the pool', async () => {
    const state = summaryReadyState('tenant.a', 'conv.durable', {
      phase: 'CONTACT',
      summaryConfirmed: true,
      continuityRevision: 0,
    });
    await store().createInitialIfAbsent({ state });

    const secondPool = createTestPool(`${APP}-restart`);
    try {
      const restarted = createPostgresRiyaConversationContinuityStore({ pool: secondPool });
      const loaded = await restarted.load({
        tenantId: 'tenant.a',
        conversationId: 'conv.durable',
      });
      expect(loaded).toStrictEqual(state);
    } finally {
      await closeDatabasePool(secondPool);
    }
  });
});

// ---------------------------------------------------------------------------
// 9-12. compareAndSet
// ---------------------------------------------------------------------------

describe('(9-12) compareAndSet', () => {
  it('(9) replaces the state when the stored revision matches', async () => {
    const built = store();
    await built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.1', 0) });

    const next = summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: next })).resolves.toBe(
      'UPDATED',
    );
    expect(await built.load({ tenantId: 'tenant.a', conversationId: 'conv.1' })).toStrictEqual(
      next,
    );
    expect(await rowCount()).toBe(1);
  });

  it('(10) a stale expected revision conflicts and mutates nothing', async () => {
    const built = store();
    // Reached the way production reaches it: born at 0, advanced one at a time to 7.
    const stored = await seedAtRevision(
      built,
      (revision) => summaryReadyState('tenant.a', 'conv.1', { continuityRevision: revision }),
      7,
    );

    // A WELL-FORMED request (6 -> 7 is a legal transition) from a caller whose observation is stale.
    // That is a genuine concurrency answer, which is exactly why it must be REVISION_CONFLICT and not
    // the invalid-input a malformed revision would earn.
    const attempted = fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 7 });
    await expect(built.compareAndSet({ expectedRevision: 6, nextState: attempted })).resolves.toBe(
      'REVISION_CONFLICT',
    );

    // Byte-for-byte unchanged. A conflict that quietly wrote would be the worst possible outcome.
    expect(await built.load({ tenantId: 'tenant.a', conversationId: 'conv.1' })).toStrictEqual(
      stored,
    );
  });

  it('(11) a missing row is NOT_FOUND, and no row is lazily created', async () => {
    const built = store();
    const next = summaryReadyState('tenant.a', 'conv.missing', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: next })).resolves.toBe(
      'NOT_FOUND',
    );
    expect(await rowCount()).toBe(0);
  });

  it('(12) concurrent compare-and-sets on one revision produce exactly one winner', async () => {
    const built = store();
    await built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.cas', 0) });

    // Every racer proposes the SAME legal next revision (0 -> 1) and differs in content. Under the
    // exact-+1 rule that is the only well-formed request from expected 0, so this measures genuine
    // concurrency rather than a mix of concurrency and rejected inputs.
    const attempts = Array.from({ length: 12 }, (_, index) =>
      initialState('tenant.a', 'conv.cas', 1, `city.r${String(index)}`),
    );
    const outcomes = await Promise.all(
      attempts.map((nextState) => built.compareAndSet({ expectedRevision: 0, nextState })),
    );

    expect(outcomes.filter((o) => o === 'UPDATED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'REVISION_CONFLICT')).toHaveLength(11);
    expect(outcomes.filter((o) => o === 'NOT_FOUND')).toHaveLength(0);
    expect(await rowCount()).toBe(1);

    // The durable state is one of the candidates, exactly as written — not a merge of several.
    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.cas' });
    expect(attempts.some((a) => JSON.stringify(a) === JSON.stringify(loaded))).toBe(true);
  });

  it('(12a) the next revision must be exactly expected + 1, and is stored as supplied', async () => {
    const built = store();
    await built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.rev', 0) });

    // The adapter VERIFIES the counter; it never fabricates it. A legal 0 -> 1 is stored verbatim.
    const next = summaryReadyState('tenant.a', 'conv.rev', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: next })).resolves.toBe(
      'UPDATED',
    );
    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.rev' });
    expect(loaded?.continuityRevision).toBe(1);
  });

  it('(12b) equal, backward and skipped next revisions are invalid-input BEFORE the database', async () => {
    const built = store();
    // Advance to 5 legally, so every attempt below is against a real row at a known revision.
    await seedAtRevision(
      built,
      (revision) => summaryReadyState('tenant.a', 'conv.bad', { continuityRevision: revision }),
      5,
    );

    for (const nextRevision of [5, 2, 0, 7, 41]) {
      expect(
        await codeOf(() =>
          built.compareAndSet({
            expectedRevision: 5,
            nextState: summaryReadyState('tenant.a', 'conv.bad', {
              continuityRevision: nextRevision,
            }),
          }),
        ),
        `next ${String(nextRevision)}`,
      ).toBe('invalid-input');
    }

    // None of them is a concurrency answer, and none of them touched the row.
    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.bad' });
    expect(loaded?.continuityRevision).toBe(5);
  });

  it('(12c) a conversation at the safe-integer ceiling has no legal transition', async () => {
    const built = store();
    expect(
      await codeOf(() =>
        built.compareAndSet({
          expectedRevision: Number.MAX_SAFE_INTEGER,
          nextState: summaryReadyState('tenant.a', 'conv.ceiling', {
            continuityRevision: Number.MAX_SAFE_INTEGER,
          }),
        }),
      ),
    ).toBe('invalid-input');
  });

  it('(12d) an initial state must be born at revision 0', async () => {
    const built = store();
    for (const revision of [1, 5, 41]) {
      expect(
        await codeOf(() =>
          built.createInitialIfAbsent({
            state: summaryReadyState('tenant.a', 'conv.born', { continuityRevision: revision }),
          }),
        ),
        `revision ${String(revision)}`,
      ).toBe('invalid-input');
    }
    expect(await rowCount()).toBe(0);
  });

  it('(12e) LOST-UPDATE REGRESSION: two writers at revision 5 cannot both win', async () => {
    // The exact failure the RWC-P2B technical review proved against the first implementation, which
    // accepted a next revision equal to the expected one: both writers were told UPDATED and the
    // first one's state was silently destroyed.
    const built = store();
    await seedAtRevision(
      built,
      (revision) => summaryReadyState('tenant.a', 'conv.lost', { continuityRevision: revision }),
      5,
    );

    // Both hold revision 5; both propose a WELL-FORMED 5 -> 6 with different content.
    const a = fullyDiscoveredState('tenant.a', 'conv.lost', { continuityRevision: 6 });
    const b = summaryReadyState('tenant.a', 'conv.lost', { continuityRevision: 6 });
    const outcomes = await Promise.all([
      built.compareAndSet({ expectedRevision: 5, nextState: a }),
      built.compareAndSet({ expectedRevision: 5, nextState: b }),
    ]);

    expect(outcomes.filter((o) => o === 'UPDATED')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'REVISION_CONFLICT')).toHaveLength(1);

    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.lost' });
    expect(loaded?.continuityRevision).toBe(6);
    // The durable state is exactly ONE of the two candidates -- the loser did not overwrite it.
    const winnerIsA = JSON.stringify(loaded) === JSON.stringify(a);
    const winnerIsB = JSON.stringify(loaded) === JSON.stringify(b);
    expect(winnerIsA !== winnerIsB).toBe(true);
    expect(await rowCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13-16. Canonical round trip
// ---------------------------------------------------------------------------

describe('(13-16) the canonical round trip', () => {
  it('(13,15) every field, including discovery and provenance JSON, round-trips exactly', async () => {
    const built = store();
    const state = fullyDiscoveredState('tenant.a', 'conv.full', { continuityRevision: 0 });
    await built.createInitialIfAbsent({ state });

    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.full' });
    expect(loaded).toStrictEqual(state);
    expect(loaded?.discovery.serviceInterestRef).toBe('service.modular-kitchen');
    expect(loaded?.discovery.scopeSummary).toBe(
      'Full kitchen refit including counters and storage.',
    );
    expect(loaded?.discovery.missingFields).toStrictEqual([]);
    expect(loaded?.discovery.behaviourVersion).toBe(1);
    for (const field of DISCOVERY_FIELDS_FROZEN) {
      expect(loaded?.fieldProvenance[field], field).toBe('user_stated');
    }
  });

  it('(14) all nine phases round-trip where the contract permits them', async () => {
    const built = store();
    for (const phase of RIYA_CONVERSATION_PHASES) {
      const conversationId = `conv.${phase.toLowerCase().replace(/_/g, '-')}`;
      const state = stateForPhase('tenant.phases', conversationId, phase);
      const created = await built.createInitialIfAbsent({ state });
      expect(created.disposition, phase).toBe('CREATED');
      const loaded = await built.load({ tenantId: 'tenant.phases', conversationId });
      expect(loaded, phase).toStrictEqual(state);
      expect(loaded?.phase, phase).toBe(phase);
    }
    expect(await rowCount()).toBe(RIYA_CONVERSATION_PHASES.length);
  });

  it('(16) completionEvidenceRef round-trips only in a valid COMPLETE state', async () => {
    const built = store();
    const complete = summaryReadyState('tenant.a', 'conv.complete', {
      phase: 'COMPLETE',
      summaryConfirmed: true,
      completionEvidenceRef: 'confirmation.evidence.7',
      continuityRevision: 0,
    });
    await built.createInitialIfAbsent({ state: complete });
    const loaded = await built.load({ tenantId: 'tenant.a', conversationId: 'conv.complete' });
    expect(loaded?.completionEvidenceRef).toBe('confirmation.evidence.7');

    // Not COMPLETE => no evidence, and the contract refuses it before SQL is reached.
    expect(
      await codeOf(() =>
        built.createInitialIfAbsent({
          state: {
            ...summaryReadyState('tenant.a', 'conv.x', { phase: 'SUMMARY' }),
            completionEvidenceRef: 'confirmation.evidence.8',
          },
        }),
      ),
    ).toBe('invalid-input');

    // And the DATABASE holds the same rule independently: a direct insert cannot do it either.
    await withClient(pool, async (client) => {
      await expect(
        client.query(
          `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                                 discovery, field_provenance, summary_confirmed, completion_evidence_ref)
           VALUES ('tenant.a','conv.direct',1,0,'SUMMARY','{}'::jsonb,'{}'::jsonb,false,'evidence.1')`,
        ),
      ).rejects.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// 17-19. Refusals
// ---------------------------------------------------------------------------

describe('(17-19) refusals', () => {
  it('(17) an invalid key is rejected before the database is reached', async () => {
    const built = store();
    expect(await codeOf(() => built.load({ tenantId: 'a b', conversationId: 'conv.1' }))).toBe(
      'invalid-input',
    );
    // Nothing was written and nothing was read: the table is untouched.
    expect(await rowCount()).toBe(0);
  });

  it('(18) a durable row that cannot pass the contract fails repository-invariant', async () => {
    const built = store();
    // Written by direct SQL, bypassing the adapter — a partially applied migration, a restore or a
    // hand-correction all arrive looking exactly like this. The database's own constraints allow it:
    // it deliberately does NOT restate the NeedDiscovery rules.
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                               discovery, field_provenance, summary_confirmed, completion_evidence_ref)
         VALUES ('tenant.a','conv.corrupt',1,0,'INTRO',
                 '{"completeness":"NOT_A_REAL_COMPLETENESS"}'::jsonb,'{}'::jsonb,false,NULL)`,
      );
    });

    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.corrupt' })),
    ).toBe('repository-invariant');

    // The corrupt row is NOT repaired, defaulted or deleted. Refusing is the whole behaviour.
    expect(await rowCount()).toBe(1);
  });

  it('(18a) a value with no provenance is refused even though no CHECK forbids it', async () => {
    const built = store();
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                               discovery, field_provenance, summary_confirmed, completion_evidence_ref)
         VALUES ('tenant.a','conv.unaccounted',1,0,'INTRO',
                 '{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":[],"serviceInterestRef":"service.x"}'::jsonb,
                 '{}'::jsonb,false,NULL)`,
      );
    });
    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.unaccounted' })),
    ).toBe('repository-invariant');
  });

  it('(18b) a SUMMARY state with nothing to summarise is refused on read', async () => {
    const built = store();
    // The summary-readiness rule is deliberately NOT in SQL, so this row inserts cleanly and must be
    // caught by the canonical constructor on the way out.
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                               discovery, field_provenance, summary_confirmed, completion_evidence_ref)
         VALUES ('tenant.a','conv.blanksummary',1,0,'SUMMARY',
                 '{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":[]}'::jsonb,
                 '{}'::jsonb,false,NULL)`,
      );
    });
    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.blanksummary' })),
    ).toBe('repository-invariant');
  });

  it('(19) an unavailable database throws and never becomes a normal outcome', async () => {
    const deadPool = createTestPool(`${APP}-dead`);
    await closeDatabasePool(deadPool);
    const dead = createPostgresRiyaConversationContinuityStore({ pool: deadPool });

    // Not undefined, not CREATED, not EXISTING, not NOT_FOUND, not REVISION_CONFLICT.
    for (const code of [
      await codeOf(() => dead.load({ tenantId: 'tenant.a', conversationId: 'conv.1' })),
      await codeOf(() => dead.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.1') })),
      await codeOf(() =>
        dead.compareAndSet({
          expectedRevision: 0,
          nextState: summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 1 }),
        }),
      ),
    ]) {
      expect(['store-unavailable', 'schema-incompatible']).toContain(code);
    }
  });
});

// ---------------------------------------------------------------------------
// 20-24. Isolation and privilege
// ---------------------------------------------------------------------------

describe('(20-24) isolation and privilege', () => {
  it('(20) no read or update crosses a tenant boundary', async () => {
    const built = store();
    const a = summaryReadyState('tenant.a', 'conv.shared', { continuityRevision: 0 });
    const b = summaryReadyState('tenant.b', 'conv.shared', { continuityRevision: 0 });
    await built.createInitialIfAbsent({ state: a });
    await built.createInitialIfAbsent({ state: b });

    // A compare-and-set for tenant B cannot touch tenant A's row.
    const nextB = fullyDiscoveredState('tenant.b', 'conv.shared', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: nextB })).resolves.toBe(
      'UPDATED',
    );
    expect(await built.load({ tenantId: 'tenant.a', conversationId: 'conv.shared' })).toStrictEqual(
      a,
    );
    expect(await built.load({ tenantId: 'tenant.b', conversationId: 'conv.shared' })).toStrictEqual(
      nextB,
    );

    // A tenant with no such conversation reads nothing, even though the id exists elsewhere.
    await expect(
      built.load({ tenantId: 'tenant.c', conversationId: 'conv.shared' }),
    ).resolves.toBeUndefined();
  });

  it('(21,22,23,24) the runtime role has exactly SELECT/INSERT/UPDATE and PUBLIC has nothing', async () => {
    await withClient(pool, async (client) => {
      const privileges = await client.query<{
        sel: boolean;
        ins: boolean;
        upd: boolean;
        del: boolean;
        trunc: boolean;
      }>(
        // UPDATE is asked with `has_any_column_privilege`, not `has_table_privilege`: the grant is
        // COLUMN-scoped, and a table-level check correctly reports false for one. Asserting the
        // table-level form would be asserting the wrong thing and would pass only if the grant were
        // wider than intended.
        `SELECT has_table_privilege($1, '${TABLE}', 'SELECT')            AS sel,
                has_table_privilege($1, '${TABLE}', 'INSERT')            AS ins,
                has_any_column_privilege($1, '${TABLE}', 'UPDATE')       AS upd,
                has_table_privilege($1, '${TABLE}', 'DELETE')            AS del,
                has_table_privilege($1, '${TABLE}', 'TRUNCATE')          AS trunc,
                has_table_privilege($1, '${TABLE}', 'UPDATE')            AS upd_whole_table`,
        [RUNTIME_ROLE],
      );
      const row = privileges.rows[0];
      expect(row?.sel).toBe(true);
      expect(row?.ins).toBe(true);
      expect(row?.upd).toBe(true);
      // And NOT table-wide: identity columns are outside the grant.
      expect((row as unknown as { upd_whole_table: boolean } | undefined)?.upd_whole_table).toBe(
        false,
      );
      // (21) no DELETE and (22) no TRUNCATE: erasure and retention are not RWC-P2B's decision.
      expect(row?.del).toBe(false);
      expect(row?.trunc).toBe(false);

      // (24) PUBLIC has nothing at all.
      const publicPrivileges = await client.query<{ any: boolean }>(
        `SELECT has_table_privilege('public', '${TABLE}', 'SELECT') AS any`,
      );
      expect(publicPrivileges.rows[0]?.any).toBe(false);

      // (23) UPDATE is column-scoped: identity is immutable as a privilege, not merely a promise.
      const updatable = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_schema = 'qf_jarvis'
            AND table_name = 'riya_conversation_continuity'
            AND grantee = $1 AND privilege_type = 'UPDATE'
          ORDER BY column_name`,
        [RUNTIME_ROLE],
      );
      expect(updatable.rows.map((r) => r.column_name)).toStrictEqual([
        'completion_evidence_ref',
        'continuity_revision',
        'discovery',
        'field_provenance',
        'phase',
        'summary_confirmed',
      ]);
    });
  });

  it('(23a) the runtime role can actually SELECT, INSERT and run a legal CAS', async () => {
    // The POSITIVE path, proven as the principal that will really run it. Asserting only the
    // refusals would leave a column-scoped grant that omits a CAS column passing CI and failing in
    // deployment -- every other test here runs as the OWNER, which bypasses grants entirely.
    const asRole = (await import('@qf-jarvis/event-backbone')).createDatabasePool(
      testDatabaseConfigAs(RUNTIME_ROLE, LOCAL_ONLY_PASSWORD, `${APP}-rw`),
    );
    try {
      await withClient(asRole, async (client) => {
        const who = await client.query<{ u: string }>('SELECT current_user AS u');
        expect(who.rows[0]?.u).toBe(RUNTIME_ROLE);
      });

      const roleStore = createPostgresRiyaConversationContinuityStore({ pool: asRole });
      const created = await roleStore.createInitialIfAbsent({
        state: initialState('tenant.role', 'conv.role', 0),
      });
      expect(created.disposition).toBe('CREATED');

      await expect(
        roleStore.compareAndSet({
          expectedRevision: 0,
          nextState: summaryReadyState('tenant.role', 'conv.role', { continuityRevision: 1 }),
        }),
      ).resolves.toBe('UPDATED');

      const loaded = await roleStore.load({
        tenantId: 'tenant.role',
        conversationId: 'conv.role',
      });
      expect(loaded?.continuityRevision).toBe(1);
    } finally {
      await closeDatabasePool(asRole);
    }
  });

  it('(21a,22a) the runtime role is actually refused a DELETE and a TRUNCATE', async () => {
    await store().createInitialIfAbsent({ state: initialState('tenant.a', 'conv.keep') });

    const rolePool = createTestPool(`${APP}-role`);
    // Reconnect as the runtime role itself: a privilege claim is only honest when the principal
    // that supposedly lacks it actually tries.
    const asRole = (await import('@qf-jarvis/event-backbone')).createDatabasePool(
      testDatabaseConfigAs(RUNTIME_ROLE, LOCAL_ONLY_PASSWORD, `${APP}-asrole`),
    );
    try {
      await withClient(asRole, async (client) => {
        await expect(client.query(`DELETE FROM ${TABLE}`)).rejects.toThrow();
      });
      await withClient(asRole, async (client) => {
        await expect(client.query(`TRUNCATE ${TABLE}`)).rejects.toThrow();
      });
      // Identity columns are not updatable either.
      await withClient(asRole, async (client) => {
        await expect(client.query(`UPDATE ${TABLE} SET tenant_id = 'tenant.b'`)).rejects.toThrow();
      });
    } finally {
      await closeDatabasePool(asRole);
      await closeDatabasePool(rolePool);
    }
    expect(await rowCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 25-26. Migration governance
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The DATABASE holds the revision invariant, independently of the adapter
// ---------------------------------------------------------------------------

describe('the migration 0011 revision guard', () => {
  /** Insert a row by DIRECT SQL, bypassing the adapter entirely. */
  async function directInsert(conversationId: string, revision: number): Promise<void> {
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                               discovery, field_provenance, summary_confirmed, completion_evidence_ref)
         VALUES ('tenant.db', $1, 1, $2, 'INTRO',
                 '{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":["serviceInterest","location","propertyType","scope","budget","timeline","consultationPreference"]}'::jsonb,
                 '{}'::jsonb, false, NULL)`,
        [conversationId, revision],
      );
    });
  }

  async function directUpdate(conversationId: string, revision: number): Promise<void> {
    await withClient(pool, async (client) => {
      await client.query(
        `UPDATE ${TABLE} SET continuity_revision = $2 WHERE conversation_id = $1`,
        [conversationId, revision],
      );
    });
  }

  it('accepts an INSERT at revision 0', async () => {
    await expect(directInsert('c.zero', 0)).resolves.toBeUndefined();
  });

  it('refuses an INSERT at any nonzero revision', async () => {
    for (const revision of [1, 2, 5, 41]) {
      await expect(
        directInsert(`c.nonzero${String(revision)}`, revision),
        `revision ${String(revision)}`,
      ).rejects.toThrow();
    }
    expect(await rowCount()).toBe(0);
  });

  it('accepts 0 -> 1 and 1 -> 2', async () => {
    await directInsert('c.walk', 0);
    await expect(directUpdate('c.walk', 1)).resolves.toBeUndefined();
    await expect(directUpdate('c.walk', 2)).resolves.toBeUndefined();
  });

  it('refuses a repeated, backward or skipped revision', async () => {
    await directInsert('c.bad', 0);
    await directUpdate('c.bad', 1);
    // Same, backward, skipped -- all refused by the database, not merely by the adapter.
    await expect(directUpdate('c.bad', 1)).rejects.toThrow();
    await expect(directUpdate('c.bad', 0)).rejects.toThrow();
    await expect(directUpdate('c.bad', 3)).rejects.toThrow();
    await withClient(pool, async (client) => {
      const r = await client.query<{ continuity_revision: string }>(
        `SELECT continuity_revision FROM ${TABLE} WHERE conversation_id = 'c.bad'`,
      );
      expect(r.rows[0]?.continuity_revision).toBe('1');
    });
  });

  it('refuses an identity mutation', async () => {
    await directInsert('c.identity', 0);
    await withClient(pool, async (client) => {
      await expect(
        client.query(
          `UPDATE ${TABLE} SET tenant_id = 'tenant.other', continuity_revision = 1
            WHERE conversation_id = 'c.identity'`,
        ),
      ).rejects.toThrow();
      await expect(
        client.query(
          `UPDATE ${TABLE} SET conversation_id = 'c.moved', continuity_revision = 1
            WHERE conversation_id = 'c.identity'`,
        ),
      ).rejects.toThrow();
    });
  });

  it('refuses to advance an exhausted revision', async () => {
    await directInsert('c.ceiling', 0);
    // Walk the row to the ceiling by disabling nothing: set it directly is impossible under the
    // guard, so prove the rule at the boundary the guard itself checks.
    await withClient(pool, async (client) => {
      await client.query(
        `ALTER TABLE ${TABLE} DISABLE TRIGGER riya_conversation_continuity_guard_trigger`,
      );
      await client.query(
        `UPDATE ${TABLE} SET continuity_revision = 9007199254740991 WHERE conversation_id = 'c.ceiling'`,
      );
      await client.query(
        `ALTER TABLE ${TABLE} ENABLE TRIGGER riya_conversation_continuity_guard_trigger`,
      );
    });
    await expect(directUpdate('c.ceiling', 9007199254740992)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// BIGINT boundaries
// ---------------------------------------------------------------------------

describe('the revision is read back exactly', () => {
  it('round-trips revision 0 as a JS number', async () => {
    const built = store();
    await built.createInitialIfAbsent({ state: initialState('tenant.big', 'c.zero', 0) });
    const loaded = await built.load({ tenantId: 'tenant.big', conversationId: 'c.zero' });
    expect(loaded?.continuityRevision).toBe(0);
    expect(typeof loaded?.continuityRevision).toBe('number');
  });

  it('round-trips MAX_SAFE_INTEGER exactly', async () => {
    // The guard forbids reaching the ceiling by increment, so the row is placed there directly with
    // the trigger briefly disabled. The point under test is the READ path, not the write rule.
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                               discovery, field_provenance, summary_confirmed, completion_evidence_ref)
         VALUES ('tenant.big','c.max',1,0,'INTRO',
                 '{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":["serviceInterest","location","propertyType","scope","budget","timeline","consultationPreference"]}'::jsonb,
                 '{}'::jsonb,false,NULL)`,
      );
      await client.query(
        `ALTER TABLE ${TABLE} DISABLE TRIGGER riya_conversation_continuity_guard_trigger`,
      );
      await client.query(
        `UPDATE ${TABLE} SET continuity_revision = 9007199254740991 WHERE conversation_id = 'c.max'`,
      );
      await client.query(
        `ALTER TABLE ${TABLE} ENABLE TRIGGER riya_conversation_continuity_guard_trigger`,
      );
    });
    const loaded = await store().load({ tenantId: 'tenant.big', conversationId: 'c.max' });
    expect(loaded?.continuityRevision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a corrupt revision above MAX_SAFE_INTEGER rather than rounding it', async () => {
    // `BIGINT` holds values JS cannot represent exactly. `Number('9007199254740993')` silently yields
    // 9007199254740992 -- a revision off by one, which is a lost update nobody can see. The CHECK is
    // dropped and restored so the read path can be proven against a row that should never exist.
    await withClient(pool, async (client) => {
      await client.query(
        `ALTER TABLE ${TABLE} DROP CONSTRAINT riya_conversation_continuity_revision_in_safe_range`,
      );
      await client.query(
        `ALTER TABLE ${TABLE} DISABLE TRIGGER riya_conversation_continuity_guard_trigger`,
      );
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, version, continuity_revision, phase,
                               discovery, field_provenance, summary_confirmed, completion_evidence_ref)
         VALUES ('tenant.big','c.corrupt',1,9007199254740993,'INTRO',
                 '{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":["serviceInterest","location","propertyType","scope","budget","timeline","consultationPreference"]}'::jsonb,
                 '{}'::jsonb,false,NULL)`,
      );
    });

    expect(
      await codeOf(() => store().load({ tenantId: 'tenant.big', conversationId: 'c.corrupt' })),
    ).toBe('repository-invariant');

    await withClient(pool, async (client) => {
      await client.query(`DELETE FROM ${TABLE} WHERE conversation_id = 'c.corrupt'`);
      await client.query(
        `ALTER TABLE ${TABLE} ENABLE TRIGGER riya_conversation_continuity_guard_trigger`,
      );
      await client.query(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT riya_conversation_continuity_revision_in_safe_range
         CHECK (continuity_revision >= 0 AND continuity_revision <= 9007199254740991)`,
      );
    });
  });

  it('refuses an expected revision above the safe range before the database', async () => {
    const built = store();
    for (const expectedRevision of [Number.MAX_SAFE_INTEGER + 1, -1, 1.5]) {
      expect(
        await codeOf(() =>
          built.compareAndSet({
            expectedRevision,
            nextState: initialState('tenant.big', 'c.zero', 1),
          }),
        ),
        String(expectedRevision),
      ).toBe('invalid-input');
    }
  });
});

describe('(25,26) migration governance', () => {
  it('(25) the migration set is exactly 0001-0011 with no 0012', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toStrictEqual([
      '0001_event_log.sql',
      '0002_event_runtime_grants.sql',
      '0003_ingestion_rejection_and_event_conflict.sql',
      '0004_projection_foundation.sql',
      '0005_projection_event_positions.sql',
      '0006_projection_failure_operations.sql',
      '0007_subject_activity_projection.sql',
      '0008_conversation_control_persistence.sql',
      '0009_durable_approval_queue.sql',
      '0010_execution_replay_claim.sql',
      '0011_riya_conversation_continuity.sql',
    ]);
    expect(files.some((n) => n.startsWith('0012'))).toBe(false);
  });

  it('(26) migrations 0001-0010 are byte-identical to the pre-RWC-P2B baseline', () => {
    // The hashes RWC-P2B inherited. RWC-P2B ADDS 0011; it may not touch a single byte of what came
    // before, because an edited historical migration produces one schema on a fresh database and a
    // different one on every database that already ran it.
    const BASELINE: Readonly<Record<string, string>> = {
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
      '0009_durable_approval_queue.sql':
        'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
      '0010_execution_replay_claim.sql':
        '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
    };
    for (const [name, hash] of Object.entries(BASELINE)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(MIGRATIONS_DIR, name)))
          .digest('hex'),
        name,
      ).toBe(hash);
    }
  });
});

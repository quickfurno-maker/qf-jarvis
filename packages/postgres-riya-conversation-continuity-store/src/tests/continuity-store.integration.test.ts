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
      // The owner-locked envelope design: identifier grammar and revision bounds on the first-class
      // columns, and cross-checks that the JSONB envelope agrees with the key columns it is indexed and
      // compared on. The domain rules (phase legality, provenance, summary readiness, complete-iff-
      // evidence) are deliberately NOT restated in SQL -- the constructor holds them on every read.
      expect(checks.rows.map((r) => r.conname)).toStrictEqual([
        'riya_conversation_continuity_conversation_is_identifier',
        'riya_conversation_continuity_revision_in_safe_range',
        'riya_conversation_continuity_state_conversation_matches',
        'riya_conversation_continuity_state_is_object',
        'riya_conversation_continuity_state_revision_matches',
        'riya_conversation_continuity_state_tenant_matches',
        'riya_conversation_continuity_state_version_is_one',
        'riya_conversation_continuity_tenant_is_identifier',
      ]);
      for (const row of checks.rows) {
        expect(row.convalidated, row.conname).toBe(true);
      }
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
      // The owner-locked shape: the tenant+conversation key, the first-class CAS revision, the single
      // validated JSONB envelope, and two database-stamped timestamps. Nothing else is a column.
      expect(names).toStrictEqual([
        'continuity_revision',
        'conversation_id',
        'created_at',
        'state_json',
        'tenant_id',
        'updated_at',
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
    // A row is born at revision 0; a richer-than-INTRO state is still legitimate at revision 0.
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
    // Both candidates are born at revision 0 (the only legitimate initial revision); they differ in
    // CONTENT, so the returned state still identifies which one won. The winner is a summary-ready
    // SUMMARY state; the loser is a bare INTRO state.
    const winner = summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 0 });
    await built.createInitialIfAbsent({ state: winner });

    // A DIFFERENT candidate for the same key. If the adapter returned what it was handed, this would
    // come back in phase INTRO with an empty discovery.
    const loser = initialState('tenant.a', 'conv.1');
    const result = await built.createInitialIfAbsent({ state: loser });

    expect(result.disposition).toBe('EXISTING');
    expect(result.state).toStrictEqual(winner);
    expect(result.state.phase).toBe('SUMMARY');
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
    // Every first turn proposes the SAME legitimate initial state at revision 0 -- initial persistence
    // is born at 0, so distinct starting revisions are not available to tell callers apart. The race is
    // real regardless: exactly one INSERT wins the primary key and the other nineteen see the winner.
    const candidates = Array.from({ length: 20 }, () =>
      initialState('tenant.race', 'conv.race', 0),
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
    // Born at 0, then advanced to 1 by a legitimate compare-and-set: the only way a row reaches a
    // nonzero revision now.
    await built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.1', 0) });
    const stored = summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: stored })).resolves.toBe(
      'UPDATED',
    );

    // A well-formed one-step advance FROM the STALE revision 0 (so the +1 rule is satisfied and the
    // request reaches SQL), which then finds no row at revision 0 because the stored one is at 1.
    const attempted = fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: attempted })).resolves.toBe(
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

    // Every caller proposes a VALID one-step advance to revision 1 (the +1 rule), so all twelve reach
    // SQL and genuinely race there. Distinct candidates so the winner is identifiable.
    const attempts = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0
        ? summaryReadyState('tenant.a', 'conv.cas', { continuityRevision: 1 })
        : fullyDiscoveredState('tenant.a', 'conv.cas', { continuityRevision: 1 }),
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

  it('(12a) a compare-and-set advances the revision by exactly one, or is refused', async () => {
    const built = store();
    await built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.rev', 0) });

    // ADR-0095: one continuity mutation is one revision. A next state that JUMPS is a caller defect --
    // a skipped step or a replay -- and it is refused as `invalid-input` BEFORE any SQL runs, so the
    // durable row is never touched. The database holds the same rule in its BEFORE UPDATE trigger.
    const jumped = summaryReadyState('tenant.a', 'conv.rev', { continuityRevision: 41 });
    expect(
      await codeOf(() => built.compareAndSet({ expectedRevision: 0, nextState: jumped })),
    ).toBe('invalid-input');
    expect(
      (await built.load({ tenantId: 'tenant.a', conversationId: 'conv.rev' }))?.continuityRevision,
    ).toBe(0);

    // And the correct one-step advance is accepted and stored.
    const next = summaryReadyState('tenant.a', 'conv.rev', { continuityRevision: 1 });
    await expect(built.compareAndSet({ expectedRevision: 0, nextState: next })).resolves.toBe(
      'UPDATED',
    );
    expect(
      (await built.load({ tenantId: 'tenant.a', conversationId: 'conv.rev' }))?.continuityRevision,
    ).toBe(1);
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

    // Not COMPLETE => no evidence, and the contract refuses it before SQL is reached. The complete-iff-
    // evidence rule is a DOMAIN rule, held by the constructor on every write and every read -- it is
    // deliberately NOT restated in SQL (ADR-0095 section 7), so a row that violated it would still be
    // caught, just on the way OUT rather than at INSERT. Test (18c) proves that read-side refusal.
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

  // A direct-SQL insert of an envelope that satisfies every CHECK (object, version 1, and identity and
  // revision agreeing with the columns) but that the P2A CONSTRUCTOR would refuse. That is exactly the
  // shape a partially applied migration, an older-dump restore or a hand-correction leaves behind, and
  // it is the corruption the read-side canonical proof exists to catch.
  async function insertRawEnvelope(
    conversationId: string,
    stateJson: string,
    revision = 0,
  ): Promise<void> {
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, continuity_revision, state_json)
         VALUES ('tenant.a', $1, $2, $3::jsonb)`,
        [conversationId, revision, stateJson],
      );
    });
  }

  it('(18) a durable row that cannot pass the contract fails repository-invariant', async () => {
    const built = store();
    await insertRawEnvelope(
      'conv.corrupt',
      '{"version":1,"tenantId":"tenant.a","conversationId":"conv.corrupt","continuityRevision":0,' +
        '"phase":"INTRO","discovery":{"completeness":"NOT_A_REAL_COMPLETENESS"},' +
        '"fieldProvenance":{},"summaryConfirmed":false}',
    );

    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.corrupt' })),
    ).toBe('repository-invariant');

    // The corrupt row is NOT repaired, defaulted or deleted. Refusing is the whole behaviour.
    expect(await rowCount()).toBe(1);
  });

  it('(18a) a value with no provenance is refused even though no CHECK forbids it', async () => {
    const built = store();
    await insertRawEnvelope(
      'conv.unaccounted',
      '{"version":1,"tenantId":"tenant.a","conversationId":"conv.unaccounted","continuityRevision":0,' +
        '"phase":"INTRO","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":[],' +
        '"serviceInterestRef":"service.x"},"fieldProvenance":{},"summaryConfirmed":false}',
    );
    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.unaccounted' })),
    ).toBe('repository-invariant');
  });

  it('(18b) a SUMMARY state with nothing to summarise is refused on read', async () => {
    const built = store();
    // The summary-readiness rule is deliberately NOT in SQL, so this row inserts cleanly and must be
    // caught by the canonical constructor on the way out.
    await insertRawEnvelope(
      'conv.blanksummary',
      '{"version":1,"tenantId":"tenant.a","conversationId":"conv.blanksummary","continuityRevision":0,' +
        '"phase":"SUMMARY","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED","missingFields":[]},' +
        '"fieldProvenance":{},"summaryConfirmed":false}',
    );
    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.blanksummary' })),
    ).toBe('repository-invariant');
  });

  it('(18c) a COMPLETE state with no completion evidence is refused on read', async () => {
    const built = store();
    // complete-iff-evidence is a DOMAIN rule the constructor holds, not a SQL CHECK (ADR-0095 s7). A
    // COMPLETE row missing its evidence inserts cleanly and is caught on the way out.
    await insertRawEnvelope(
      'conv.noevidence',
      '{"version":1,"tenantId":"tenant.a","conversationId":"conv.noevidence","continuityRevision":0,' +
        '"phase":"COMPLETE","discovery":{"serviceInterestRef":"service.x","locationRef":"city.x",' +
        '"budgetNote":"b","timelineNote":"t","completeness":"MORE_DISCOVERY_REQUIRED",' +
        '"missingFields":["propertyType","scope","consultationPreference"]},' +
        '"fieldProvenance":{"serviceInterest":"user_stated","location":"user_stated",' +
        '"budget":"user_stated","timeline":"user_stated"},"summaryConfirmed":true}',
    );
    expect(
      await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.noevidence' })),
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
    // Both rows are born at revision 0 under the same conversation id but different tenants.
    const a = summaryReadyState('tenant.a', 'conv.shared', { continuityRevision: 0 });
    const b = summaryReadyState('tenant.b', 'conv.shared', { continuityRevision: 0 });
    await built.createInitialIfAbsent({ state: a });
    await built.createInitialIfAbsent({ state: b });

    // A compare-and-set for tenant B (0 -> 1) cannot touch tenant A's row.
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
      // Exactly the three columns a compare-and-set replaces. The identity columns and created_at are
      // outside the grant, so identity immutability is a privilege as well as a trigger rule.
      expect(updatable.rows.map((r) => r.column_name)).toStrictEqual([
        'continuity_revision',
        'state_json',
        'updated_at',
      ]);
    });
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
// D1-D7. Database-held invariants (the trigger and the envelope CHECKs)
// ---------------------------------------------------------------------------
//
// These write by DIRECT SQL as the owning role, so they exercise the DATABASE's own guards, not the
// adapter's. A migration, a console session or a future second writer are exactly this: a caller the
// adapter cannot police. The trigger and the CHECKs are what make the durable invariants hold anyway.

describe('(D1-D7) database-held invariants', () => {
  async function seedRevisionZero(conversationId: string): Promise<void> {
    await store().createInitialIfAbsent({ state: initialState('tenant.a', conversationId, 0) });
  }

  async function expectDirectSqlRejected(sql: string, values: readonly unknown[]): Promise<void> {
    await withClient(pool, async (client) => {
      await expect(client.query(sql, values as unknown[])).rejects.toThrow();
    });
  }

  it('(D1) the trigger refuses a revision that jumps by more than one', async () => {
    await seedRevisionZero('conv.jump');
    // Envelope kept consistent with the column (so the CHECK passes and the TRIGGER is what refuses).
    await expectDirectSqlRejected(
      `UPDATE ${TABLE}
          SET continuity_revision = 2,
              state_json = jsonb_set(state_json, '{continuityRevision}', '2'::jsonb)
        WHERE tenant_id = 'tenant.a' AND conversation_id = $1`,
      ['conv.jump'],
    );
    expect(
      (await store().load({ tenantId: 'tenant.a', conversationId: 'conv.jump' }))
        ?.continuityRevision,
    ).toBe(0);
  });

  it('(D2) the trigger refuses an update that does not advance the revision', async () => {
    await seedRevisionZero('conv.same');
    await expectDirectSqlRejected(
      `UPDATE ${TABLE} SET continuity_revision = 0 WHERE tenant_id = 'tenant.a' AND conversation_id = $1`,
      ['conv.same'],
    );
  });

  it('(D3) the trigger refuses a tenant_id mutation', async () => {
    await seedRevisionZero('conv.idt');
    await expectDirectSqlRejected(
      `UPDATE ${TABLE} SET tenant_id = 'tenant.z' WHERE tenant_id = 'tenant.a' AND conversation_id = $1`,
      ['conv.idt'],
    );
  });

  it('(D4) the trigger refuses a conversation_id mutation', async () => {
    await seedRevisionZero('conv.idc');
    await expectDirectSqlRejected(
      `UPDATE ${TABLE} SET conversation_id = 'conv.moved' WHERE tenant_id = 'tenant.a' AND conversation_id = $1`,
      ['conv.idc'],
    );
  });

  it('(D5) a CHECK refuses an envelope whose revision disagrees with the column', async () => {
    await expectDirectSqlRejected(
      `INSERT INTO ${TABLE} (tenant_id, conversation_id, continuity_revision, state_json)
       VALUES ('tenant.a', 'conv.revmismatch', 0, $1::jsonb)`,
      [
        '{"version":1,"tenantId":"tenant.a","conversationId":"conv.revmismatch",' +
          '"continuityRevision":5,"phase":"INTRO","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED",' +
          '"missingFields":[]},"fieldProvenance":{},"summaryConfirmed":false}',
      ],
    );
    expect(await rowCount()).toBe(0);
  });

  it('(D6) a CHECK refuses an envelope whose tenantId disagrees with the column', async () => {
    await expectDirectSqlRejected(
      `INSERT INTO ${TABLE} (tenant_id, conversation_id, continuity_revision, state_json)
       VALUES ('tenant.a', 'conv.tenmismatch', 0, $1::jsonb)`,
      [
        '{"version":1,"tenantId":"tenant.b","conversationId":"conv.tenmismatch",' +
          '"continuityRevision":0,"phase":"INTRO","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED",' +
          '"missingFields":[]},"fieldProvenance":{},"summaryConfirmed":false}',
      ],
    );
  });

  it('(D7) a CHECK refuses an envelope whose conversationId disagrees with the column', async () => {
    await expectDirectSqlRejected(
      `INSERT INTO ${TABLE} (tenant_id, conversation_id, continuity_revision, state_json)
       VALUES ('tenant.a', 'conv.convmismatch', 0, $1::jsonb)`,
      [
        '{"version":1,"tenantId":"tenant.a","conversationId":"conv.other",' +
          '"continuityRevision":0,"phase":"INTRO","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED",' +
          '"missingFields":[]},"fieldProvenance":{},"summaryConfirmed":false}',
      ],
    );
  });

  it('(D8) an adapter compare-and-set advances 0 -> 1 through the trigger cleanly', async () => {
    await seedRevisionZero('conv.clean');
    const built = store();
    await expect(
      built.compareAndSet({
        expectedRevision: 0,
        nextState: summaryReadyState('tenant.a', 'conv.clean', { continuityRevision: 1 }),
      }),
    ).resolves.toBe('UPDATED');
    expect(
      (await built.load({ tenantId: 'tenant.a', conversationId: 'conv.clean' }))
        ?.continuityRevision,
    ).toBe(1);
  });

  it('(D9) the INSERT trigger refuses a row born at a nonzero revision', async () => {
    // A fully consistent envelope at revision 1 -- the column and the state_json agree, so every CHECK
    // passes -- must still be refused: a durable row is BORN at revision 0, and revision 1 was never
    // reached by a compare-and-set. The trigger, not a CHECK, is what enforces it.
    await expectDirectSqlRejected(
      `INSERT INTO ${TABLE} (tenant_id, conversation_id, continuity_revision, state_json)
       VALUES ('tenant.a', 'conv.bornnonzero', 1, $1::jsonb)`,
      [
        '{"version":1,"tenantId":"tenant.a","conversationId":"conv.bornnonzero",' +
          '"continuityRevision":1,"phase":"INTRO","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED",' +
          '"missingFields":[]},"fieldProvenance":{},"summaryConfirmed":false}',
      ],
    );
    expect(await rowCount()).toBe(0);
  });

  it('(D10) a row born at revision 0 by direct SQL is accepted', async () => {
    // The other side of D9: the SAME envelope at revision 0 inserts cleanly, so the trigger refuses
    // only the nonzero birth, not direct SQL as such.
    await withClient(pool, async (client) => {
      await client.query(
        `INSERT INTO ${TABLE} (tenant_id, conversation_id, continuity_revision, state_json)
         VALUES ('tenant.a', 'conv.bornzero', 0, $1::jsonb)`,
        [
          '{"version":1,"tenantId":"tenant.a","conversationId":"conv.bornzero",' +
            '"continuityRevision":0,"phase":"INTRO","discovery":{"completeness":"MORE_DISCOVERY_REQUIRED",' +
            '"missingFields":[]},"fieldProvenance":{},"summaryConfirmed":false}',
        ],
      );
    });
    expect(
      (await store().load({ tenantId: 'tenant.a', conversationId: 'conv.bornzero' }))
        ?.continuityRevision,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 25-26. Migration governance
// ---------------------------------------------------------------------------

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

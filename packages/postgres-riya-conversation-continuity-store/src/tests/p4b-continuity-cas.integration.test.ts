/**
 * RWC-P4B — the web service's continuity CAS against a REAL PostgreSQL (ADR-0099 §37).
 *
 * The companion in-memory suite in `riya-web-conversation-service` proves the service's decisions.
 * This one proves they survive contact with the durable store the decisions were written for: the
 * `0011` table, its revision trigger, its composite key and its optimistic compare-and-set.
 *
 * That distinction matters more here than usual. "The revision advanced by exactly one" is enforced
 * by a DATABASE TRIGGER, not by the adapter — an in-memory fake would happily agree with a service
 * that advanced it by two. And the second-conflict path needs a real competing writer on a real
 * second connection, because a "race" simulated on one serialized connection is a sequence.
 *
 * No managed database. This suite runs against a local test PostgreSQL, and it FAILS rather than
 * skips when there is none.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  JarvisRiyaConversationEvolutionInput,
  JarvisRiyaConversationEvolutionResult,
  RiyaConversationEvolutionJarvisRuntime,
} from '@qf-jarvis/jarvis-runtime';
import { createRiyaConversationObservationBatch } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaDiscoveryObservationV1 } from '@qf-jarvis/riya-conversation-evolution';
import { createRiyaWebConversationService } from '@qf-jarvis/riya-web-conversation-service';
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import type {
  RiyaWebConversationService,
  RiyaWebConversationTurnV1,
} from '@qf-jarvis/riya-web-conversation-service';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresRiyaConversationContinuityStore } from '../index.js';
import type { PostgresRiyaContinuityStore } from '../index.js';
import {
  closeDatabasePool,
  createTestPool,
  ensureLoginRole,
  resetAndMigrate,
  testDatabaseConfig,
  withClient,
  type DatabasePool,
} from './harness.js';

const APP = 'rwc-p4b-integration';
const RUNTIME_ROLE = 'qf_jarvis_runtime';
const LOCAL_ONLY_PASSWORD = 'local-rwc-p4b-only';
const TABLE = 'qf_jarvis.riya_conversation_continuity';
const TENANT = 'tenant.p4b';
const CONVERSATION = 'conv.p4b.1';
const RUNTIME_ID = 'rt.web.p4b';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(
  new URL('packages/event-backbone/src/persistence/migrations/', REPO_ROOT),
);

let pool: DatabasePool;

beforeAll(async () => {
  pool = createTestPool(APP);
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

function store(activePool: DatabasePool = pool): PostgresRiyaContinuityStore {
  return createPostgresRiyaConversationContinuityStore({ pool: activePool });
}

const SET = (field: string, value: string): RiyaDiscoveryObservationV1 =>
  ({
    field,
    operation: 'SET',
    value,
    provenance: 'user_stated',
  }) as RiyaDiscoveryObservationV1;

/**
 * A runtime stand-in that returns a scripted batch and nothing else.
 *
 * The model, the gateway, Core and the orchestrator are all out of scope here: this suite is about
 * what reaches the DATABASE once a turn has validly observed something. It counts its calls anyway,
 * so a spec can still prove the reconciliation never ran the turn again.
 */
function scriptedRuntime(observations: readonly RiyaDiscoveryObservationV1[]): {
  readonly runtime: RiyaConversationEvolutionJarvisRuntime;
  readonly invoked: () => number;
} {
  let n = 0;
  const runtime = {
    processInbound: () => Promise.reject(new Error('not used')),
    processInboundForCoreAuthorizedReply: () => Promise.reject(new Error('not used')),
    // RWC-P7 (ADR-0103): the service now requires this capability at construction, and these specs
    // are all PRE-summary. Rejecting is the honest stub -- a turn reaching it would mean the phase
    // routing sent a discovery turn to the post-summary path, and the spec should fail loudly.
    processInboundForRiyaGroundedReply: () => Promise.reject(new Error('not used')),
    processInboundForRiyaConversationEvolution(
      input: JarvisRiyaConversationEvolutionInput,
    ): Promise<JarvisRiyaConversationEvolutionResult> {
      n += 1;
      return Promise.resolve({
        runtimeResult: {
          outcome: 'CORE_ACCEPTED' as const,
          runId: input.envelope.runtimeId,
          conversationId: input.envelope.conversationId,
          boundRevision: 1,
          assignedActor: 'RIYA' as const,
          proposalId: 'prop.p4b.1',
          modelDrafted: true,
          coreConsulted: true,
          refusalReason: undefined,
          provenance: undefined,
        },
        authorizedReply: {
          version: 1 as const,
          proposalId: 'prop.p4b.1',
          boundRevision: 1,
          proposalKind: 'REPLY' as const,
          replyBody: 'Understood — thank you.',
        },
        observationBatch:
          observations.length === 0 && n > 1
            ? undefined
            : createRiyaConversationObservationBatch({
                version: 1,
                observations,
                skipProjectDetails: false,
              }),
      });
    },
    applyConversationControlCommand: () => Promise.reject(new Error('not used')),
    readConversationOperationsSnapshot: () => Promise.reject(new Error('not used')),
  } as unknown as RiyaConversationEvolutionJarvisRuntime;
  return { runtime, invoked: () => n };
}

function service(
  observations: readonly RiyaDiscoveryObservationV1[],
  activePool: DatabasePool = pool,
): { readonly svc: RiyaWebConversationService; readonly invoked: () => number } {
  const scripted = scriptedRuntime(observations);
  return {
    svc: createRiyaWebConversationService({
      runtime: scripted.runtime,
      continuityStore: store(activePool),
      // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
      // every pre-P5 spec meaning exactly what it meant before.
      availabilityReader: scriptedAvailabilityReader(),
      runtimeId: RUNTIME_ID,
    }),
    invoked: scripted.invoked,
  };
}

function turn(over: Partial<RiyaWebConversationTurnV1> = {}): RiyaWebConversationTurnV1 {
  return {
    version: 1,
    tenantId: TENANT,
    conversationId: CONVERSATION,
    messageId: 'msg.p4b.1',
    receivedAt: '2026-08-07T09:00:00Z',
    webTurnRef: 'web.turn.p4b',
    dataClass: 'HOSTED_ALLOWED',
    normalizedText: 'I want a modular kitchen in Pune',
    ...over,
  };
}

/** Load the one row this suite works on, refusing rather than asserting it away. */
async function loadedRow(
  s: PostgresRiyaContinuityStore,
): Promise<NonNullable<Awaited<ReturnType<PostgresRiyaContinuityStore['load']>>>> {
  const row = await s.load({ tenantId: TENANT, conversationId: CONVERSATION });
  if (row === undefined) {
    throw new Error('the seeded conversation is missing');
  }
  return row;
}

async function storedRevision(
  tenantId = TENANT,
  conversationId = CONVERSATION,
): Promise<number | undefined> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ continuity_revision: string }>(
      `SELECT continuity_revision FROM ${TABLE} WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, conversationId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : Number(row.continuity_revision);
  });
}

// ---------------------------------------------------------------------------
// The ordinary durable turn.
// ---------------------------------------------------------------------------

describe('a turn that observes something writes it durably', () => {
  it('a first turn creates revision 0 and then advances it to 1', async () => {
    const { svc } = service([SET('serviceInterest', 'service.modular-kitchen')]);
    const result = await svc.handleTurn(turn());

    expect(result.continuity.continuityRevision).toBe(1);
    expect(result.continuity.discovery.serviceInterestRef).toBe('service.modular-kitchen');
    // The revision the DATABASE holds, read outside the adapter entirely.
    expect(await storedRevision()).toBe(1);
  });

  it('a brand-new conversation is created with exactly the four blocking fields missing', async () => {
    // No observations at all: the row is created and left alone, so what is asserted here is the
    // INITIAL shape the service writes rather than anything the reducer produced.
    const { svc } = service([]);
    const result = await svc.handleTurn(turn({ conversationId: 'conv.p4b.fresh' }));
    expect(result.continuity.continuityRevision).toBe(0);
    expect([...result.continuity.discovery.missingFields]).toStrictEqual([
      'serviceInterest',
      'location',
      'budget',
      'timeline',
    ]);
    expect(await storedRevision(TENANT, 'conv.p4b.fresh')).toBe(0);
  });

  it('a reload through a NEW store instance returns the evolved state', async () => {
    const { svc } = service([SET('location', 'city.pune')]);
    await svc.handleTurn(turn());

    // A second adapter object, so nothing in-process could be answering from memory.
    const reloaded = await store().load({ tenantId: TENANT, conversationId: CONVERSATION });
    expect(reloaded?.continuityRevision).toBe(1);
    expect(reloaded?.discovery.locationRef).toBe('city.pune');
    expect(reloaded?.fieldProvenance.location).toBe('user_stated');
  });

  it('survives a pool restart: the evolved state is on disk, not in a process', async () => {
    const { svc } = service([SET('budget', 'Around 8 lakh.')]);
    await svc.handleTurn(turn());

    const second = createTestPool(`${APP}-restart`);
    try {
      const reloaded = await createPostgresRiyaConversationContinuityStore({ pool: second }).load({
        tenantId: TENANT,
        conversationId: CONVERSATION,
      });
      expect(reloaded?.continuityRevision).toBe(1);
      expect(reloaded?.discovery.budgetNote).toBe('Around 8 lakh.');
    } finally {
      await closeDatabasePool(second);
    }
  });

  it('four facts in one turn is ONE revision, and the trigger agrees', async () => {
    const { svc } = service([
      SET('serviceInterest', 'service.modular-kitchen'),
      SET('location', 'city.pune'),
      SET('budget', 'Around 8 lakh.'),
      SET('timeline', 'Next month.'),
    ]);
    const result = await svc.handleTurn(turn());

    // `0011`'s trigger refuses a revision that jumps by more than one, so a service that wrote a
    // revision per observation would fail here rather than quietly recording four.
    expect(result.continuity.continuityRevision).toBe(1);
    expect(await storedRevision()).toBe(1);
    expect(result.continuity.discovery.completeness).toBe('SUFFICIENT_FOR_CORE_REVIEW');
    expect(result.continuity.phase).toBe('SUMMARY');
  });

  it('a turn that observes nothing writes nothing at all', async () => {
    const { svc } = service([]);
    await svc.handleTurn(turn());
    const before = await storedRevision();
    await svc.handleTurn(turn({ messageId: 'msg.p4b.2' }));
    expect(await storedRevision()).toBe(before);
  });

  it('two tenants holding the same conversation id stay two independent rows', async () => {
    const a = service([SET('location', 'city.pune')]);
    const b = service([SET('location', 'city.mumbai')]);
    await a.svc.handleTurn(turn());
    await b.svc.handleTurn(turn({ tenantId: 'tenant.p4b.other' }));

    const rowA = await store().load({ tenantId: TENANT, conversationId: CONVERSATION });
    const rowB = await store().load({
      tenantId: 'tenant.p4b.other',
      conversationId: CONVERSATION,
    });
    expect(rowA?.discovery.locationRef).toBe('city.pune');
    expect(rowB?.discovery.locationRef).toBe('city.mumbai');
  });
});

// ---------------------------------------------------------------------------
// A real competing writer.
// ---------------------------------------------------------------------------

describe('a real race on one conversation', () => {
  /**
   * Advance the stored state from another SESSION, between the turn's load and its write.
   *
   * The competing writer uses the ordinary adapter on a separate pool, so the conflict the service
   * meets is one PostgreSQL actually produced.
   */
  async function competingWrite(
    apply: (current: NonNullable<Awaited<ReturnType<PostgresRiyaContinuityStore['load']>>>) => {
      readonly field: string;
      readonly value: string;
    },
  ): Promise<void> {
    const other = createTestPool(`${APP}-competitor`);
    try {
      const s = createPostgresRiyaConversationContinuityStore({ pool: other });
      const current = await s.load({ tenantId: TENANT, conversationId: CONVERSATION });
      if (current === undefined) {
        throw new Error('competing writer found no row');
      }
      const { field, value } = apply(current);
      const { evolveRiyaConversation } = await import('@qf-jarvis/riya-conversation-evolution');
      const evolved = evolveRiyaConversation({
        current,
        batch: {
          version: 1,
          observations: [SET(field, value)],
          skipProjectDetails: false,
        },
      });
      const outcome = await s.compareAndSet({
        expectedRevision: current.continuityRevision,
        nextState: evolved.state,
      });
      expect(outcome).toBe('UPDATED');
    } finally {
      await closeDatabasePool(other);
    }
  }

  it('a stale expected revision really does conflict', async () => {
    // The primitive the whole reconciliation is built on, proved directly against the database.
    const seed = service([SET('serviceInterest', 'service.modular-kitchen')]);
    await seed.svc.handleTurn(turn());
    const stale = await loadedRow(store());
    await competingWrite(() => ({ field: 'location', value: 'city.pune' }));

    const { evolveRiyaConversation } = await import('@qf-jarvis/riya-conversation-evolution');
    const evolved = evolveRiyaConversation({
      current: stale,
      batch: {
        version: 1,
        observations: [SET('budget', 'Around 8 lakh.')],
        skipProjectDetails: false,
      },
    });
    expect(
      await store().compareAndSet({
        expectedRevision: stale.continuityRevision,
        nextState: evolved.state,
      }),
    ).toBe('REVISION_CONFLICT');
  });

  it('a conflicting turn re-merges against the winner and its second attempt succeeds', async () => {
    // Seed a row so both writers have something to race over.
    await service([SET('serviceInterest', 'service.modular-kitchen')]).svc.handleTurn(turn());

    // A service whose store hands out a STALE state on load, so the first compare-and-set is
    // guaranteed to lose to the row the competing writer committed.
    const real = store();
    const stale = await loadedRow(real);
    await competingWrite(() => ({ field: 'location', value: 'city.pune' }));

    let loads = 0;
    const staleFirstStore = {
      load: async (key: { tenantId: string; conversationId: string }) => {
        loads += 1;
        // The FIRST read is the stale one; the reconciliation's reload sees the real row.
        return loads === 1 ? stale : real.load(key);
      },
      createInitialIfAbsent: real.createInitialIfAbsent.bind(real),
      compareAndSet: real.compareAndSet.bind(real),
    };
    const scripted = scriptedRuntime([SET('budget', 'Around 8 lakh.')]);
    const svc = createRiyaWebConversationService({
      runtime: scripted.runtime,
      continuityStore: staleFirstStore,
      // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
      // every pre-P5 spec meaning exactly what it meant before.
      availabilityReader: scriptedAvailabilityReader(),
      runtimeId: RUNTIME_ID,
    });

    const result = await svc.handleTurn(turn({ messageId: 'msg.p4b.conflict' }));

    // Both facts survive, and the revision advanced exactly ONCE past the winner's. The seed turn
    // reached 1, the competing writer took it to 2, and this turn's reconciliation lands on 3 --
    // not on 2, which is what a service that re-applied its stale merge would have written.
    expect(result.continuity.discovery.locationRef).toBe('city.pune');
    expect(result.continuity.discovery.budgetNote).toBe('Around 8 lakh.');
    expect(result.continuity.continuityRevision).toBe(3);
    expect(await storedRevision()).toBe(3);
    // Exactly two loads: the turn's own and the ONE reload. And the turn ran once.
    expect(loads).toBe(2);
    expect(scripted.invoked()).toBe(1);
  });

  it('losing twice is continuity-conflict, with no third attempt and no re-run', async () => {
    await service([SET('serviceInterest', 'service.modular-kitchen')]).svc.handleTurn(turn());

    const real = store();
    const stale = await loadedRow(real);
    await competingWrite(() => ({ field: 'location', value: 'city.pune' }));

    let attempts = 0;
    let loads = 0;
    const alwaysStaleStore = {
      load: (key: { tenantId: string; conversationId: string }) => {
        loads += 1;
        // Both reads hand back the SAME stale state, so both compare-and-sets are doomed. That is
        // the durable shape of "a third writer keeps winning while this turn reconciles".
        void key;
        return Promise.resolve(stale);
      },
      createInitialIfAbsent: real.createInitialIfAbsent.bind(real),
      compareAndSet: async (input: Parameters<PostgresRiyaContinuityStore['compareAndSet']>[0]) => {
        attempts += 1;
        return real.compareAndSet(input);
      },
    };
    const scripted = scriptedRuntime([SET('budget', 'Around 8 lakh.')]);
    const svc = createRiyaWebConversationService({
      runtime: scripted.runtime,
      continuityStore: alwaysStaleStore,
      // RWC-P5: the authority reader is REQUIRED. A deterministic synthetic snapshot keeps
      // every pre-P5 spec meaning exactly what it meant before.
      availabilityReader: scriptedAvailabilityReader(),
      runtimeId: RUNTIME_ID,
    });

    await expect(svc.handleTurn(turn({ messageId: 'msg.p4b.doomed' }))).rejects.toMatchObject({
      code: 'continuity-conflict',
    });

    expect(attempts).toBe(2);
    expect(loads).toBe(2);
    // No model, runtime or Core retry: the turn ran exactly once regardless of how the write went.
    expect(scripted.invoked()).toBe(1);
    // And the winner's row is untouched by the loser.
    const finalRow = await real.load({ tenantId: TENANT, conversationId: CONVERSATION });
    expect(finalRow?.discovery.budgetNote).toBeUndefined();
    expect(finalRow?.discovery.locationRef).toBe('city.pune');
  });
});

// ---------------------------------------------------------------------------
// Migration governance.
// ---------------------------------------------------------------------------

describe('this slice needed no schema', () => {
  it('the migration set is still exactly 0001-0011, with 0011 byte-exact', () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(files).toHaveLength(11);
    expect(files.some((name) => name.startsWith('0012'))).toBe(false);
    expect(
      createHash('sha256')
        .update(readFileSync(join(MIGRATIONS_DIR, '0011_riya_conversation_continuity.sql')))
        .digest('hex'),
    ).toBe('80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93');
  });
});

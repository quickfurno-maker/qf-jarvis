import { EXECUTION_DISPATCH_REASONS } from '@qf-jarvis/execution-dispatch-runtime';
import type {
  ExecutionReplayGuard,
  ReplayClaimOutcome,
} from '@qf-jarvis/execution-dispatch-runtime';
import { createDatabasePool } from '@qf-jarvis/event-backbone';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createPostgresExecutionReplayStore } from '../index.js';
import { PostgresExecutionReplayStoreError } from '../index.js';
import {
  aBodyDigest,
  anIdempotencyKey,
  anIntentId,
  closeDatabasePool,
  createBarrier,
  createTestPool,
  ensureLoginRole,
  resetAndMigrate,
  testDatabaseConfig,
  testDatabaseConfigAs,
  warmPool,
  withClient,
  type DatabasePool,
} from './harness.js';

/**
 * The durable execution replay store against REAL PostgreSQL (QFJ-P09.03, ADR-0091).
 *
 * These are the tests that cannot be faked. An in-memory guard passes every test that never opens a
 * connection — it is precisely the thing that would look correct here and lose its state on the next
 * restart — so restart durability and single-first-seen arbitration under genuine separate-connection
 * concurrency are proved against a real server or not at all.
 *
 * The suite fails rather than skips without `DATABASE_URL`, and the harness refuses any target that
 * is not a loopback, test-named database. Migration 0010 is LOCAL/CI only.
 */

const APP = 'qfj-p09-03-replay-store';
/** Wide enough that a twenty-way race is twenty sessions, not two waves of ten. */
const CONTENTION = 20;

let pool: DatabasePool;
let store: ExecutionReplayGuard;

beforeAll(async () => {
  pool = createTestPool(APP, CONTENTION + 4);
  // Created BEFORE migrating, so 0010's conditional grant block actually fires for it.
  await ensureLoginRole(pool, 'qf_jarvis_runtime', 'local-p0903-only');
  await resetAndMigrate(pool, testDatabaseConfig(APP, CONTENTION + 4));
  await warmPool(pool, CONTENTION);
  store = createPostgresExecutionReplayStore({ pool });
}, 180_000);

afterAll(async () => {
  await closeDatabasePool(pool);
});

beforeEach(async () => {
  await withClient(pool, async (client) => {
    // TRUNCATE bypasses the append-only trigger by design. This is test teardown, not a runtime
    // capability — the runtime role is granted neither DELETE nor TRUNCATE, and a test below proves
    // exactly that.
    await client.query('TRUNCATE qf_jarvis.execution_replay_claim');
  });
});

function rowCount(): Promise<number> {
  return withClient(pool, async (client) => {
    const result = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM qf_jarvis.execution_replay_claim',
    );
    return Number(result.rows[0]?.n ?? '-1');
  });
}

// ---------------------------------------------------------------------------
// 1-6. The sequential semantics.
// ---------------------------------------------------------------------------

describe('sequential claim semantics', () => {
  it('(1) a first claim is first-seen, and is durably written', async () => {
    const claim = {
      executionIntentId: anIntentId(),
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: aBodyDigest('ab'),
    };
    await expect(store.claim(claim)).resolves.toBe('first-seen');
    expect(await rowCount()).toBe(1);
  });

  it('(2) the same exact triple later is exact-replay, and writes NOTHING', async () => {
    const claim = {
      executionIntentId: anIntentId(),
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: aBodyDigest('cd'),
    };
    await expect(store.claim(claim)).resolves.toBe('first-seen');

    const before = await withClient(pool, async (client) => {
      const r = await client.query<{ claimed_at: Date }>(
        'SELECT claimed_at FROM qf_jarvis.execution_replay_claim WHERE execution_intent_id = $1',
        [claim.executionIntentId],
      );
      return r.rows[0]?.claimed_at;
    });

    await expect(store.claim(claim)).resolves.toBe('exact-replay');
    await expect(store.claim(claim)).resolves.toBe('exact-replay');

    // No second row, and no `claimed_at` refresh: an exact replay is a READ. If the timestamp
    // moved, something wrote — and the only thing a replay may do is decline to write.
    expect(await rowCount()).toBe(1);
    const after = await withClient(pool, async (client) => {
      const r = await client.query<{ claimed_at: Date }>(
        'SELECT claimed_at FROM qf_jarvis.execution_replay_claim WHERE execution_intent_id = $1',
        [claim.executionIntentId],
      );
      return r.rows[0]?.claimed_at;
    });
    expect(after?.getTime()).toBe(before?.getTime());
  });

  it('(3) the same intent under a DIFFERENT key is conflict', async () => {
    const executionIntentId = anIntentId();
    const digest = aBodyDigest('ef');
    await expect(
      store.claim({ executionIntentId, idempotencyKey: anIdempotencyKey(), bodyDigestHex: digest }),
    ).resolves.toBe('first-seen');
    await expect(
      store.claim({ executionIntentId, idempotencyKey: anIdempotencyKey(), bodyDigestHex: digest }),
    ).resolves.toBe('conflict');
    expect(await rowCount()).toBe(1);
  });

  it('(4) the same intent and key carrying DIFFERENT bytes is conflict', async () => {
    const executionIntentId = anIntentId();
    const idempotencyKey = anIdempotencyKey();
    await expect(
      store.claim({ executionIntentId, idempotencyKey, bodyDigestHex: aBodyDigest('1a') }),
    ).resolves.toBe('first-seen');
    await expect(
      store.claim({ executionIntentId, idempotencyKey, bodyDigestHex: aBodyDigest('2b') }),
    ).resolves.toBe('conflict');
    expect(await rowCount()).toBe(1);
  });

  it('(5) a DIFFERENT intent reusing the same key is conflict', async () => {
    const idempotencyKey = anIdempotencyKey();
    const digest = aBodyDigest('3c');
    await expect(
      store.claim({ executionIntentId: anIntentId(), idempotencyKey, bodyDigestHex: digest }),
    ).resolves.toBe('first-seen');
    await expect(
      store.claim({ executionIntentId: anIntentId(), idempotencyKey, bodyDigestHex: digest }),
    ).resolves.toBe('conflict');
    expect(await rowCount()).toBe(1);
  });

  it('(6) a CROSSED collision — intent matches one row, key matches another — is conflict', async () => {
    const intentA = anIntentId();
    const keyA = anIdempotencyKey();
    const intentB = anIntentId();
    const keyB = anIdempotencyKey();
    await expect(
      store.claim({
        executionIntentId: intentA,
        idempotencyKey: keyA,
        bodyDigestHex: aBodyDigest('4d'),
      }),
    ).resolves.toBe('first-seen');
    await expect(
      store.claim({
        executionIntentId: intentB,
        idempotencyKey: keyB,
        bodyDigestHex: aBodyDigest('5e'),
      }),
    ).resolves.toBe('first-seen');

    // This is the case an `AND` in the reconciliation read would miss entirely: neither stored row
    // matches both incoming identities, and the store must still refuse.
    await expect(
      store.claim({
        executionIntentId: intentA,
        idempotencyKey: keyB,
        bodyDigestHex: aBodyDigest('6f'),
      }),
    ).resolves.toBe('conflict');
    expect(await rowCount()).toBe(2);
  });

  it('a conflict repairs, overwrites and merges nothing', async () => {
    const executionIntentId = anIntentId();
    const idempotencyKey = anIdempotencyKey();
    const original = aBodyDigest('7a');
    await expect(
      store.claim({ executionIntentId, idempotencyKey, bodyDigestHex: original }),
    ).resolves.toBe('first-seen');
    await expect(
      store.claim({ executionIntentId, idempotencyKey, bodyDigestHex: aBodyDigest('8b') }),
    ).resolves.toBe('conflict');

    const stored = await withClient(pool, async (client) => {
      const r = await client.query<{ idempotency_key: string; body_digest_hex: string }>(
        'SELECT idempotency_key, body_digest_hex FROM qf_jarvis.execution_replay_claim WHERE execution_intent_id = $1',
        [executionIntentId],
      );
      return r.rows[0];
    });
    expect(stored?.idempotency_key).toBe(idempotencyKey);
    expect(stored?.body_digest_hex).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// 7-10. Concurrency. Real separate connections, real PostgreSQL.
// ---------------------------------------------------------------------------

/** Run `claims` simultaneously, each on its own pooled connection, released together by a barrier. */
async function race(
  claims: readonly { executionIntentId: string; idempotencyKey: string; bodyDigestHex: string }[],
): Promise<{ outcomes: ReplayClaimOutcome[]; thrown: number }> {
  const barrier = createBarrier(claims.length);
  const settled = await Promise.allSettled(
    claims.map(async (claim) => {
      await barrier.arriveAndWait();
      return store.claim(claim);
    }),
  );
  const outcomes: ReplayClaimOutcome[] = [];
  let thrown = 0;
  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      outcomes.push(entry.value);
    } else {
      thrown += 1;
    }
  }
  return { outcomes, thrown };
}

function tally(outcomes: readonly ReplayClaimOutcome[]): Record<string, number> {
  const counts: Record<string, number> = { 'first-seen': 0, 'exact-replay': 0, conflict: 0 };
  for (const outcome of outcomes) {
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  return counts;
}

describe('concurrency: the database arbitrates, and exactly one caller wins', () => {
  it(`the harness really produces ${String(CONTENTION)} simultaneous server sessions`, async () => {
    // Without this, every assertion below could be satisfied by a suite that quietly serialised
    // itself on one connection — which would prove the store is correct sequentially and say
    // nothing at all about the race it claims to run. `claim` takes its own pooled connection, so
    // this measures exactly the mechanism the races rely on.
    const barrier = createBarrier(CONTENTION);
    const pids = await Promise.all(
      Array.from({ length: CONTENTION }, async () => {
        const client = await pool.connect();
        try {
          await barrier.arriveAndWait();
          const r = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          return r.rows[0]?.pid;
        } finally {
          client.release();
        }
      }),
    );
    expect(new Set(pids).size).toBe(CONTENTION);
  }, 60_000);

  it(`(7) ${String(CONTENTION)} concurrent claims of an IDENTICAL triple: one first-seen, the rest exact-replay`, async () => {
    const claim = {
      executionIntentId: anIntentId(),
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: aBodyDigest('9c'),
    };
    const { outcomes, thrown } = await race(Array.from({ length: CONTENTION }, () => claim));

    expect(thrown).toBe(0);
    const counts = tally(outcomes);
    // The whole point of the slice, in one assertion.
    expect(counts['first-seen']).toBe(1);
    expect(counts['exact-replay']).toBe(CONTENTION - 1);
    expect(counts['conflict']).toBe(0);
    expect(await rowCount()).toBe(1);
  }, 60_000);

  it('(8) concurrent SAME intent / DIFFERENT keys: one first-seen, every loser conflict', async () => {
    const executionIntentId = anIntentId();
    const digest = aBodyDigest('ad');
    const claims = Array.from({ length: CONTENTION }, () => ({
      executionIntentId,
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: digest,
    }));
    const { outcomes, thrown } = await race(claims);

    expect(thrown).toBe(0);
    const counts = tally(outcomes);
    expect(counts['first-seen']).toBe(1);
    expect(counts['conflict']).toBe(CONTENTION - 1);
    expect(counts['exact-replay']).toBe(0);
    // One intent, one durable binding. Nineteen fresh keys bought nothing.
    expect(await rowCount()).toBe(1);
  }, 60_000);

  it('(9) concurrent DIFFERENT intents / SAME key: one first-seen, every loser conflict', async () => {
    const idempotencyKey = anIdempotencyKey();
    const digest = aBodyDigest('be');
    const claims = Array.from({ length: CONTENTION }, () => ({
      executionIntentId: anIntentId(),
      idempotencyKey,
      bodyDigestHex: digest,
    }));
    const { outcomes, thrown } = await race(claims);

    expect(thrown).toBe(0);
    const counts = tally(outcomes);
    // This is the case a single composite primary key would have let straight through: without the
    // INDEPENDENT unique on idempotency_key, all twenty rows are distinct and all twenty win.
    expect(counts['first-seen']).toBe(1);
    expect(counts['conflict']).toBe(CONTENTION - 1);
    expect(counts['exact-replay']).toBe(0);
    expect(await rowCount()).toBe(1);
  }, 60_000);

  it('(10) concurrent SAME id and key / DIFFERENT digests: one first-seen, every loser conflict', async () => {
    const executionIntentId = anIntentId();
    const idempotencyKey = anIdempotencyKey();
    const claims = Array.from({ length: CONTENTION }, (_unused, index) => ({
      executionIntentId,
      idempotencyKey,
      bodyDigestHex: aBodyDigest(index.toString(16).padStart(2, '0') + 'f'),
    }));
    const { outcomes, thrown } = await race(claims);

    expect(thrown).toBe(0);
    const counts = tally(outcomes);
    expect(counts['first-seen']).toBe(1);
    expect(counts['conflict']).toBe(CONTENTION - 1);
    expect(counts['exact-replay']).toBe(0);
    expect(await rowCount()).toBe(1);
  }, 60_000);

  it('the single-winner property holds across repeated races, not once by luck', async () => {
    for (let round = 0; round < 8; round += 1) {
      const claim = {
        executionIntentId: anIntentId(),
        idempotencyKey: anIdempotencyKey(),
        bodyDigestHex: aBodyDigest('c0'),
      };
      const { outcomes, thrown } = await race(Array.from({ length: 8 }, () => claim));
      expect(thrown, `round ${String(round)}`).toBe(0);
      expect(tally(outcomes)['first-seen'], `round ${String(round)}`).toBe(1);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 11. Restart durability — the failure an in-memory guard hides.
// ---------------------------------------------------------------------------

describe('(11) restart durability', () => {
  it('a claim made through one pool is an exact replay through a brand new one', async () => {
    const claim = {
      executionIntentId: anIntentId(),
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: aBodyDigest('d1'),
    };

    const poolA = createTestPool(`${APP}-a`);
    try {
      const storeA = createPostgresExecutionReplayStore({ pool: poolA });
      await expect(storeA.claim(claim)).resolves.toBe('first-seen');
    } finally {
      await closeDatabasePool(poolA);
    }

    // Every connection from the first "process" is gone. An in-memory guard forgets here, and the
    // next dispatch of the same intent becomes a second provider effect.
    const poolB = createTestPool(`${APP}-b`);
    try {
      const storeB = createPostgresExecutionReplayStore({ pool: poolB });
      await expect(storeB.claim(claim)).resolves.toBe('exact-replay');
      await expect(storeB.claim({ ...claim, bodyDigestHex: aBodyDigest('d2') })).resolves.toBe(
        'conflict',
      );
    } finally {
      await closeDatabasePool(poolB);
    }
    expect(await rowCount()).toBe(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 12-14. Append-only, and least privilege.
// ---------------------------------------------------------------------------

describe('the claim is a permanent fact', () => {
  async function seedOne(): Promise<string> {
    const claim = {
      executionIntentId: anIntentId(),
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: aBodyDigest('e3'),
    };
    await expect(store.claim(claim)).resolves.toBe('first-seen');
    return claim.executionIntentId;
  }

  it('(12) UPDATE is refused by the database', async () => {
    const id = await seedOne();
    await expect(
      withClient(pool, (client) =>
        client.query(
          'UPDATE qf_jarvis.execution_replay_claim SET body_digest_hex = $2 WHERE execution_intent_id = $1',
          [id, aBodyDigest('f4')],
        ),
      ),
    ).rejects.toMatchObject({ code: '23001' });
  });

  it('(13) DELETE is refused by the database', async () => {
    const id = await seedOne();
    await expect(
      withClient(pool, (client) =>
        client.query(
          'DELETE FROM qf_jarvis.execution_replay_claim WHERE execution_intent_id = $1',
          [id],
        ),
      ),
    ).rejects.toMatchObject({ code: '23001' });
    expect(await rowCount()).toBe(1);
  });

  it('(14) the migration-issued runtime role holds SELECT and INSERT, and nothing else', async () => {
    const privileges = await withClient(pool, async (client) => {
      const result = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type
           FROM information_schema.table_privileges
          WHERE table_schema = 'qf_jarvis'
            AND table_name = 'execution_replay_claim'
            AND grantee = $1`,
        ['qf_jarvis_runtime'],
      );
      return result.rows.map((row) => row.privilege_type).sort();
    });
    expect([...new Set(privileges)]).toStrictEqual(['INSERT', 'SELECT']);

    // Not even a column-level UPDATE. Unlike 0009's slot pointer, nothing in this table ever moves.
    const columnUpdates = await withClient(pool, async (client) => {
      const result = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.column_privileges
          WHERE table_schema = 'qf_jarvis' AND table_name = 'execution_replay_claim'
            AND grantee = $1 AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')`,
        ['qf_jarvis_runtime'],
      );
      return result.rows.map((row) => row.column_name);
    });
    expect(columnUpdates).toStrictEqual([]);
  });

  it('(14) PUBLIC holds nothing at all', async () => {
    const publicPrivileges = await withClient(pool, async (client) => {
      const result = await client.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_schema = 'qf_jarvis' AND table_name = 'execution_replay_claim'
            AND grantee = 'PUBLIC'`,
      );
      return result.rows.map((row) => row.privilege_type);
    });
    expect(publicPrivileges).toStrictEqual([]);
  });

  it('(14) the runtime role can claim through the store using only its own grants', async () => {
    const rolePool = createDatabasePool(
      testDatabaseConfigAs('qf_jarvis_runtime', 'local-p0903-only', `${APP}-role`),
    );
    try {
      const roleStore = createPostgresExecutionReplayStore({ pool: rolePool });
      const claim = {
        executionIntentId: anIntentId(),
        idempotencyKey: anIdempotencyKey(),
        bodyDigestHex: aBodyDigest('0a'),
      };
      await expect(roleStore.claim(claim)).resolves.toBe('first-seen');
      await expect(roleStore.claim(claim)).resolves.toBe('exact-replay');
    } finally {
      await closeDatabasePool(rolePool);
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 15-16. Uncertainty fails closed. It never becomes first-seen.
// ---------------------------------------------------------------------------

describe('(15) corrupted durable state fails closed', () => {
  it('refuses when the durable uniqueness this store rests on is not actually there', async () => {
    // Recreate the exact failure that would otherwise be invisible: the independent unique on
    // idempotency_key is gone, so several rows share one key. The reconciliation read now sees more
    // rows than two constraints could ever produce, and the tempting answer -- "I cannot explain
    // this, so treat it as new" -- is the one that hands out a duplicate.
    const sharedKey = anIdempotencyKey();
    const intentA = anIntentId();
    try {
      await withClient(pool, async (client) => {
        await client.query(
          'ALTER TABLE qf_jarvis.execution_replay_claim DROP CONSTRAINT execution_replay_claim_idempotency_key_unique',
        );
        for (const id of [intentA, anIntentId(), anIntentId()]) {
          await client.query(
            'INSERT INTO qf_jarvis.execution_replay_claim (execution_intent_id, idempotency_key, body_digest_hex) VALUES ($1, $2, $3)',
            [id, sharedKey, aBodyDigest('1b')],
          );
        }
      });

      const outcome = store.claim({
        executionIntentId: intentA,
        idempotencyKey: sharedKey,
        bodyDigestHex: aBodyDigest('1b'),
      });
      await expect(outcome).rejects.toBeInstanceOf(PostgresExecutionReplayStoreError);
      await expect(outcome).rejects.toMatchObject({ code: 'repository-invariant' });
    } finally {
      await withClient(pool, async (client) => {
        await client.query('TRUNCATE qf_jarvis.execution_replay_claim');
        await client.query(
          'ALTER TABLE qf_jarvis.execution_replay_claim ADD CONSTRAINT execution_replay_claim_idempotency_key_unique UNIQUE (idempotency_key)',
        );
      });
    }
  }, 60_000);

  it('refuses when migration 0010 has not been applied', async () => {
    try {
      await withClient(pool, (client) =>
        client.query(
          'ALTER TABLE qf_jarvis.execution_replay_claim RENAME TO execution_replay_claim_hidden',
        ),
      );
      const outcome = store.claim({
        executionIntentId: anIntentId(),
        idempotencyKey: anIdempotencyKey(),
        bodyDigestHex: aBodyDigest('2c'),
      });
      await expect(outcome).rejects.toMatchObject({ code: 'schema-incompatible' });
    } finally {
      await withClient(pool, (client) =>
        client.query(
          'ALTER TABLE qf_jarvis.execution_replay_claim_hidden RENAME TO execution_replay_claim',
        ),
      );
    }
  }, 60_000);

  it('refuses a claim the columns could not hold, before any connection is taken', async () => {
    for (const bad of [
      {
        executionIntentId: 'not-a-uuid',
        idempotencyKey: anIdempotencyKey(),
        bodyDigestHex: aBodyDigest('3d'),
      },
      {
        executionIntentId: anIntentId(),
        idempotencyKey: 'short',
        bodyDigestHex: aBodyDigest('4e'),
      },
      {
        executionIntentId: anIntentId(),
        idempotencyKey: 'has spaces and @ signs+1',
        bodyDigestHex: aBodyDigest('5f'),
      },
      {
        executionIntentId: anIntentId(),
        idempotencyKey: anIdempotencyKey(),
        bodyDigestHex: 'ABCD'.repeat(16),
      },
      { executionIntentId: anIntentId(), idempotencyKey: anIdempotencyKey(), bodyDigestHex: 'ab' },
    ]) {
      await expect(store.claim(bad), JSON.stringify(bad).slice(0, 60)).rejects.toMatchObject({
        code: 'invalid-input',
      });
    }
    expect(await rowCount()).toBe(0);
  });
});

describe('(16) an unavailable store throws; it never guesses first-seen', () => {
  it('a closed pool throws a bounded error and leaks nothing', async () => {
    const dead = createTestPool(`${APP}-dead`);
    await closeDatabasePool(dead);
    const deadStore = createPostgresExecutionReplayStore({ pool: dead });

    const outcome = deadStore.claim({
      executionIntentId: anIntentId(),
      idempotencyKey: anIdempotencyKey(),
      bodyDigestHex: aBodyDigest('6a'),
    });
    await expect(outcome).rejects.toBeInstanceOf(PostgresExecutionReplayStoreError);

    let thrown: unknown;
    try {
      await outcome;
    } catch (error: unknown) {
      thrown = error;
    }
    const error = thrown as PostgresExecutionReplayStoreError;
    expect(error.code).toBe('database-unavailable');
    for (const forbidden of ['127.0.0.1', 'localhost', 'qf_jarvis', 'postgres', '@', 'INSERT']) {
      expect(error.message, forbidden).not.toContain(forbidden);
    }
  });

  it('the seam it feeds is the one the dispatch boundary already refuses on', async () => {
    // Not production wiring, and deliberately not a re-implementation of P09.02's signing fixtures:
    // those live under `execution-dispatch-runtime/src/tests/**`, are excluded from that package's
    // emitting build, and its containment lock asserts they are NOT exported. What is asserted here
    // is the seam itself — this store throws a plain `Error` subclass, and the closed reason set the
    // boundary converts such a throw into contains exactly the fail-closed reason.
    const dead = createTestPool(`${APP}-seam`);
    await closeDatabasePool(dead);
    const deadStore = createPostgresExecutionReplayStore({ pool: dead });

    await expect(
      deadStore.claim({
        executionIntentId: anIntentId(),
        idempotencyKey: anIdempotencyKey(),
        bodyDigestHex: aBodyDigest('7b'),
      }),
    ).rejects.toBeInstanceOf(Error);

    expect([...EXECUTION_DISPATCH_REASONS]).toContain('replay-guard-unavailable');
    // And there is no reason meaning "the store was unsure, so we proceeded".
    expect([...EXECUTION_DISPATCH_REASONS]).not.toContain('replay-guard-assumed-first-seen');
  });
});

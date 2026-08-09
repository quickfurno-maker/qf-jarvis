/**
 * RWC-P8 owner correction — durable writes are PROVED, and sessions are never leaked (ADR-0104).
 *
 * ### Why these cannot be integration tests
 *
 * Everything below is about what the coordinator does when PostgreSQL answers in a way a healthy
 * server never would: a guarded `UPDATE` reporting zero rows, an `INSERT` creating nothing, an
 * advisory unlock returning `false`. Those answers are exactly the ones that would let a false
 * success escape, and they are unreachable against a correct server without corrupting it.
 *
 * ### The one that matters most
 *
 * `complete()` resolving on ZERO affected rows would let the service return a Riya result and a
 * Core-authorized body for a turn whose claim was never proved to reach `COMPLETED`. A caller would
 * hold a reply while the ledger still said `PROCESSING`, and a retry of that message would be
 * classified as recoverable rather than spent. A resolved query is not evidence that anything moved.
 */
import { describe, expect, it } from 'vitest';

import type {
  RiyaTurnCoordinatorBeginInput,
  RiyaTurnLease,
} from '@qf-jarvis/riya-web-conversation-service';

import { createPostgresRiyaTurnCoordinator } from '../index.js';
// The INTERNAL digest helpers, imported directly. Recomputing the preimages in this spec would make
// it assert that the test author's copy matches production's, which is not the property under test --
// and the RWC-P8 idempotency specs already pin the preimages themselves.
import { sourceTurnDigest, turnIdentityDigest } from '../internal/identity.js';
import { scriptedPool, sqlError, type ScriptedPoolOptions } from './fakes/scripted-pool.js';

const INPUT: RiyaTurnCoordinatorBeginInput = Object.freeze({
  tenantId: 'tenant.a',
  conversationId: 'conv.1',
  messageId: 'msg.1',
  channel: 'WEB',
  channelTurnRef: 'src.msg.1',
  receivedAt: '2026-08-01T09:00:00Z',
  dataClass: 'HOSTED_ALLOWED',
});

/** The digests the coordinator itself derives for `INPUT`. */
const SOURCE_DIGEST = sourceTurnDigest({
  channel: INPUT.channel,
  channelTurnRef: INPUT.channelTurnRef,
});
const IDENTITY_DIGEST = turnIdentityDigest({
  channel: INPUT.channel,
  tenantId: INPUT.tenantId,
  conversationId: INPUT.conversationId,
  messageId: INPUT.messageId,
  receivedAt: INPUT.receivedAt,
  sourceTurnDigest: SOURCE_DIGEST,
  dataClass: INPUT.dataClass,
});

async function acquire(over: ScriptedPoolOptions = {}): Promise<{
  readonly lease: RiyaTurnLease;
  readonly pool: ReturnType<typeof scriptedPool>;
}> {
  const pool = scriptedPool(over);
  const begun = await createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT);
  if (begun.outcome !== 'ACQUIRED') {
    throw new Error(`expected ACQUIRED, got ${begun.outcome}`);
  }
  return { lease: begun.lease, pool };
}

const codeOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error: unknown) {
    return (error as { code?: string }).code ?? 'no-code';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// Defect 1 — every durable write must move EXACTLY ONE row.
// ---------------------------------------------------------------------------

describe('startProcessing requires its INSERT to create exactly one claim', () => {
  it('accepts rowCount 1', async () => {
    const { lease } = await acquire({ insert: { rowCount: 1 } });
    await expect(lease.startProcessing()).resolves.toBeUndefined();
  });

  it('REFUSES rowCount 0, and the lease can never be finalized afterwards', async () => {
    // An INSERT with no `ON CONFLICT` that created no row is not a claim. Permitting the runtime here
    // would run a real model turn attributed to a claim that does not exist.
    const { lease, pool } = await acquire({ insert: { rowCount: 0 } });
    expect(await codeOf(() => lease.startProcessing())).toBe('repository-invariant');
    // The lock is released and the lease is spent -- no second attempt, no finalization.
    expect(pool.healthyReleases() + pool.destroyedReleases()).toBe(1);
    expect(await codeOf(() => lease.complete())).toBe('invalid-input');
  });

  it('REFUSES a null or multi-row count -- an unknown count is not a proof', async () => {
    for (const rowCount of [null, 2]) {
      const { lease } = await acquire({ insert: { rowCount } });
      expect(await codeOf(() => lease.startProcessing()), String(rowCount)).toBe(
        'repository-invariant',
      );
    }
  });

  it('performs no retry: exactly one INSERT statement is issued', async () => {
    const { lease, pool } = await acquire({ insert: { rowCount: 0 } });
    await codeOf(() => lease.startProcessing());
    expect(pool.statements().filter((sql) => sql.includes('INSERT INTO'))).toHaveLength(1);
  });
});

describe('complete requires its guarded UPDATE to move exactly one row', () => {
  it('accepts rowCount 1', async () => {
    const { lease } = await acquire();
    await lease.startProcessing();
    await expect(lease.complete()).resolves.toBeUndefined();
  });

  it('REFUSES rowCount 0 — the single most consequential refusal in the package', async () => {
    // Reporting success here would let the service hand a client a reply for a turn the ledger still
    // records as in flight.
    const { lease } = await acquire({ finalize: { rowCount: 0 } });
    await lease.startProcessing();
    expect(await codeOf(() => lease.complete())).toBe('repository-invariant');
  });

  it('REFUSES a null count', async () => {
    const { lease } = await acquire({ finalize: { rowCount: null } });
    await lease.startProcessing();
    expect(await codeOf(() => lease.complete())).toBe('repository-invariant');
  });

  it('issues exactly one UPDATE, and releases the lock even on refusal', async () => {
    const { lease, pool } = await acquire({ finalize: { rowCount: 0 } });
    await lease.startProcessing();
    await codeOf(() => lease.complete());
    expect(pool.statements().filter((sql) => sql.includes('UPDATE'))).toHaveLength(1);
    expect(pool.statements().filter((sql) => sql.includes('pg_advisory_unlock'))).toHaveLength(1);
  });
});

describe('indeterminate requires the same proof', () => {
  it('accepts rowCount 1 and REFUSES rowCount 0', async () => {
    const ok = await acquire();
    await ok.lease.startProcessing();
    await expect(ok.lease.indeterminate()).resolves.toBeUndefined();

    const bad = await acquire({ finalize: { rowCount: 0 } });
    await bad.lease.startProcessing();
    expect(await codeOf(() => bad.lease.indeterminate())).toBe('repository-invariant');
  });
});

describe('orphan reconciliation requires the same proof', () => {
  /** A row that IS this message, left in flight by a processor that is no longer holding the lock. */
  const orphan = (over: Record<string, unknown> = {}) => ({
    message_id: INPUT.messageId,
    channel: INPUT.channel,
    source_turn_digest: SOURCE_DIGEST,
    turn_identity_digest: IDENTITY_DIGEST,
    claim_state: 'PROCESSING',
    ...over,
  });

  it('marks an orphan INDETERMINATE when the guarded UPDATE moves exactly one row', async () => {
    const pool = scriptedPool({ select: { rows: [orphan()] }, finalize: { rowCount: 1 } });
    const begun = await createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT);
    expect(begun.outcome).toBe('INDETERMINATE');
    expect(pool.statements().filter((sql) => sql.includes('UPDATE'))).toHaveLength(1);
  });

  it('REFUSES a zero-row reconciliation rather than reporting INDETERMINATE', async () => {
    // The row this call just READ as PROCESSING did not move. Reporting INDETERMINATE would assert a
    // durable fact nobody observed -- and INDETERMINATE is TERMINAL, so the assertion would be
    // permanent and would spend a message that may still be live.
    const pool = scriptedPool({ select: { rows: [orphan()] }, finalize: { rowCount: 0 } });
    expect(
      await codeOf(() => createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT)),
    ).toBe('repository-invariant');
    // No second update, no re-read, no loop.
    expect(pool.statements().filter((sql) => sql.includes('UPDATE'))).toHaveLength(1);
    expect(pool.statements().filter((sql) => sql.includes('SELECT message_id'))).toHaveLength(1);
    // And the lock is still released.
    expect(pool.healthyReleases() + pool.destroyedReleases()).toBe(1);
  });

  it('REFUSES a null count for the same reason', async () => {
    const pool = scriptedPool({ select: { rows: [orphan()] }, finalize: { rowCount: null } });
    expect(
      await codeOf(() => createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT)),
    ).toBe('repository-invariant');
  });

  it('a COMPLETED or INDETERMINATE row is classified without any write at all', async () => {
    for (const [state, outcome] of [
      ['COMPLETED', 'REPLAYED'],
      ['INDETERMINATE', 'INDETERMINATE'],
    ] as const) {
      const pool = scriptedPool({ select: { rows: [orphan({ claim_state: state })] } });
      const begun = await createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT);
      expect(begun.outcome, state).toBe(outcome);
      expect(pool.statements().filter((sql) => sql.includes('UPDATE'))).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Unlock safety — the session is destroyed unless the unlock is provably clean.
// ---------------------------------------------------------------------------

describe('an unlock that is not provably clean DESTROYS the session', () => {
  it('unlock true hands the client back HEALTHY', async () => {
    const { lease, pool } = await acquire({ unlock: { rows: [{ released: true }] } });
    await lease.startProcessing();
    await lease.complete();
    expect(pool.healthyReleases()).toBe(1);
    expect(pool.destroyedReleases()).toBe(0);
  });

  it('unlock FALSE destroys it', async () => {
    // The session did not hold the lock it thinks it did. Returning it to the pool could hand an
    // unrelated conversation a connection that still holds a lock nothing will ever release.
    const { lease, pool } = await acquire({ unlock: { rows: [{ released: false }] } });
    await lease.startProcessing();
    await lease.complete();
    expect(pool.destroyedReleases()).toBe(1);
    expect(pool.healthyReleases()).toBe(0);
  });

  it('an unlock that THROWS destroys it', async () => {
    const { lease, pool } = await acquire({ unlock: { throws: sqlError('08006') } });
    await lease.startProcessing();
    await lease.complete();
    expect(pool.destroyedReleases()).toBe(1);
    expect(pool.healthyReleases()).toBe(0);
  });

  it('an unlock answering with no row at all destroys it', async () => {
    const { lease, pool } = await acquire({ unlock: { rows: [] } });
    await lease.startProcessing();
    await lease.complete();
    expect(pool.destroyedReleases()).toBe(1);
  });

  it('every exit path releases exactly once — BUSY, replay, refusal and unstarted alike', async () => {
    const busy = scriptedPool({ lock: { rows: [{ acquired: false }] } });
    expect(
      (await createPostgresRiyaTurnCoordinator({ pool: busy.pool }).begin(INPUT)).outcome,
    ).toBe('BUSY');
    // BUSY holds no lock, so the session goes back healthy and no unlock is issued.
    expect(busy.healthyReleases()).toBe(1);
    expect(busy.statements().filter((sql) => sql.includes('pg_advisory_unlock'))).toHaveLength(0);

    const unstarted = await acquire();
    await unstarted.lease.releaseUnstarted();
    expect(unstarted.pool.healthyReleases()).toBe(1);
  });
});

describe('a failing lock query discards the session and reads nothing', () => {
  it('destroys the client, and never reaches the candidate read', async () => {
    const pool = scriptedPool({ lock: { throws: sqlError('08006') } });
    expect(
      await codeOf(() => createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT)),
    ).toBe('coordinator-unavailable');
    // The failure may have been mid-statement, so the session cannot be assumed clean.
    expect(pool.destroyedReleases()).toBe(1);
    expect(pool.healthyReleases()).toBe(0);
    expect(pool.statements().filter((sql) => sql.includes('SELECT message_id'))).toHaveLength(0);
    expect(pool.statements().filter((sql) => sql.includes('INSERT INTO'))).toHaveLength(0);
  });

  it('a failing connect never reaches a statement', async () => {
    const pool = scriptedPool({ connectRejects: true });
    expect(
      await codeOf(() => createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT)),
    ).toBe('coordinator-unavailable');
    expect(pool.statements()).toStrictEqual([]);
  });
});

describe('no raw database detail escapes on any of these paths', () => {
  it('every bounded error carries a fixed, content-free message', async () => {
    const messages: string[] = [];
    const capture = async (run: () => Promise<unknown>): Promise<void> => {
      try {
        await run();
      } catch (error: unknown) {
        messages.push((error as Error).message);
      }
    };

    await capture(() =>
      createPostgresRiyaTurnCoordinator({
        pool: scriptedPool({ connectRejects: true }).pool,
      }).begin(INPUT),
    );
    await capture(() =>
      createPostgresRiyaTurnCoordinator({
        pool: scriptedPool({ lock: { throws: sqlError('42P01') } }).pool,
      }).begin(INPUT),
    );
    const zeroInsert = await acquire({ insert: { rowCount: 0 } });
    await capture(() => zeroInsert.lease.startProcessing());
    const zeroFinalize = await acquire({ finalize: { rowCount: 0 } });
    await zeroFinalize.lease.startProcessing();
    await capture(() => zeroFinalize.lease.complete());

    expect(messages).toHaveLength(4);
    for (const message of messages) {
      for (const forbidden of [
        '10.0.0.7',
        'hunter2',
        'token=',
        'password',
        'riya_logical_turn_claims',
        'qf_jarvis',
        'INSERT',
        'UPDATE',
        'SELECT',
        'ECONNREFUSED',
        'msg.1',
        'conv.1',
        'tenant.a',
      ]) {
        expect(message, forbidden).not.toContain(forbidden);
      }
    }
  });
});

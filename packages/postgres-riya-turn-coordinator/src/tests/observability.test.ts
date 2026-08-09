/**
 * RWC-P9 — the coordinator reports contention, replay and destroyed sessions, and nothing else
 * (ADR-0105).
 *
 * ### Why the fake pool rather than the integration suite
 *
 * Half of what an operator most needs counted is unreachable against a healthy PostgreSQL: a guarded
 * `UPDATE` reporting zero rows, an `INSERT` creating nothing, an advisory unlock answering `false`.
 * Those are exactly the answers that would let a FALSE SUCCESS into a dashboard, and the strongest
 * assertions below are the negative ones — that a zero-row write emits `coordinator-failed` and never
 * `claim-completed`.
 *
 * ### The digest exclusion
 *
 * The coordinator derives a source digest and an identity digest from a caller's channel reference. A
 * stream of those is a stream of correlatable turn fingerprints, which is the same disclosure the
 * ledger deliberately avoided, wearing a hash. No event carries one, and a spec below scans for any
 * long hex run to make that mechanical rather than a matter of review.
 */
import { describe, expect, it } from 'vitest';

import type {
  RiyaTurnCoordinatorBeginInput,
  RiyaTurnLease,
} from '@qf-jarvis/riya-web-conversation-service';

import { createPostgresRiyaTurnCoordinator } from '../index.js';
import {
  NOOP_POSTGRES_RIYA_TURN_COORDINATOR_OBSERVABILITY,
  POSTGRES_RIYA_TURN_COORDINATOR_DISCARD_REASONS,
  POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES,
} from '../contracts/observability.js';
import type {
  PostgresRiyaTurnCoordinatorEvent,
  PostgresRiyaTurnCoordinatorObservabilityHook,
} from '../contracts/observability.js';
import { sourceTurnDigest, turnIdentityDigest } from '../internal/identity.js';
import { scriptedPool, sqlError, type ScriptedPoolOptions } from './fakes/scripted-pool.js';

const INPUT: RiyaTurnCoordinatorBeginInput = Object.freeze({
  tenantId: 'SENT-TENANT-3f9a',
  conversationId: 'SENT-CONV-8c11',
  messageId: 'SENT-MSG-42be',
  channel: 'WEB',
  channelTurnRef: 'SENT-SRC-77dd',
  receivedAt: '2026-08-01T09:00:00Z',
  dataClass: 'HOSTED_ALLOWED',
  subjectRef: 'SENT-SUBJ-91ff',
});

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
  // `INPUT` declares one, and the digest preimage is only correct if this spec passes the same value
  // the coordinator will. Reading it back through a default would silently diverge if `INPUT` ever
  // dropped it, so the fallback is a value no test input uses.
  subjectRef: INPUT.subjectRef ?? 'SENT-SUBJ-91ff',
});

/** A candidate row that matches `INPUT` exactly, in whichever claim state a spec needs. */
const matchingRow = (claimState: 'PROCESSING' | 'COMPLETED' | 'INDETERMINATE') => ({
  message_id: INPUT.messageId,
  channel: INPUT.channel,
  source_turn_digest: SOURCE_DIGEST,
  turn_identity_digest: IDENTITY_DIGEST,
  claim_state: claimState,
});

/** Every key any coordinator event is permitted to carry. */
const ALLOWED_KEYS: readonly string[] = [
  'channel',
  'claimState',
  'discardReason',
  'errorCode',
  'type',
];

interface Recorder extends PostgresRiyaTurnCoordinatorObservabilityHook {
  events(): readonly PostgresRiyaTurnCoordinatorEvent[];
  types(): readonly string[];
}

function recorder(): Recorder {
  const events: PostgresRiyaTurnCoordinatorEvent[] = [];
  return {
    record: (event) => {
      events.push(event);
    },
    events: () => events,
    types: () => events.map((event) => event.type),
  };
}

const hostileHook: PostgresRiyaTurnCoordinatorObservabilityHook = {
  record: () => {
    throw new Error('metrics sink at 10.0.0.9 — token=abc123 is down');
  },
};

function coordinatorWith(
  over: ScriptedPoolOptions,
  observability: PostgresRiyaTurnCoordinatorObservabilityHook,
) {
  const pool = scriptedPool(over);
  return {
    pool,
    coordinator: createPostgresRiyaTurnCoordinator({ pool: pool.pool, observability }),
  };
}

const outcomeOf = async (
  over: ScriptedPoolOptions,
  hook: PostgresRiyaTurnCoordinatorObservabilityHook,
): Promise<string> => {
  const { coordinator } = coordinatorWith(over, hook);
  try {
    return (await coordinator.begin(INPUT)).outcome;
  } catch (error: unknown) {
    return `threw:${(error as { code?: string }).code ?? 'unknown'}`;
  }
};

async function acquire(
  over: ScriptedPoolOptions,
  hook: PostgresRiyaTurnCoordinatorObservabilityHook,
): Promise<{ readonly lease: RiyaTurnLease; readonly pool: ReturnType<typeof scriptedPool> }> {
  const { pool, coordinator } = coordinatorWith(over, hook);
  const begun = await coordinator.begin(INPUT);
  if (begun.outcome !== 'ACQUIRED') {
    throw new Error(`expected ACQUIRED, got ${begun.outcome}`);
  }
  return { lease: begun.lease, pool };
}

// ---------------------------------------------------------------------------
// 1. Closed vocabularies.
// ---------------------------------------------------------------------------

describe('the coordinator vocabulary is closed and frozen', () => {
  it('is exactly nine event types and four discard reasons', () => {
    expect([...POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES]).toStrictEqual([
      'lock-acquired',
      'lock-busy',
      'claim-replayed',
      'claim-conflict',
      'claim-indeterminate',
      'claim-processing-started',
      'claim-completed',
      'session-discarded',
      'coordinator-failed',
    ]);
    expect([...POSTGRES_RIYA_TURN_COORDINATOR_DISCARD_REASONS]).toStrictEqual([
      'LOCK_QUERY_UNCERTAIN',
      'UNLOCK_FALSE',
      'UNLOCK_ERROR',
      'UNLOCK_MALFORMED',
    ]);
    expect(Object.isFrozen(POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES)).toBe(true);
  });

  it('absent configuration means silence, not a hidden logger', async () => {
    expect(Object.isFrozen(NOOP_POSTGRES_RIYA_TURN_COORDINATOR_OBSERVABILITY)).toBe(true);
    NOOP_POSTGRES_RIYA_TURN_COORDINATOR_OBSERVABILITY.record({ type: 'lock-acquired' });
    const pool = scriptedPool();
    const begun = await createPostgresRiyaTurnCoordinator({ pool: pool.pool }).begin(INPUT);
    expect(begun.outcome).toBe('ACQUIRED');
  });
});

// ---------------------------------------------------------------------------
// 2. Contention and classification.
// ---------------------------------------------------------------------------

describe('every classification is counted exactly once', () => {
  it('an acquired lock', async () => {
    const hook = recorder();
    await acquire({}, hook);
    expect(hook.types()).toStrictEqual(['lock-acquired']);
    expect(hook.events()[0]).toStrictEqual({ type: 'lock-acquired', channel: 'WEB' });
  });

  it('a busy conversation — and no ledger read follows it', async () => {
    const hook = recorder();
    const { pool, coordinator } = coordinatorWith({ lock: { rows: [{ acquired: false }] } }, hook);
    expect((await coordinator.begin(INPUT)).outcome).toBe('BUSY');
    expect(hook.types()).toStrictEqual(['lock-busy']);
    // The event is honest about how cheap a BUSY is: one statement, and the session goes back healthy.
    expect(pool.statements().length).toBe(1);
    expect(pool.healthyReleases()).toBe(1);
    expect(pool.destroyedReleases()).toBe(0);
  });

  it('a replayed claim, with the durable state that justified it', async () => {
    const hook = recorder();
    expect(await outcomeOf({ select: { rows: [matchingRow('COMPLETED')] } }, hook)).toBe(
      'REPLAYED',
    );
    expect(hook.types()).toStrictEqual(['lock-acquired', 'claim-replayed']);
    expect(hook.events()[1]?.claimState).toBe('COMPLETED');
  });

  it('an already-indeterminate claim', async () => {
    const hook = recorder();
    expect(await outcomeOf({ select: { rows: [matchingRow('INDETERMINATE')] } }, hook)).toBe(
      'INDETERMINATE',
    );
    expect(hook.types()).toStrictEqual(['lock-acquired', 'claim-indeterminate']);
  });

  it('a conflicting source reference under a different message id', async () => {
    const hook = recorder();
    const row = { ...matchingRow('COMPLETED'), message_id: 'SENT-MSG-OTHER' };
    expect(await outcomeOf({ select: { rows: [row] } }, hook)).toBe('CONFLICT');
    expect(hook.types()).toStrictEqual(['lock-acquired', 'claim-conflict']);
  });

  it('a conflicting identity under the same message id', async () => {
    const hook = recorder();
    const row = { ...matchingRow('COMPLETED'), turn_identity_digest: 'a'.repeat(64) };
    expect(await outcomeOf({ select: { rows: [row] } }, hook)).toBe('CONFLICT');
    expect(hook.types()).toStrictEqual(['lock-acquired', 'claim-conflict']);
  });

  it('an orphan PROVED moved to indeterminate', async () => {
    const hook = recorder();
    expect(
      await outcomeOf(
        { select: { rows: [matchingRow('PROCESSING')] }, finalize: { rowCount: 1 } },
        hook,
      ),
    ).toBe('INDETERMINATE');
    expect(hook.types()).toStrictEqual(['lock-acquired', 'claim-indeterminate']);
  });

  it('an orphan whose reconciliation did NOT move a row is a FAILURE, never an indeterminate', async () => {
    // The distinction is the whole point. An operator counting `claim-indeterminate` is counting
    // messages that can never be re-run; a miscount in that column is a miscount of duplicate risk.
    // The transition was not proved, so it is not reported.
    const hook = recorder();
    expect(
      await outcomeOf(
        { select: { rows: [matchingRow('PROCESSING')] }, finalize: { rowCount: 0 } },
        hook,
      ),
    ).toBe('threw:repository-invariant');
    expect(hook.types()).toStrictEqual(['lock-acquired', 'coordinator-failed']);
    expect(hook.events()[1]?.errorCode).toBe('repository-invariant');
    expect(hook.types()).not.toContain('claim-indeterminate');
  });

  it('more candidate rows than can legitimately exist', async () => {
    const hook = recorder();
    const rows = [matchingRow('COMPLETED'), matchingRow('COMPLETED'), matchingRow('COMPLETED')];
    expect(await outcomeOf({ select: { rows } }, hook)).toBe('threw:repository-invariant');
    expect(hook.types()).toStrictEqual(['lock-acquired', 'coordinator-failed']);
  });
});

// ---------------------------------------------------------------------------
// 3. Durable writes are only reported once proved.
// ---------------------------------------------------------------------------

describe('a write is only counted once the ledger has proved it', () => {
  it('processing-started after exactly one inserted row', async () => {
    const hook = recorder();
    const { lease } = await acquire({}, hook);
    await lease.startProcessing();
    expect(hook.types()).toStrictEqual(['lock-acquired', 'claim-processing-started']);
    expect(hook.events()[1]?.claimState).toBe('PROCESSING');
  });

  it('an INSERT that created nothing is a failure, never a started claim', async () => {
    const hook = recorder();
    const { lease, pool } = await acquire({ insert: { rowCount: 0 } }, hook);
    await expect(lease.startProcessing()).rejects.toMatchObject({ code: 'repository-invariant' });
    expect(hook.types()).toStrictEqual(['lock-acquired', 'coordinator-failed']);
    expect(hook.types()).not.toContain('claim-processing-started');
    expect(pool.healthyReleases()).toBe(1);
  });

  it('completed after exactly one updated row', async () => {
    const hook = recorder();
    const { lease } = await acquire({}, hook);
    await lease.startProcessing();
    await lease.complete();
    expect(hook.types()).toStrictEqual([
      'lock-acquired',
      'claim-processing-started',
      'claim-completed',
    ]);
    expect(hook.events()[2]?.claimState).toBe('COMPLETED');
  });

  it('a zero-row completion is a failure, never a completion', async () => {
    // The most consequential negative in the package. A `claim-completed` on a zero-row UPDATE would
    // put in a dashboard exactly the lie the row-count proof exists to refuse: a turn shown as
    // finished while the ledger still records it in flight.
    const hook = recorder();
    const { lease } = await acquire({ finalize: { rowCount: 0 } }, hook);
    await lease.startProcessing();
    await expect(lease.complete()).rejects.toMatchObject({ code: 'repository-invariant' });
    expect(hook.types()).toStrictEqual([
      'lock-acquired',
      'claim-processing-started',
      'coordinator-failed',
    ]);
    expect(hook.types()).not.toContain('claim-completed');
  });

  it('a zero-row indeterminate finalization is a failure too', async () => {
    const hook = recorder();
    const { lease } = await acquire({ finalize: { rowCount: 0 } }, hook);
    await lease.startProcessing();
    await expect(lease.indeterminate()).rejects.toMatchObject({ code: 'repository-invariant' });
    expect(hook.types().filter((type) => type === 'claim-indeterminate')).toStrictEqual([]);
  });

  it('an indeterminate finalization that moved a row IS counted', async () => {
    const hook = recorder();
    const { lease } = await acquire({}, hook);
    await lease.startProcessing();
    await lease.indeterminate();
    expect(hook.types()).toStrictEqual([
      'lock-acquired',
      'claim-processing-started',
      'claim-indeterminate',
    ]);
  });

  it('a pre-start release writes nothing and reports nothing', async () => {
    const hook = recorder();
    const { lease } = await acquire({}, hook);
    await lease.releaseUnstarted();
    expect(hook.types()).toStrictEqual(['lock-acquired']);
  });
});

// ---------------------------------------------------------------------------
// 4. Destroyed sessions, with the reason.
// ---------------------------------------------------------------------------

describe('every destroyed session is counted with the reason it was destroyed', () => {
  it('a lock statement that failed leaves an untrustworthy session', async () => {
    const hook = recorder();
    expect(await outcomeOf({ lock: { throws: sqlError('08006') } }, hook)).toBe(
      'threw:coordinator-unavailable',
    );
    expect(hook.types()).toStrictEqual(['session-discarded', 'coordinator-failed']);
    expect(hook.events()[0]?.discardReason).toBe('LOCK_QUERY_UNCERTAIN');
  });

  it('an unlock that answered false', async () => {
    const hook = recorder();
    const { lease, pool } = await acquire({ unlock: { rows: [{ released: false }] } }, hook);
    await lease.releaseUnstarted();
    expect(hook.events().find((event) => event.type === 'session-discarded')?.discardReason).toBe(
      'UNLOCK_FALSE',
    );
    expect(pool.destroyedReleases()).toBe(1);
  });

  it('an unlock that threw', async () => {
    const hook = recorder();
    const { lease, pool } = await acquire({ unlock: { throws: sqlError('57P01') } }, hook);
    await lease.releaseUnstarted();
    expect(hook.events().find((event) => event.type === 'session-discarded')?.discardReason).toBe(
      'UNLOCK_ERROR',
    );
    expect(pool.destroyedReleases()).toBe(1);
  });

  it('an unlock that answered with no usable row', async () => {
    // A different operational story from `false`: one says the lock was not held, the other says the
    // answer did not parse. Collapsing them would send an operator looking in the wrong place.
    const hook = recorder();
    const { lease, pool } = await acquire({ unlock: { rows: [] } }, hook);
    await lease.releaseUnstarted();
    expect(hook.events().find((event) => event.type === 'session-discarded')?.discardReason).toBe(
      'UNLOCK_MALFORMED',
    );
    expect(pool.destroyedReleases()).toBe(1);
  });

  it('a clean unlock reports NO discard', async () => {
    const hook = recorder();
    const { lease, pool } = await acquire({}, hook);
    await lease.releaseUnstarted();
    expect(hook.types()).not.toContain('session-discarded');
    expect(pool.healthyReleases()).toBe(1);
    expect(pool.destroyedReleases()).toBe(0);
  });

  it('a connection that could not be opened is a bounded failure with no session to discard', async () => {
    const hook = recorder();
    expect(await outcomeOf({ connectRejects: true }, hook)).toBe('threw:coordinator-unavailable');
    expect(hook.types()).toStrictEqual(['coordinator-failed']);
  });
});

// ---------------------------------------------------------------------------
// 5. Adversarial content leakage.
// ---------------------------------------------------------------------------

describe('no identifier, digest, statement or host reaches an event', () => {
  it('drives every path with marked input and finds nothing', async () => {
    const hook = recorder();

    await acquire({}, hook);
    await outcomeOf({ lock: { rows: [{ acquired: false }] } }, hook);
    await outcomeOf({ select: { rows: [matchingRow('COMPLETED')] } }, hook);
    await outcomeOf({ select: { rows: [matchingRow('INDETERMINATE')] } }, hook);
    await outcomeOf(
      { select: { rows: [{ ...matchingRow('COMPLETED'), message_id: 'SENT-MSG-OTHER' }] } },
      hook,
    );
    await outcomeOf(
      { select: { rows: [matchingRow('PROCESSING')] }, finalize: { rowCount: 1 } },
      hook,
    );
    await outcomeOf({ select: { throws: sqlError('42P01') } }, hook);
    await outcomeOf({ lock: { throws: sqlError('08006') } }, hook);
    await outcomeOf({ connectRejects: true }, hook);

    const started = await acquire({ finalize: { rowCount: 0 } }, hook);
    await started.lease.startProcessing();
    await started.lease.complete().catch(() => undefined);

    const clean = await acquire({ unlock: { rows: [{ released: false }] } }, hook);
    await clean.lease.releaseUnstarted();

    expect(hook.events().length).toBeGreaterThan(14);
    const serialized = JSON.stringify(hook.events());
    for (const sentinel of [
      'SENT-TENANT-3f9a',
      'SENT-CONV-8c11',
      'SENT-MSG-42be',
      'SENT-SRC-77dd',
      'SENT-SUBJ-91ff',
      'SENT-MSG-OTHER',
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    // The digests specifically. A stream of these is a stream of correlatable turn fingerprints.
    expect(serialized).not.toContain(SOURCE_DIGEST);
    expect(serialized).not.toContain(IDENTITY_DIGEST);
    expect(serialized).not.toMatch(/[0-9a-f]{16,}/i);
    // And nothing about the database itself.
    expect(serialized).not.toContain('riya_logical_turn_claims');
    expect(serialized).not.toContain('10.0.0.7');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('token=abc123');
    expect(serialized.toUpperCase()).not.toContain('SELECT');
    expect(serialized.toUpperCase()).not.toContain('INSERT');
    expect(serialized.toUpperCase()).not.toContain('PG_');
  });

  it('every event carries only approved keys and a known type', async () => {
    const hook = recorder();
    const { lease } = await acquire({}, hook);
    await lease.startProcessing();
    await lease.complete();
    await outcomeOf({ lock: { rows: [{ acquired: false }] } }, hook);
    await outcomeOf({ connectRejects: true }, hook);

    for (const event of hook.events()) {
      expect(POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES).toContain(event.type);
      for (const key of Object.keys(event)) {
        expect(ALLOWED_KEYS).toContain(key);
      }
      expect(Object.isFrozen(event)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Observability is never an authority.
// ---------------------------------------------------------------------------

describe('a hook that throws on every event changes nothing', () => {
  it('a full successful lease is byte-for-byte the same set of statements', async () => {
    const quiet = scriptedPool();
    const hostile = scriptedPool();
    for (const [pool, hook] of [
      [quiet, recorder()],
      [hostile, hostileHook],
    ] as const) {
      const begun = await createPostgresRiyaTurnCoordinator({
        pool: pool.pool,
        observability: hook,
      }).begin(INPUT);
      if (begun.outcome !== 'ACQUIRED') {
        throw new Error('expected ACQUIRED');
      }
      await begun.lease.startProcessing();
      await begun.lease.complete();
    }
    expect(hostile.statements()).toStrictEqual(quiet.statements());
    expect(hostile.healthyReleases()).toBe(quiet.healthyReleases());
    expect(hostile.destroyedReleases()).toBe(quiet.destroyedReleases());
  });

  it.each([
    ['a busy conversation', { lock: { rows: [{ acquired: false }] } }, 'BUSY'],
    ['a replay', { select: { rows: [matchingRow('COMPLETED')] } }, 'REPLAYED'],
    ['a failed lock', { lock: { throws: sqlError('08006') } }, 'threw:coordinator-unavailable'],
    ['a refused connection', { connectRejects: true }, 'threw:coordinator-unavailable'],
    [
      'an unproved reconciliation',
      { select: { rows: [matchingRow('PROCESSING')] }, finalize: { rowCount: 0 } },
      'threw:repository-invariant',
    ],
  ] as readonly (readonly [string, ScriptedPoolOptions, string])[])(
    '%s settles identically with and without a hostile hook',
    async (_name, options, expected) => {
      expect(await outcomeOf(options, recorder())).toBe(expected);
      expect(await outcomeOf(options, hostileHook)).toBe(expected);
    },
  );

  it('a hostile hook does not change whether a session is DESTROYED', async () => {
    // The `session-discarded` event fires next to the decision that destroys the connection. A hook
    // throwing there must not turn a destroyed session into a returned one -- a leaked session lock on
    // a reused connection would block an unrelated conversation for the life of the pool.
    const pool = scriptedPool({ unlock: { rows: [{ released: false }] } });
    const begun = await createPostgresRiyaTurnCoordinator({
      pool: pool.pool,
      observability: hostileHook,
    }).begin(INPUT);
    if (begun.outcome !== 'ACQUIRED') {
      throw new Error('expected ACQUIRED');
    }
    await begun.lease.releaseUnstarted();
    expect(pool.destroyedReleases()).toBe(1);
    expect(pool.healthyReleases()).toBe(0);
  });
});

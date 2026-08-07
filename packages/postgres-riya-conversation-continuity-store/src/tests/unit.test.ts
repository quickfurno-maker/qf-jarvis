/**
 * Database-free proofs (RWC-P2B, ADR-0095).
 *
 * Everything here runs without PostgreSQL, and that is the point of the split: these prove the
 * refusals that must happen BEFORE a connection is taken, and the error contract a caller reads.
 * The durable behaviour lives in `continuity-store.integration.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES,
  PostgresRiyaContinuityStoreError,
  createPostgresRiyaConversationContinuityStore,
} from '../index.js';
import { fullyDiscoveredState, initialState, summaryReadyState } from './fixtures.js';

/**
 * A pool that FAILS the moment anything touches it.
 *
 * This is how "rejected before the database" is actually proved rather than asserted: if any of the
 * calls below reached a connection, the test would see `connect() must not be called` instead of the
 * bounded `invalid-input`.
 */
function forbiddenPool(): { connect(): Promise<never> } {
  return {
    connect(): Promise<never> {
      return Promise.reject(new Error('connect() must not be called for an invalid request'));
    },
  };
}

function store(): ReturnType<typeof createPostgresRiyaConversationContinuityStore> {
  return createPostgresRiyaConversationContinuityStore({
    pool: forbiddenPool() as never,
  });
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof PostgresRiyaContinuityStoreError) {
      return error.code;
    }
    return `unexpected:${String(error)}`;
  }
  return 'no-error';
}

describe('the error contract', () => {
  it('(1) is exactly four bounded codes', () => {
    expect(POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES).toStrictEqual([
      'invalid-input',
      'repository-invariant',
      'store-unavailable',
      'schema-incompatible',
    ]);
  });

  it('(2) is frozen, so a caller cannot widen the vocabulary it is checked against', () => {
    expect(Object.isFrozen(POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES)).toBe(true);
  });

  it('(3) carries a fixed, content-free message per code', () => {
    for (const code of POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES) {
      const error = new PostgresRiyaContinuityStoreError(code);
      expect(error.code).toBe(code);
      expect(error.name).toBe('PostgresRiyaContinuityStoreError');
      expect(error.message.length).toBeGreaterThan(0);
      // No identifier, no SQL, no host, no driver text.
      for (const forbidden of ['SELECT', 'INSERT', 'UPDATE', 'qf_jarvis', 'postgres', '@', '://']) {
        expect(error.message, `${code} leaks ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('(4) the message depends only on the code, never on an input', () => {
    expect(new PostgresRiyaContinuityStoreError('invalid-input').message).toBe(
      new PostgresRiyaContinuityStoreError('invalid-input').message,
    );
  });
});

describe('construction', () => {
  it('(5) refuses a missing, null or pool-shaped-but-not-a-pool config', () => {
    for (const bad of [undefined, null, {}, { pool: undefined }, { pool: null }, { pool: {} }]) {
      expect(() => createPostgresRiyaConversationContinuityStore(bad as never)).toThrow(
        PostgresRiyaContinuityStoreError,
      );
    }
  });

  it('(6) opens no connection: constructing performs no I/O at all', () => {
    // `forbiddenPool` rejects on connect, so a constructor that connected would surface here as an
    // unhandled rejection rather than a clean return.
    expect(() => store()).not.toThrow();
  });

  it('(7) exposes exactly the three port methods, frozen', () => {
    const built = store();
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.keys(built).sort()).toStrictEqual([
      'compareAndSet',
      'createInitialIfAbsent',
      'load',
    ]);
    // No escape hatch, on the instance or anywhere up its prototype chain.
    for (const forbidden of [
      'delete',
      'clear',
      'prune',
      'reset',
      'list',
      'count',
      'all',
      'query',
    ]) {
      expect((built as unknown as Record<string, unknown>)[forbidden], forbidden).toBeUndefined();
    }
  });
});

describe('invalid input is refused before a connection is taken', () => {
  it('(8) load rejects a malformed key', async () => {
    const built = store();
    for (const key of [
      undefined,
      null,
      {},
      { tenantId: 'tenant.a' },
      { conversationId: 'conv.1' },
      { tenantId: '', conversationId: 'conv.1' },
      { tenantId: 'tenant.a', conversationId: '' },
      { tenantId: 'a b', conversationId: 'conv.1' },
      { tenantId: 'tenant@example.com', conversationId: 'conv.1' },
      { tenantId: 'tenant.a', conversationId: '+919000000000' },
      { tenantId: 'x'.repeat(129), conversationId: 'conv.1' },
      { tenantId: 42, conversationId: 'conv.1' },
    ]) {
      expect(await codeOf(() => built.load(key as never)), JSON.stringify(key)).toBe(
        'invalid-input',
      );
    }
  });

  it('(9) createInitialIfAbsent rejects a state the contract would refuse', async () => {
    const built = store();
    for (const state of [
      undefined,
      null,
      {},
      // A CONTACT phase with an unconfirmed summary: a conversation that skipped the step it
      // depends on.
      { ...initialState('tenant.a', 'conv.1'), phase: 'CONTACT' },
      // Completion evidence on a phase that is not COMPLETE.
      { ...initialState('tenant.a', 'conv.1'), completionEvidenceRef: 'evidence.1' },
      // A revision that is not a revision.
      { ...initialState('tenant.a', 'conv.1'), continuityRevision: -1 },
      { ...initialState('tenant.a', 'conv.1'), continuityRevision: 1.5 },
      // A version this schema does not describe.
      { ...initialState('tenant.a', 'conv.1'), version: 2 },
      // An unknown phase.
      { ...initialState('tenant.a', 'conv.1'), phase: 'DISCOVERY' },
      // An extra key: `.strict()` refuses it rather than dropping it silently.
      { ...initialState('tenant.a', 'conv.1'), consentGiven: true },
    ]) {
      expect(
        await codeOf(() => built.createInitialIfAbsent({ state } as never)),
        JSON.stringify(state),
      ).toBe('invalid-input');
    }
  });

  it('(9a) createInitialIfAbsent rejects a fully valid state whose revision is not 0', async () => {
    const built = store();
    // A continuity row is BORN at revision 0 (ADR-0095). These states are otherwise perfectly valid --
    // the contract would accept them for a compare-and-set -- but they are not INITIAL, and initial
    // persistence is the only thing createInitialIfAbsent does. Refused BEFORE a connection is taken:
    // the forbidden pool would surface as `store-unavailable` if one were attempted.
    for (const revision of [1, 2, 41]) {
      expect(
        await codeOf(() =>
          built.createInitialIfAbsent({
            state: summaryReadyState('tenant.a', 'conv.1', { continuityRevision: revision }),
          }),
        ),
        String(revision),
      ).toBe('invalid-input');
    }
    // The revision-0 form of the SAME state is NOT refused here: it passes validation and reaches the
    // pool (surfacing as store-unavailable against the forbidden pool).
    expect(
      await codeOf(() =>
        built.createInitialIfAbsent({
          state: summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 0 }),
        }),
      ),
    ).toBe('store-unavailable');
  });

  it('(10) createInitialIfAbsent rejects a non-object input envelope', async () => {
    const built = store();
    for (const input of [undefined, null, 'state']) {
      expect(await codeOf(() => built.createInitialIfAbsent(input as never))).toBe('invalid-input');
    }
  });

  it('(11) compareAndSet rejects a malformed expected revision', async () => {
    const built = store();
    const nextState = fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 2 });
    for (const expectedRevision of [
      undefined,
      null,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
    ]) {
      expect(
        await codeOf(() => built.compareAndSet({ expectedRevision, nextState } as never)),
        String(expectedRevision),
      ).toBe('invalid-input');
    }
  });

  it('(12) compareAndSet rejects a next state the contract would refuse', async () => {
    const built = store();
    expect(
      await codeOf(() =>
        built.compareAndSet({
          expectedRevision: 1,
          nextState: { ...initialState('tenant.a', 'conv.1'), phase: 'CONSENT' },
        } as never),
      ),
    ).toBe('invalid-input');
  });

  it('(12a) compareAndSet refuses a next revision that is not exactly expected + 1', async () => {
    const built = store();
    // A valid state and a valid expected revision, but the next revision SKIPS. The +1 rule (ADR-0095)
    // refuses it BEFORE a connection is taken: were it allowed through, the forbidden pool would
    // surface as `store-unavailable` instead.
    for (const skipped of [0, 2, 5, 41]) {
      expect(
        await codeOf(() =>
          built.compareAndSet({
            expectedRevision: 0,
            nextState: summaryReadyState('tenant.a', 'conv.1', { continuityRevision: skipped }),
          }),
        ),
        String(skipped),
      ).toBe('invalid-input');
    }
    // The exact one-step advance is NOT refused here: it passes validation and reaches the pool.
    expect(
      await codeOf(() =>
        built.compareAndSet({
          expectedRevision: 0,
          nextState: summaryReadyState('tenant.a', 'conv.1', { continuityRevision: 1 }),
        }),
      ),
    ).toBe('store-unavailable');
  });

  it('(13) a valid-looking request DOES reach the pool — proving the refusals above are real', async () => {
    const built = store();
    // The forbidden pool rejects with a plain Error, which the adapter classifies as
    // `store-unavailable`. Getting that code (rather than `invalid-input`) is the evidence that
    // validation passed and a connection was genuinely attempted.
    expect(await codeOf(() => built.load({ tenantId: 'tenant.a', conversationId: 'conv.1' }))).toBe(
      'store-unavailable',
    );
    expect(
      await codeOf(() =>
        built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.1') }),
      ),
    ).toBe('store-unavailable');
    expect(
      await codeOf(() =>
        built.compareAndSet({
          expectedRevision: 0,
          nextState: fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 1 }),
        }),
      ),
    ).toBe('store-unavailable');
  });

  it('(14) an unreachable pool never becomes a normal outcome', async () => {
    const built = store();
    // Not `undefined`, not CREATED, not EXISTING, not NOT_FOUND, not REVISION_CONFLICT.
    await expect(built.load({ tenantId: 'tenant.a', conversationId: 'conv.1' })).rejects.toThrow(
      PostgresRiyaContinuityStoreError,
    );
    await expect(
      built.createInitialIfAbsent({ state: initialState('tenant.a', 'conv.1') }),
    ).rejects.toThrow(PostgresRiyaContinuityStoreError);
    await expect(
      built.compareAndSet({
        expectedRevision: 0,
        nextState: fullyDiscoveredState('tenant.a', 'conv.1', { continuityRevision: 1 }),
      }),
    ).rejects.toThrow(PostgresRiyaContinuityStoreError);
  });

  it('(15) a driver error never reaches the caller: no message, host or credential leaks', async () => {
    const leaky = createPostgresRiyaConversationContinuityStore({
      pool: {
        connect(): Promise<never> {
          return Promise.reject(
            new Error('connect ECONNREFUSED postgres://riya:s3cret@db.internal:5432/qf_jarvis'),
          );
        },
      } as never,
    });
    try {
      await leaky.load({ tenantId: 'tenant.a', conversationId: 'conv.1' });
      expect.unreachable('the store must not resolve');
    } catch (error) {
      expect(error).toBeInstanceOf(PostgresRiyaContinuityStoreError);
      const message = (error as Error).message;
      for (const secret of [
        's3cret',
        'db.internal',
        'riya:',
        '5432',
        'ECONNREFUSED',
        'postgres://',
      ]) {
        expect(message, secret).not.toContain(secret);
      }
    }
  });
});

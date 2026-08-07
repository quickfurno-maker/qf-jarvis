/**
 * The durable Riya conversational continuity store (RWC-P2B, ADR-0095).
 *
 * PostgreSQL durability for the port RWC-P2C declared and deliberately left injected with NO
 * default. Before this package the only available `RiyaContinuityStorePort` was a test-only
 * in-memory fake that passes every test and loses every conversation on restart -- a client would
 * return to a concierge that had forgotten the project they were mid-way through describing.
 *
 * ### What this changes, and what it does not
 *
 * It changes one thing: continuity now survives a restart, and two processes compare revisions
 * through the database rather than through one process's memory.
 *
 * It changes nothing else. There is no HTTP, no endpoint, no ingress, no browser, no session, no
 * provider, no n8n, no QuickFurno client and no credential. Nothing in the repository imports this
 * package -- it is a durable adapter with tests until a later composition slice injects it, and
 * RWC-P2C still REQUIRES an injected store. It implements storage semantics only: no phase
 * transition, no extraction from prose and no provenance merge, all three of which RWC-P4 owns.
 *
 * ### Uncertainty throws; it never becomes an outcome
 *
 * `undefined`, `CREATED`, `EXISTING`, `REVISION_CONFLICT` and `NOT_FOUND` are all statements about a
 * KNOWN durable fact. A database that did not answer is not one of them, and the tempting reading of
 * "no answer" -- there is nothing there, so this is new -- is the one that silently restarts a
 * client's conversation from the beginning. Every failure below is an exception; RWC-P2C's caller
 * converts store uncertainty into a continuity-unavailable refusal.
 */
import type {
  RiyaContinuityCasOutcome,
  RiyaContinuityCreateResult,
  RiyaContinuityStoreKey,
} from '@qf-jarvis/riya-web-conversation-service';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import type { Pool, PoolClient } from 'pg';

import { PostgresRiyaContinuityStoreError, classifyDatabaseError } from '../contracts/errors.js';
import type {
  PostgresRiyaContinuityStore,
  PostgresRiyaContinuityStoreConfig,
} from '../contracts/api.js';
import {
  canonicalizeRow,
  toStateParameters,
  validateExpectedRevision,
  validateKey,
} from '../internal/rows.js';
import {
  INSERT_INITIAL_STATE,
  SELECT_EXISTS,
  SELECT_STATE,
  UPDATE_STATE_IF_REVISION_MATCHES,
} from '../internal/sql.js';

function invariant(): never {
  throw new PostgresRiyaContinuityStoreError('repository-invariant');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Read exactly one row, or none.
 *
 * The `LIMIT 2` in the statements is what makes this checkable: the primary key means two rows for
 * one key is structurally impossible, so if the driver returns two, the uniqueness this adapter's
 * correctness rests on is not present in the database it is talking to. Refusing is the only safe
 * answer -- picking the first would be choosing between two states nobody can reconcile.
 */
function singleRow(rows: readonly unknown[]): unknown {
  if (rows.length === 0) {
    return undefined;
  }
  if (rows.length !== 1) {
    return invariant();
  }
  return rows[0];
}

/**
 * Build a durable continuity store over an INJECTED pool. The caller owns the pool.
 *
 * Synchronous, and it opens no connection: constructing a store performs no I/O and proves nothing
 * about the database. Readiness is answered where it matters -- the first call against a database
 * without migration 0011 raises `schema-incompatible`.
 */
export function createPostgresRiyaConversationContinuityStore(
  config: PostgresRiyaContinuityStoreConfig,
): PostgresRiyaContinuityStore {
  // Typed `unknown` at the check: the declared parameter says a pool is present, but this is a
  // package boundary, and an untyped caller -- or a bare Pool passed instead of `{ pool }` -- would
  // otherwise reach the first query as `undefined`.
  const supplied: unknown = config;
  if (
    !isRecord(supplied) ||
    supplied['pool'] === undefined ||
    supplied['pool'] === null ||
    typeof (supplied['pool'] as { connect?: unknown }).connect !== 'function'
  ) {
    throw new PostgresRiyaContinuityStoreError('invalid-input');
  }
  const pool = supplied['pool'] as Pool;

  /** Take a connection, run the body, always release. The one classification boundary. */
  async function withClient<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      throw classifyDatabaseError(error);
    }
    try {
      return await body(client);
    } catch (error) {
      // No raw driver error, SQL string, constraint name, host, database name, credential, row value
      // or discovery text escapes past this point.
      throw classifyDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async function load(
    key: RiyaContinuityStoreKey,
  ): Promise<RiyaConversationContinuityStateV1 | undefined> {
    // Before any connection is taken. A malformed key is the caller's defect, and it must not be
    // reported as a database problem or reach the server as a constraint violation.
    const validated = validateKey(key);

    return withClient(async (client) => {
      const result = await client.query(SELECT_STATE, [
        validated.tenantId,
        validated.conversationId,
      ]);
      const row = singleRow(result.rows);
      // Genuinely absent. This is a KNOWN fact -- the query answered -- and it is the only path to
      // `undefined`. A failed query threw long before here.
      return row === undefined ? undefined : canonicalizeRow(row);
    });
  }

  async function createInitialIfAbsent(input: {
    readonly state: RiyaConversationContinuityStateV1;
  }): Promise<RiyaContinuityCreateResult> {
    const suppliedInput: unknown = input;
    if (!isRecord(suppliedInput)) {
      throw new PostgresRiyaContinuityStoreError('invalid-input');
    }
    // Re-proved through the canonical constructor before anything is sent. The key comes from the
    // STATE itself -- the port takes no separate key here, and deriving it from anywhere else would
    // let a state be filed under a conversation it does not belong to.
    const parameters = toStateParameters(suppliedInput['state']);

    // A continuity row is BORN at revision 0 (ADR-0095). `createInitialIfAbsent` is INITIAL
    // persistence: a state already at revision 1, 2, ... was reached by continuity mutations that
    // never happened durably, and admitting it would file a mid-conversation state as if it were a
    // first turn. Every later revision is reached only through `compareAndSet`. Refused BEFORE any
    // connection is taken -- the defect is the caller's, not the database's -- and the migration's
    // INSERT trigger holds the same rule for any writer that bypasses this adapter.
    if (parameters.continuityRevision !== 0) {
      throw new PostgresRiyaContinuityStoreError('invalid-input');
    }

    return withClient(async (client) => {
      // 1. The arbitration write. Autocommit: a `CREATED` is durable the moment it is returned.
      const inserted = await client.query(INSERT_INITIAL_STATE, [
        parameters.tenantId,
        parameters.conversationId,
        parameters.continuityRevision,
        parameters.stateJson,
      ]);

      if (inserted.rows.length === 1) {
        // Canonicalized from the RETURNED row, not from the candidate. What is stored is what the
        // database accepted, and reading it back is how a column default or a coercion this adapter
        // did not expect becomes visible instead of silently diverging from the caller's copy.
        return Object.freeze({
          disposition: 'CREATED' as const,
          state: canonicalizeRow(inserted.rows[0]),
        });
      }
      if (inserted.rows.length !== 0) {
        // One row in, at most one row out. Anything else means the statement did not do what this
        // adapter believes it does, and guessing from there is not available.
        return invariant();
      }

      // 2. A durable row won. Read it in a NEW statement, and therefore a NEW snapshot, where the
      //    committed winner is guaranteed visible under READ COMMITTED. See internal/sql.ts for why
      //    the insert's own snapshot cannot be trusted to see it.
      const existing = await client.query(SELECT_STATE, [
        parameters.tenantId,
        parameters.conversationId,
      ]);
      const row = singleRow(existing.rows);
      if (row === undefined) {
        // The insert reported a conflict, so a COMMITTED row existed; this adapter never deletes,
        // and it is granted no DELETE privilege. A missing winner means the store's assumptions
        // about the database are wrong. It must NOT become `CREATED` -- that would hand two callers
        // a first turn -- and it must not be retried, because nothing here knows what to retry
        // toward.
        return invariant();
      }

      // The WINNER's state, never this caller's candidate -- even when the two are equivalent.
      // Returning the candidate would be an assertion this call could not make: that what is durable
      // matches what was offered. Only the row proves that, and RWC-P2C's contract is explicit that
      // both callers must use the state the store returns.
      return Object.freeze({
        disposition: 'EXISTING' as const,
        state: canonicalizeRow(row),
      });
    });
  }

  async function compareAndSet(input: {
    readonly expectedRevision: number;
    readonly nextState: RiyaConversationContinuityStateV1;
  }): Promise<RiyaContinuityCasOutcome> {
    const suppliedInput: unknown = input;
    if (!isRecord(suppliedInput)) {
      throw new PostgresRiyaContinuityStoreError('invalid-input');
    }
    const expectedRevision = validateExpectedRevision(suppliedInput['expectedRevision']);
    const parameters = toStateParameters(suppliedInput['nextState']);

    // One logical continuity mutation advances the revision by EXACTLY one (ADR-0095). A next state at
    // any other revision is a caller defect -- a skipped step, a replayed write, or a decrement -- and
    // it is refused BEFORE any SQL runs, so it can never reach the row. The database holds the same
    // rule independently in the BEFORE UPDATE trigger; this is the near, cheap half of that guard.
    // `expectedRevision` is already `<= MAX_SAFE_INTEGER`; if it is exactly the ceiling, no valid
    // `nextState` can carry `ceiling + 1`, so `toStateParameters` will have refused it first.
    if (parameters.continuityRevision !== expectedRevision + 1) {
      throw new PostgresRiyaContinuityStoreError('invalid-input');
    }

    return withClient(async (client) => {
      // The predicate IS the concurrency control. Two callers racing with the same expected revision
      // cannot both match: the row lock and the re-evaluated predicate make one of them update zero
      // rows. There is no read-then-write, no advisory lock, no SERIALIZABLE and no retry.
      const updated = await client.query(UPDATE_STATE_IF_REVISION_MATCHES, [
        parameters.tenantId,
        parameters.conversationId,
        parameters.continuityRevision,
        parameters.stateJson,
        expectedRevision,
      ]);

      if (updated.rows.length === 1) {
        // Read back and canonicalize purely as a proof: an UPDATE that stored something the contract
        // would refuse must not be reported as a clean `UPDATED`. The state is then discarded -- the
        // port returns an outcome, not a state, and widening it here would be this adapter deciding
        // what RWC-P4's caller is owed.
        canonicalizeRow(updated.rows[0]);
        return 'UPDATED' as const;
      }
      if (updated.rows.length !== 0) {
        return invariant();
      }

      // Zero rows means the predicate did not match. That is TWO different facts, and the port
      // distinguishes them: no conversation at all, or a conversation at a different revision.
      const present = await client.query(SELECT_EXISTS, [
        parameters.tenantId,
        parameters.conversationId,
      ]);
      if (present.rows.length > 1) {
        return invariant();
      }
      if (present.rows.length === 0) {
        return 'NOT_FOUND' as const;
      }

      // A row exists at a revision that is not the expected one. Nothing is repaired, nothing is
      // merged, no provenance winner is chosen and the durable row is NOT touched -- deciding what a
      // conflicting update "meant" is RWC-P4's question, and answering it in storage would silently
      // overwrite whatever actually won.
      return 'REVISION_CONFLICT' as const;
    });
  }

  // Frozen, and exactly the three port methods. A caller cannot swap `compareAndSet` for something
  // permissive on an object a composition has already been handed.
  return Object.freeze({ load, createInitialIfAbsent, compareAndSet });
}

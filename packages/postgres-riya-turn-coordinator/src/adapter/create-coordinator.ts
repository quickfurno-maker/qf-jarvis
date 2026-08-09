/**
 * The durable PostgreSQL Riya turn coordinator (RWC-P8, ADR-0104).
 *
 * ### What it does
 *
 * Two jobs, and they are separate. It serializes TEXT turns so one conversation runs one at a time
 * across every replica, and it records which logical messages have been claimed so a spent message
 * can never run again.
 *
 * ### One dedicated client per lease, and no transaction
 *
 * An acquired lease owns a `PoolClient` for its whole life. The session advisory lock lives on that
 * exact session, so the lock and the statements that rely on it cannot end up on different
 * connections — which is precisely what would happen if the lock were taken through `pool.query` and
 * the work continued elsewhere, and it would be invisible until production load made the pool hand
 * out a different connection.
 *
 * There is no open transaction across the model call. A `BEGIN` held from `begin` to `complete` would
 * pin a connection and hold row locks for the length of an inference, and idle-in-transaction is how
 * a Postgres deployment falls over under load. The session lock gives the same mutual exclusion with
 * none of that, and the database releases it when the session ends — the behaviour a crashed replica
 * needs.
 *
 * ### The central crash rule
 *
 * If a later `begin` ACQUIRES this conversation's lock and finds a `PROCESSING` row, the previous
 * processor no longer holds the lock, so it is gone. We cannot know whether it reached a model, a
 * Core decision or a durable write before it went. So the claim is marked INDETERMINATE and that
 * message is never run again automatically.
 *
 * That is deliberately unhelpful, and deliberately safe: the alternative is re-running a message that
 * may already have created a real enquiry about somebody's home.
 */
import type { Pool, PoolClient } from 'pg';

import type {
  RiyaTurnBeginResult,
  RiyaTurnCoordinatorBeginInput,
  RiyaTurnCoordinatorPort,
  RiyaTurnLease,
} from '@qf-jarvis/riya-web-conversation-service';

import { classifyDatabaseError, PostgresRiyaTurnCoordinatorError } from '../contracts/errors.js';
import { conversationLockKey, sourceTurnDigest, turnIdentityDigest } from '../internal/identity.js';
import {
  FINALIZE_CLAIM,
  INSERT_PROCESSING_CLAIM,
  SELECT_CANDIDATE_CLAIMS,
  TRY_LOCK,
  UNLOCK,
} from '../internal/sql.js';

/** What the coordinator is built from. A pool, and nothing else. */
export interface PostgresRiyaTurnCoordinatorConfig {
  /** An injected `pg` Pool. Its lifecycle belongs to the caller; this package never creates one. */
  readonly pool: Pool;
}

const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const CHANNELS: readonly string[] = Object.freeze(['WEB', 'WHATSAPP']);
const DATA_CLASSES: readonly string[] = Object.freeze([
  'HOSTED_ALLOWED',
  'LOCAL_ONLY',
  'HUMAN_ONLY',
]);

interface CandidateRow {
  readonly message_id: string;
  readonly channel: string;
  readonly source_turn_digest: string;
  readonly turn_identity_digest: string;
  readonly claim_state: string;
}

/**
 * Re-prove the input before anything reaches the database.
 *
 * The declared type promises canonical identifiers, but this is a package boundary and the value may
 * have been assembled from JSON. A malformed identifier would otherwise be refused by a CHECK
 * constraint, and a constraint violation classifies as a repository invariant — which would report a
 * caller's mistake as durable corruption.
 */
function provenInput(input: RiyaTurnCoordinatorBeginInput): RiyaTurnCoordinatorBeginInput {
  const supplied: unknown = input;
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    throw new PostgresRiyaTurnCoordinatorError('invalid-input');
  }
  if (
    !IDENTIFIER.test(input.tenantId) ||
    !IDENTIFIER.test(input.conversationId) ||
    !IDENTIFIER.test(input.messageId) ||
    !CHANNELS.includes(input.channel) ||
    !DATA_CLASSES.includes(input.dataClass) ||
    !CANONICAL_INSTANT.test(input.receivedAt) ||
    typeof input.channelTurnRef !== 'string' ||
    input.channelTurnRef.length < 1 ||
    input.channelTurnRef.length > 256 ||
    (input.subjectRef !== undefined && !IDENTIFIER.test(input.subjectRef))
  ) {
    throw new PostgresRiyaTurnCoordinatorError('invalid-input');
  }
  // A client's words are not a parameter of this port, and a caller that added one anyway must not
  // have it quietly ignored -- silence would be indistinguishable from the field being honoured.
  if ('normalizedText' in (supplied as Record<string, unknown>)) {
    throw new PostgresRiyaTurnCoordinatorError('invalid-input');
  }
  return input;
}

/** Build the coordinator. Synchronous; it opens nothing and reads no environment. */
export function createPostgresRiyaTurnCoordinator(
  config: PostgresRiyaTurnCoordinatorConfig,
): RiyaTurnCoordinatorPort {
  const supplied: unknown = config;
  if (
    typeof supplied !== 'object' ||
    supplied === null ||
    typeof (supplied as { pool?: { connect?: unknown } }).pool?.connect !== 'function'
  ) {
    throw new PostgresRiyaTurnCoordinatorError('invalid-input');
  }
  const pool = config.pool;

  /**
   * Give a session back, or destroy it.
   *
   * `release(true)` DESTROYS the physical connection rather than returning it to the pool. That is
   * the only safe move when an advisory unlock threw, returned `false`, or could not be attempted: a
   * session lock that is still held on a connection the pool then hands to somebody else would block
   * an unrelated conversation forever, and nothing in the application would ever explain why.
   *
   * Destroying a connection costs one reconnect. Leaking a lock costs a conversation.
   */
  const releaseSession = (client: PoolClient, healthy: boolean): void => {
    try {
      if (healthy) {
        client.release();
      } else {
        client.release(true);
      }
    } catch {
      // The pool is already unhappy about this client. There is nothing further to do, and throwing
      // here would replace a real outcome with a cleanup failure.
    }
  };

  /**
   * Require that a durable write moved EXACTLY ONE row.
   *
   * A resolved `pg` query is not evidence that anything changed. `FINALIZE_CLAIM` is guarded by
   * `WHERE claim_state = 'PROCESSING'`, so it reports success while affecting zero rows whenever the
   * claim is not where this lease believes it is -- already terminal, already gone, or never written.
   *
   * That is the one failure this adapter must never pass upward. `complete()` resolving on zero rows
   * would let the service return a Riya result and a Core-authorized body for a turn whose claim was
   * never proved to reach `COMPLETED`, which is exactly the false evidence ADR-0104 orders the
   * finalization-before-return rule to prevent.
   *
   * More than one row would be worse still: the primary key makes it impossible, so seeing it means
   * the statement is not the statement this adapter thinks it is running.
   *
   * `rowCount` is typed `number | null` by the driver, and `null` is treated as a failure rather than
   * as "probably fine" -- an unknown count is not a proof.
   */
  const affectedExactlyOne = (rowCount: number | null): boolean => rowCount === 1;

  async function begin(rawInput: RiyaTurnCoordinatorBeginInput): Promise<RiyaTurnBeginResult> {
    const input = provenInput(rawInput);
    const sourceDigest = sourceTurnDigest({
      channel: input.channel,
      channelTurnRef: input.channelTurnRef,
    });
    const identityDigest = turnIdentityDigest({
      channel: input.channel,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      messageId: input.messageId,
      receivedAt: input.receivedAt,
      sourceTurnDigest: sourceDigest,
      dataClass: input.dataClass,
      ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
    });
    const lockKey = conversationLockKey({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
    });

    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error: unknown) {
      throw classifyDatabaseError(error);
    }

    /** Unlock, then hand the session back — destroying it if the unlock is not provably clean. */
    const releaseLock = async (): Promise<void> => {
      let released: boolean;
      try {
        const result = await client.query<{ released: boolean }>(UNLOCK, [lockKey.toString()]);
        released = result.rows[0]?.released === true;
      } catch {
        released = false;
      }
      releaseSession(client, released);
    };

    let acquired: boolean;
    try {
      const locked = await client.query<{ acquired: boolean }>(TRY_LOCK, [lockKey.toString()]);
      acquired = locked.rows[0]?.acquired === true;
    } catch (error: unknown) {
      // The lock statement itself failed. Nothing is held, so the session goes back destroyed only if
      // we cannot be sure -- and we cannot be sure, because the failure may have been mid-statement.
      releaseSession(client, false);
      throw classifyDatabaseError(error);
    }

    if (!acquired) {
      // Another turn owns this conversation. No ledger read, no insert, no continuity, no model.
      releaseSession(client, true);
      return Object.freeze({ outcome: 'BUSY' as const });
    }

    // ---- classification, under the lock -----------------------------------------------------
    let rows: readonly CandidateRow[];
    try {
      const found = await client.query<CandidateRow>(SELECT_CANDIDATE_CLAIMS, [
        input.tenantId,
        input.conversationId,
        input.messageId,
        sourceDigest,
      ]);
      rows = found.rows;
    } catch (error: unknown) {
      await releaseLock();
      throw classifyDatabaseError(error);
    }

    if (rows.length > 2) {
      // At most two rows can legitimately match: one on the message id, one on the source digest.
      await releaseLock();
      throw new PostgresRiyaTurnCoordinatorError('repository-invariant');
    }

    const byMessage = rows.find((row) => row.message_id === input.messageId);
    const bySource = rows.find((row) => row.source_turn_digest === sourceDigest);

    // A source reference already claimed under a DIFFERENT message id. This is what a redelivery
    // given a fresh message id looks like, and treating it as new would run the same turn twice.
    if (bySource !== undefined && bySource.message_id !== input.messageId) {
      await releaseLock();
      return Object.freeze({ outcome: 'CONFLICT' as const });
    }

    if (byMessage !== undefined) {
      // Same message id. Everything immutable about it must match, or this is a different turn
      // wearing an existing claim's key.
      if (
        byMessage.source_turn_digest !== sourceDigest ||
        byMessage.turn_identity_digest !== identityDigest ||
        byMessage.channel !== input.channel
      ) {
        await releaseLock();
        return Object.freeze({ outcome: 'CONFLICT' as const });
      }
      if (byMessage.claim_state === 'COMPLETED') {
        await releaseLock();
        return Object.freeze({ outcome: 'REPLAYED' as const });
      }
      if (byMessage.claim_state === 'INDETERMINATE') {
        await releaseLock();
        return Object.freeze({ outcome: 'INDETERMINATE' as const });
      }
      // PROCESSING, and WE hold the conversation lock -- so whoever wrote it does not. It is gone,
      // and we cannot know how far it got. Mark it once and never run this message again.
      let marked;
      try {
        marked = await client.query(FINALIZE_CLAIM, [
          input.tenantId,
          input.conversationId,
          input.messageId,
          'INDETERMINATE',
        ]);
      } catch (error: unknown) {
        await releaseLock();
        throw classifyDatabaseError(error);
      }
      if (!affectedExactlyOne(marked.rowCount)) {
        // The row this transaction just READ as PROCESSING did not move. Something else is writing
        // this claim, or the guarded predicate no longer describes it -- and either way reporting
        // INDETERMINATE would assert a durable fact nobody observed.
        //
        // No second update and no re-read. Guessing between "it became terminal a moment ago" and
        // "this statement is not doing what it appears to" is exactly the guess that would let a
        // spent message look recoverable, or a live one look spent.
        await releaseLock();
        throw new PostgresRiyaTurnCoordinatorError('repository-invariant');
      }
      await releaseLock();
      return Object.freeze({ outcome: 'INDETERMINATE' as const });
    }

    // ---- no row: an UNSTARTED lease, and deliberately no insert yet --------------------------
    let state: 'UNSTARTED' | 'STARTED' | 'DONE' = 'UNSTARTED';

    const finalize = async (claimState: 'COMPLETED' | 'INDETERMINATE'): Promise<void> => {
      if (state !== 'STARTED') {
        throw new PostgresRiyaTurnCoordinatorError('invalid-input');
      }
      state = 'DONE';
      let finalized;
      try {
        finalized = await client.query(FINALIZE_CLAIM, [
          input.tenantId,
          input.conversationId,
          input.messageId,
          claimState,
        ]);
      } catch (error: unknown) {
        await releaseLock();
        throw classifyDatabaseError(error);
      }
      if (!affectedExactlyOne(finalized.rowCount)) {
        // The claim was NOT proved to reach its terminal state. For `COMPLETED` this is the most
        // consequential refusal in the package: reporting success here would let the service hand a
        // client a reply for a turn the ledger still records as in flight.
        //
        // No retry. The row is left exactly as the database has it, and the next claim of this
        // message decides from durable evidence rather than from a guess made here.
        await releaseLock();
        throw new PostgresRiyaTurnCoordinatorError('repository-invariant');
      }
      await releaseLock();
    };

    const lease: RiyaTurnLease = {
      async startProcessing(): Promise<void> {
        if (state !== 'UNSTARTED') {
          throw new PostgresRiyaTurnCoordinatorError('invalid-input');
        }
        let inserted;
        try {
          inserted = await client.query(INSERT_PROCESSING_CLAIM, [
            input.tenantId,
            input.conversationId,
            input.messageId,
            input.channel,
            sourceDigest,
            identityDigest,
          ]);
        } catch (error: unknown) {
          // The insert did not clearly succeed. The lease goes to DONE so nothing can finalize a
          // claim that may not exist, and the caller is told -- it will not call the runtime.
          await releaseLock();
          state = 'DONE';
          throw classifyDatabaseError(error);
        }
        if (!affectedExactlyOne(inserted.rowCount)) {
          // An INSERT with no `ON CONFLICT` that created no row is not a claim. Permitting the
          // runtime here would run a real model turn attributed to a claim that does not exist, and
          // the message would still look unspent to the next caller.
          await releaseLock();
          state = 'DONE';
          throw new PostgresRiyaTurnCoordinatorError('repository-invariant');
        }
        state = 'STARTED';
      },
      complete(): Promise<void> {
        return finalize('COMPLETED');
      },
      indeterminate(): Promise<void> {
        return finalize('INDETERMINATE');
      },
      async releaseUnstarted(): Promise<void> {
        if (state !== 'UNSTARTED') {
          throw new PostgresRiyaTurnCoordinatorError('invalid-input');
        }
        state = 'DONE';
        // No ledger row is written and none is updated. The message stays retryable, which is exactly
        // right for a turn that failed before it could do anything.
        await releaseLock();
      },
    };

    return Object.freeze({ outcome: 'ACQUIRED' as const, lease: Object.freeze(lease) });
  }

  return Object.freeze({ begin });
}

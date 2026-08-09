/**
 * Content-free observability for the durable turn coordinator (RWC-P9, ADR-0105).
 *
 * ### The four questions an operator actually has
 *
 * Are conversations contending? Are messages being replayed? Is anything becoming INDETERMINATE — the
 * one state that means a business effect may have happened and can never be re-run? And are sessions
 * being destroyed, which would mean advisory unlocks are not coming back clean?
 *
 * None of those needs an identifier. Every field below is a closed enum.
 *
 * ### What is deliberately absent, and why it would be worse here than anywhere
 *
 * No tenant, conversation or message id. No source or identity digest — those are derived from a
 * caller's channel reference, and a stream of them is a stream of correlatable turn fingerprints. No
 * lock key, which is derived from the conversation. No `channelTurnRef`, no `subjectRef`, no SQL, no
 * table, no host, no database user, no raw error and no stack.
 *
 * This package's entire privacy position is that a duplicate-suppression ledger is not a message
 * archive. Emitting the identifiers it carefully declined to store would hand them to the least
 * governed pipeline in the deployment instead.
 *
 * ### Facts only, and only after they are proved
 *
 * `claim-processing-started` and `claim-completed` are emitted ONLY after the exact-one-row proof
 * that RWC-P8's owner correction added. A `completed` event on a zero-row UPDATE would tell an
 * operator a turn finished when the ledger says otherwise, and that is exactly the false evidence
 * the row-count check exists to refuse.
 *
 * The hook is synchronous, its result is ignored, and a hook that throws changes nothing — including
 * whether a session is destroyed.
 */
import type { PostgresRiyaTurnCoordinatorErrorCode } from './errors.js';

const EVENT_TYPE_VALUES = [
  /** `pg_try_advisory_lock` returned true. This process owns the conversation. */
  'lock-acquired',
  /** It returned false. Another turn is mid-flight; nothing was read and nothing was written. */
  'lock-busy',
  /** An exact logical claim was already COMPLETED. No work, and no cached reply exists to return. */
  'claim-replayed',
  /** A message id or source reference is being reused with different immutable identity. */
  'claim-conflict',
  /**
   * The claim is terminal-indeterminate: already so, or an orphan PROVED moved there.
   *
   * Never emitted on a failed reconciliation. An operator counting these is counting messages that
   * can never be re-run, and a miscount in that column is a miscount of duplicate risk.
   */
  'claim-indeterminate',
  /** The durable PROCESSING claim was proved written — exactly one row. */
  'claim-processing-started',
  /** The claim was proved COMPLETED — exactly one row. */
  'claim-completed',
  /** A physical connection was DESTROYED rather than returned to the pool. */
  'session-discarded',
  /** A bounded coordinator failure. The CODE only. */
  'coordinator-failed',
] as const;

export type PostgresRiyaTurnCoordinatorEventType = (typeof EVENT_TYPE_VALUES)[number];

export const POSTGRES_RIYA_TURN_COORDINATOR_EVENT_TYPES: readonly PostgresRiyaTurnCoordinatorEventType[] =
  Object.freeze([...EVENT_TYPE_VALUES]);

/** Why a session was destroyed. Closed, because each value is a different operational story. */
export const POSTGRES_RIYA_TURN_COORDINATOR_DISCARD_REASONS = [
  /** The lock statement itself failed, possibly mid-statement. The session cannot be trusted. */
  'LOCK_QUERY_UNCERTAIN',
  /** `pg_advisory_unlock` returned false: this session did not hold the lock it thought it did. */
  'UNLOCK_FALSE',
  /** The unlock threw. */
  'UNLOCK_ERROR',
  /** The unlock answered with no usable row. */
  'UNLOCK_MALFORMED',
] as const;

export type PostgresRiyaTurnCoordinatorDiscardReason =
  (typeof POSTGRES_RIYA_TURN_COORDINATOR_DISCARD_REASONS)[number];

/** One coordinator observation. Frozen, closed, and countable. */
export interface PostgresRiyaTurnCoordinatorEvent {
  readonly type: PostgresRiyaTurnCoordinatorEventType;
  /** A closed channel vocabulary, not a provider identity. */
  readonly channel?: 'WEB' | 'WHATSAPP';
  readonly claimState?: 'PROCESSING' | 'COMPLETED' | 'INDETERMINATE';
  /** The BOUNDED code. Never a driver message, a constraint name or a parameter. */
  readonly errorCode?: PostgresRiyaTurnCoordinatorErrorCode;
  readonly discardReason?: PostgresRiyaTurnCoordinatorDiscardReason;
}

/** The injected sink. Synchronous, ignored, and never awaited. */
export interface PostgresRiyaTurnCoordinatorObservabilityHook {
  record(event: PostgresRiyaTurnCoordinatorEvent): void;
}

/** The default. Absent configuration means silence, not a hidden logger. */
export const NOOP_POSTGRES_RIYA_TURN_COORDINATOR_OBSERVABILITY: PostgresRiyaTurnCoordinatorObservabilityHook =
  Object.freeze({
    record(): void {
      // Intentionally nothing.
    },
  });

/**
 * The SQL surface and transaction helper (QFJ-P08, ADR-0081).
 *
 * INTERNAL. Every statement is here, parameterized, and fully schema-qualified — nothing depends on
 * `search_path`, and no identifier is ever interpolated into a statement string.
 *
 * There is no pool here and no configuration: the adapter is handed a `pg` Pool by its caller, who
 * owns its lifecycle. Importing this module connects nowhere and reads no environment.
 */
import type { Pool, PoolClient } from 'pg';

import { classifyDatabaseError } from '../contracts/errors.js';

export const SELECT_REQUEST = `
  SELECT approval_request_id, recommendation_id, proposed_action_id, action_fingerprint,
         created_at, expires_at, request_payload, source_snapshot
    FROM qf_jarvis.approval_request_record
   WHERE approval_request_id = $1
`;

/** Hold one request row for the rest of the transaction, so a concurrent decision cannot interleave. */
export const SELECT_REQUEST_FOR_UPDATE = `${SELECT_REQUEST} FOR UPDATE`;

export const INSERT_REQUEST = `
  INSERT INTO qf_jarvis.approval_request_record
    (approval_request_id, recommendation_id, proposed_action_id, action_fingerprint,
     created_at, expires_at, request_payload, source_snapshot)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (approval_request_id) DO NOTHING
  RETURNING sequence
`;

/**
 * Create the coordination slot if it is not already there.
 *
 * `ON CONFLICT DO NOTHING` rather than an error: two enqueues for the same action racing to create
 * the row is the ordinary case, not a fault. The `FOR UPDATE` below is what actually serialises them.
 */
export const INSERT_SLOT = `
  INSERT INTO qf_jarvis.approval_active_slot (recommendation_id, proposed_action_id)
  VALUES ($1, $2)
  ON CONFLICT (recommendation_id, proposed_action_id) DO NOTHING
`;

/**
 * Lock exactly ONE slot row.
 *
 * This is the whole non-overlap mechanism. Two enqueues for the same (recommendation, action)
 * contend on this row; two enqueues for different actions never meet. No table lock, no advisory
 * lock, and no global lock — a control plane that serialised every approval would be a throughput
 * ceiling bought for no safety.
 */
export const SELECT_SLOT_FOR_UPDATE = `
  SELECT recommendation_id, proposed_action_id, active_approval_request_id
    FROM qf_jarvis.approval_active_slot
   WHERE recommendation_id = $1 AND proposed_action_id = $2
   FOR UPDATE
`;

export const UPDATE_SLOT_POINTER = `
  UPDATE qf_jarvis.approval_active_slot
     SET active_approval_request_id = $3
   WHERE recommendation_id = $1 AND proposed_action_id = $2
`;

/**
 * Clear the pointer ONLY when it still names this exact request.
 *
 * The `AND active_approval_request_id = $3` predicate is the old-request/new-request safety rule
 * expressed as a WHERE clause: a decision for an ask that has since expired and been replaced must
 * not clear the slot belonging to its replacement.
 */
export const CLEAR_SLOT_POINTER = `
  UPDATE qf_jarvis.approval_active_slot
     SET active_approval_request_id = NULL
   WHERE recommendation_id = $1 AND proposed_action_id = $2
     AND active_approval_request_id = $3
`;

export const SELECT_DECISION = `
  SELECT decision_id, recommendation_id, decided_at, decision_payload
    FROM qf_jarvis.approval_decision_record
   WHERE decision_id = $1
`;

export const INSERT_DECISION = `
  INSERT INTO qf_jarvis.approval_decision_record
    (decision_id, recommendation_id, decided_at, decision_payload)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (decision_id) DO NOTHING
  RETURNING sequence
`;

export const SELECT_LINK = `
  SELECT approval_request_id, decision_id, selected_action_decision
    FROM qf_jarvis.approval_request_decision_link
   WHERE approval_request_id = $1
`;

export const INSERT_LINK = `
  INSERT INTO qf_jarvis.approval_request_decision_link
    (approval_request_id, decision_id, selected_action_decision)
  VALUES ($1, $2, $3)
  ON CONFLICT (approval_request_id) DO NOTHING
  RETURNING sequence
`;

export const INSERT_AUDIT = `
  INSERT INTO qf_jarvis.approval_queue_audit
    (event_type, approval_request_id, decision_id, recommendation_id, proposed_action_id,
     record_version)
  VALUES ($1, $2, $3, $4, $5, 1)
`;

export const SELECT_AUDIT_FOR_REQUEST = `
  SELECT sequence, event_type, approval_request_id, decision_id, recommendation_id,
         proposed_action_id, recorded_at
    FROM qf_jarvis.approval_queue_audit
   WHERE approval_request_id = $1
   ORDER BY sequence ASC
`;

/**
 * The active queue, as of a CALLER-supplied instant.
 *
 * "Active" is derived here rather than stored: the slot must still point at the request, no decision
 * link may exist, and the request must not have expired at the observation instant. A stored
 * `pending` column would answer this question with a value that went stale the moment it was
 * written — and a stale `pending` in Jarvis is exactly the authorization state ADR-0002 puts in Core.
 *
 * Deterministic order (soonest expiry first, then append order) so two reads of an unchanged
 * database agree, and a bounded limit so an operator surface cannot ask for everything.
 */
export const SELECT_ACTIVE_REQUESTS = `
  SELECT r.request_payload
    FROM qf_jarvis.approval_active_slot s
    JOIN qf_jarvis.approval_request_record r
      ON r.approval_request_id = s.active_approval_request_id
    LEFT JOIN qf_jarvis.approval_request_decision_link l
      ON l.approval_request_id = r.approval_request_id
   WHERE s.active_approval_request_id IS NOT NULL
     AND l.approval_request_id IS NULL
     AND r.expires_at > $1
   ORDER BY r.expires_at ASC, r.sequence ASC
   LIMIT $2
`;

/**
 * Run `work` inside ONE explicit READ COMMITTED transaction on a dedicated connection.
 *
 * READ COMMITTED is sufficient because the per-key row lock above, not the isolation level, is what
 * serialises writers for one action — and `SERIALIZABLE` would add a retry obligation this adapter
 * deliberately does not have.
 *
 * ### The callback's error survives rollback UNCLASSIFIED
 *
 * This helper classifies the failures it OWNS — connecting, beginning, committing — and rethrows
 * whatever `work` threw as the original value. That distinction is load-bearing, and it was learned
 * the hard way in QFJ-P08-B2: the adapter uses a private sentinel to say "a concurrent session won,
 * roll everything back and let me reconcile", and rollback is exactly the mechanism it is asking
 * for. A helper that classified the sentinel would make an ordinary, correct duplicate race surface
 * as `database-unavailable`, and the reconciliation branch written for it would be unreachable.
 *
 * The public adapter method remains the single classification boundary, and no raw driver error
 * escapes past it. Every rollback is guarded: if the connection has already failed, the original
 * error is the informative one.
 */
export async function withQueueTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw classifyDatabaseError(error);
  }
  async function rollbackQuietly(open: PoolClient): Promise<void> {
    try {
      await open.query('ROLLBACK');
    } catch {
      // The connection is already unusable. The original failure is the informative one.
    }
  }
  try {
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    } catch (error) {
      // No transaction was opened, so there is nothing to undo.
      throw classifyDatabaseError(error);
    }

    let result: T;
    try {
      result = await work(client);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    }

    try {
      await client.query('COMMIT');
    } catch (error) {
      await rollbackQuietly(client);
      throw classifyDatabaseError(error);
    }
    return result;
  } finally {
    client.release();
  }
}

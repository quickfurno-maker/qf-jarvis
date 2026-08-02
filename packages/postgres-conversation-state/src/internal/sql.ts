/**
 * The SQL surface and transaction helper (QFJ-P08-B2, ADR-0077).
 *
 * INTERNAL. Every statement is here, parameterized, and fully schema-qualified — nothing depends on
 * `search_path`, and no identifier is ever interpolated into a statement string.
 *
 * There is no pool here and no configuration: the adapter is handed a `pg` Pool by its caller, who
 * owns its lifecycle. Importing this module connects nowhere and reads no environment.
 */
import type { Pool, PoolClient } from 'pg';

import { classifyDatabaseError } from '../contracts/errors.js';

/** Read one state row by its composite key. */
export const SELECT_STATE = `
  SELECT tenant_id, conversation_id, revision, party_type, data_class,
         human_takeover, ai_paused, cancelled, subject_status, subject_ref, observed_at
    FROM qf_jarvis.conversation_runtime_state
   WHERE tenant_id = $1 AND conversation_id = $2
`;

/**
 * Read one state row and hold it for the rest of the transaction.
 *
 * `FOR UPDATE` on the single aggregate row is what serialises concurrent commands for ONE
 * conversation. It is deliberately not a table lock or an advisory lock: two different conversations
 * must not block each other, and a global lock would make the control plane a throughput ceiling for
 * no safety gain.
 */
export const SELECT_STATE_FOR_UPDATE = `${SELECT_STATE} FOR UPDATE`;

/** Provision a new row. The trigger enforces revision 0 / not taken over / not paused. */
export const INSERT_STATE = `
  INSERT INTO qf_jarvis.conversation_runtime_state
    (tenant_id, conversation_id, revision, party_type, data_class,
     cancelled, subject_status, subject_ref, human_takeover, ai_paused, observed_at)
  VALUES ($1, $2, 0, $3, $4, $5, $6, $7, false, false, $8)
  ON CONFLICT (tenant_id, conversation_id) DO NOTHING
  RETURNING tenant_id, conversation_id, revision, party_type, data_class,
            human_takeover, ai_paused, cancelled, subject_status, subject_ref, observed_at
`;

/**
 * Apply the four columns an operator command may move.
 *
 * The `revision = $6` predicate is redundant under `FOR UPDATE` — and kept anyway. It costs nothing,
 * and it means a lost update stays impossible even if the locking above is ever weakened by someone
 * who did not read this comment. The Core-derived columns are absent by construction: the runtime
 * role is granted no UPDATE privilege on them either.
 */
export const UPDATE_STATE_CONTROL = `
  UPDATE qf_jarvis.conversation_runtime_state
     SET revision = $3, human_takeover = $4, ai_paused = $5, observed_at = $7
   WHERE tenant_id = $1 AND conversation_id = $2 AND revision = $6
`;

/** Read one ledger row by its idempotency identity. */
export const SELECT_COMMAND = `
  SELECT tenant_id, command_id, conversation_id, control_version, expected_revision,
         action, operator_ref, reason_ref, issued_at, outcome, reason,
         observed_revision, resulting_revision, resulting_human_takeover,
         resulting_ai_paused, record_version
    FROM qf_jarvis.conversation_control_command
   WHERE tenant_id = $1 AND command_id = $2
`;

/**
 * Append one decision.
 *
 * `ON CONFLICT DO NOTHING` makes a concurrent duplicate visible as "no row returned" rather than as
 * a raised error, so the caller can roll back and reconcile deliberately instead of unwinding an
 * exception mid-transaction.
 */
export const INSERT_COMMAND = `
  INSERT INTO qf_jarvis.conversation_control_command
    (tenant_id, command_id, conversation_id, control_version, expected_revision,
     action, operator_ref, reason_ref, issued_at, outcome, reason,
     observed_revision, resulting_revision, resulting_human_takeover,
     resulting_ai_paused, record_version)
  VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1)
  ON CONFLICT (tenant_id, command_id) DO NOTHING
  RETURNING sequence
`;

/**
 * Run `work` inside ONE explicit READ COMMITTED transaction on a dedicated connection.
 *
 * READ COMMITTED is sufficient because the row lock above, not the isolation level, is what
 * serialises writers for a conversation — and `SERIALIZABLE` would add a retry obligation this
 * adapter deliberately does not have (see `errors.ts`).
 *
 * ### The callback's error survives rollback UNCLASSIFIED
 *
 * This helper owns the connection and the transaction, so it classifies the failures that are its
 * own: connecting, beginning and committing. It does NOT classify what `work` threw.
 *
 * That distinction is load-bearing rather than tidy. The adapter uses a private sentinel to say
 * "a concurrent session claimed this command id, roll everything back and let me reconcile" — and
 * rollback is exactly the mechanism it is asking for. If this helper classified that sentinel, the
 * caller could never see it: an ordinary, correct duplicate race would be reported as
 * `database-unavailable`, and the reconciliation branch written for it would be unreachable. So the
 * work error is rolled back and rethrown AS THE ORIGINAL VALUE; the public adapter method remains
 * the single classification boundary, and no raw driver error escapes past it.
 *
 * Every rollback is guarded: if the connection has already failed, the original error is the one
 * worth reporting, not the secondary failure of trying to undo on a dead socket.
 */
export async function withControlTransaction<T>(
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

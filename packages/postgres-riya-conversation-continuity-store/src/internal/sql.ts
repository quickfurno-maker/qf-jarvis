/**
 * The SQL surface (RWC-P2B, ADR-0095).
 *
 * INTERNAL. Four statements, all parameterized and all fully schema-qualified -- nothing depends on
 * `search_path`, and no identifier is ever interpolated into a statement string.
 *
 * There is no pool here and no configuration: the adapter is handed a `pg` Pool by its caller, who
 * owns its lifecycle. Importing this module connects nowhere and reads no environment.
 *
 * Every statement names its columns explicitly. `SELECT *` would silently start returning a column a
 * later migration added, and the row canonicalizer would then be reading a shape nobody reviewed.
 */

/** The column list every read returns, in one place so the four statements cannot drift apart. */
const COLUMNS = `
  tenant_id, conversation_id, version, continuity_revision, phase,
  discovery, field_provenance, summary_confirmed, completion_evidence_ref
`;

/**
 * Read one conversation's state.
 *
 * Keyed on BOTH parts. A `WHERE conversation_id = $1` alone would read across tenants, which is the
 * exact failure ADR-0076 section 3 removed the global-uniqueness assumption to prevent.
 *
 * No `FOR UPDATE` and no lock: `load` is a read, and a lock taken here would be held for the length
 * of a network round trip while blocking a concurrent create it has no business blocking.
 */
export const SELECT_STATE = `
  SELECT ${COLUMNS}
    FROM qf_jarvis.riya_conversation_continuity
   WHERE tenant_id = $1
     AND conversation_id = $2
   LIMIT 2
`;

/**
 * The arbitration write. This statement, alone, decides a concurrent first turn.
 *
 * ### Why `ON CONFLICT DO NOTHING`, and why it returns the row
 *
 * The primary key `(tenant_id, conversation_id)` is the arbiter. The database decides who won; this
 * process never does. A winner gets its row back in the same statement -- already committed, so the
 * `CREATED` answer is durable at the instant it is given -- and a loser gets zero rows.
 *
 * ### Why the loser's read is NOT part of this statement
 *
 * It would be tidier to write one CTE that inserts and then selects the winner. It would also be
 * wrong, and quietly so. `INSERT ... ON CONFLICT DO NOTHING` may WAIT on a concurrent session's
 * uncommitted conflicting row; when that session commits, this statement does nothing -- but the
 * statement's own snapshot was taken BEFORE the wait, so a sibling `SELECT` branch of the SAME
 * statement is not guaranteed to see the row that just beat it. A loser built on that would read
 * "nothing is there", and the only answers available from there are wrong: report `CREATED` for a
 * conversation it did not create, or invent an initial state that is not the durable one.
 *
 * So this statement does one thing: it either creates the row or it does not. `SELECT_STATE` then
 * runs as a SEPARATE statement with a FRESH snapshot, where the committed winner is guaranteed
 * visible under READ COMMITTED.
 *
 * ### Why there is no transaction around it
 *
 * The INSERT is atomic and self-committing on its own. Wrapping it would hold the new row
 * uncommitted across a network round trip -- delaying the durability of the very answer whose value
 * is that it is durable, and blocking every concurrent first turn on an uncommitted row for the
 * length of that trip.
 */
export const INSERT_INITIAL_STATE = `
  INSERT INTO qf_jarvis.riya_conversation_continuity
    (tenant_id, conversation_id, version, continuity_revision, phase,
     discovery, field_provenance, summary_confirmed, completion_evidence_ref)
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
  ON CONFLICT (tenant_id, conversation_id) DO NOTHING
  RETURNING ${COLUMNS}
`;

/**
 * The optimistic replacement. One statement, and the predicate IS the concurrency control.
 *
 * `continuity_revision = $10` in the WHERE clause is what makes this a compare-and-set rather than a
 * write: PostgreSQL takes a row lock on the matching row and re-evaluates the predicate against the
 * committed version under READ COMMITTED, so two callers racing with the same expected revision
 * cannot both match. The loser updates zero rows.
 *
 * The whole state is replaced in one statement. Updating `discovery` and `field_provenance`
 * separately would leave a window in which a value exists with no provenance -- precisely the shape
 * the canonical constructor refuses, written into the durable row by the adapter that is supposed to
 * prevent it.
 *
 * `tenant_id`, `conversation_id` and `version` are NOT in the SET list. Identity is immutable, and
 * the runtime role is not even granted UPDATE on those columns, so this is enforced twice.
 *
 * The next revision is `nextState.continuityRevision`, exactly as supplied and canonically
 * validated. This adapter does NOT compute `expectedRevision + 1`: the port says "replace the state
 * only if the stored revision still matches" and says nothing about what the next revision must be,
 * so inventing an increment here would be storage silently owning a rule RWC-P4 has not written.
 */
export const UPDATE_STATE_IF_REVISION_MATCHES = `
  UPDATE qf_jarvis.riya_conversation_continuity
     SET continuity_revision     = $3,
         phase                   = $4,
         discovery               = $5::jsonb,
         field_provenance        = $6::jsonb,
         summary_confirmed       = $7,
         completion_evidence_ref = $8
   WHERE tenant_id = $1
     AND conversation_id = $2
     AND continuity_revision = $9
  RETURNING ${COLUMNS}
`;

/**
 * Does a row exist for this key at all? Used ONLY to split a zero-row update into the two answers
 * the port distinguishes: `NOT_FOUND` (no conversation) and `REVISION_CONFLICT` (a conversation,
 * at a different revision).
 *
 * A separate statement and a fresh snapshot, for the same reason the create path uses one. It reads
 * one column: whether the row exists is the entire question, and pulling the state back would fetch
 * a client's discovery snapshot into a code path that has no use for it.
 */
export const SELECT_EXISTS = `
  SELECT 1 AS present
    FROM qf_jarvis.riya_conversation_continuity
   WHERE tenant_id = $1
     AND conversation_id = $2
   LIMIT 2
`;

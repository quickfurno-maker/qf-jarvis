/**
 * The SQL surface (RWC-P8, ADR-0104).
 *
 * INTERNAL. Every statement is parameterized and fully schema-qualified — nothing depends on
 * `search_path`, and no identifier is ever interpolated into a statement string.
 *
 * There is no pool here and no configuration: the coordinator is handed a `pg` Pool by its caller,
 * who owns its lifecycle. Importing this module connects nowhere and reads no environment.
 *
 * ### There is no transaction here, and that is the design
 *
 * No `BEGIN`, no `COMMIT`, no `SERIALIZABLE`, no `SELECT ... FOR UPDATE`. A transaction opened at
 * `begin` and closed at `complete` would be held OPEN across a model call and a Core decision —
 * seconds of wall clock, sometimes more — pinning a database connection, holding row locks, and
 * feeding the idle-in-transaction problems that take a Postgres deployment down under load.
 *
 * The serialization primitive is a SESSION advisory lock on one dedicated client instead. It survives
 * across statements without a transaction, and the database releases it when the session ends —
 * which is exactly the behaviour a crashed replica needs.
 */

/** The column list every read returns, in one place so the statements cannot drift apart. */
const COLUMNS = `message_id, channel, source_turn_digest, turn_identity_digest, claim_state`;

/**
 * Take the conversation lock, without waiting.
 *
 * `pg_try_advisory_lock` rather than `pg_advisory_lock`: a blocking wait would queue a client's turn
 * behind another turn for an unbounded time, and the honest answer to "somebody else is mid-turn" is
 * BUSY now, not a reply eventually.
 *
 * A SESSION lock rather than a transaction-scoped one, because there is no transaction to scope it to.
 */
export const TRY_LOCK = `SELECT pg_try_advisory_lock($1::bigint) AS acquired`;

/** Release it. The boolean matters: `false` means this session did not hold the lock it thinks it did. */
export const UNLOCK = `SELECT pg_advisory_unlock($1::bigint) AS released`;

/**
 * Everything this conversation has recorded that could be THIS turn.
 *
 * Scoped to the tenant AND conversation, always. Matching on the message id OR the source digest is
 * what makes the conflict classifications possible: a caller reusing a source reference under a new
 * message id, or a message id under a new source reference, is caught because both are searched.
 *
 * `LIMIT 3` bounds the read. Two rows is the most a legitimate state can produce (one matching the
 * message, one matching the source); a third means the durable evidence contradicts itself, and the
 * coordinator needs to be able to SEE that rather than silently reading the first row.
 */
export const SELECT_CANDIDATE_CLAIMS = `
  SELECT ${COLUMNS}
    FROM qf_jarvis.riya_logical_turn_claims
   WHERE tenant_id = $1
     AND conversation_id = $2
     AND (message_id = $3 OR source_turn_digest = $4)
   LIMIT 3
`;

/**
 * Write the durable claim.
 *
 * No `ON CONFLICT`. The caller holds the conversation lock and has already read that no row exists,
 * so a conflict here is a genuine contradiction and must surface as one rather than be absorbed.
 *
 * `created_at` is left to its `clock_timestamp()` default: the database stamps it, not this process.
 */
export const INSERT_PROCESSING_CLAIM = `
  INSERT INTO qf_jarvis.riya_logical_turn_claims
    (tenant_id, conversation_id, message_id, channel, source_turn_digest, turn_identity_digest,
     claim_state)
  VALUES ($1, $2, $3, $4, $5, $6, 'PROCESSING')
`;

/**
 * Finalize a claim, guarded.
 *
 * `WHERE claim_state = 'PROCESSING'` is the guard, and it is what makes the write idempotent in the
 * only direction that matters: a second attempt updates zero rows rather than re-finalizing. The
 * database trigger refuses a terminal-to-terminal move as well, so this holds against any writer.
 *
 * `finalized_at` is `clock_timestamp()`, stamped by the database.
 */
export const FINALIZE_CLAIM = `
  UPDATE qf_jarvis.riya_logical_turn_claims
     SET claim_state = $4,
         finalized_at = clock_timestamp()
   WHERE tenant_id = $1
     AND conversation_id = $2
     AND message_id = $3
     AND claim_state = 'PROCESSING'
`;

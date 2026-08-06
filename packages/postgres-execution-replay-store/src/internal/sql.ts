/**
 * The SQL surface (QFJ-P09.03, ADR-0091).
 *
 * INTERNAL. Two statements, both parameterized and fully schema-qualified — nothing depends on
 * `search_path`, and no identifier is ever interpolated into a statement string.
 *
 * There is no pool here and no configuration: the adapter is handed a `pg` Pool by its caller, who
 * owns its lifecycle. Importing this module connects nowhere and reads no environment.
 */

/**
 * The arbitration write. This statement, alone, decides the race.
 *
 * ### Why `ON CONFLICT DO NOTHING` carries NO conflict target
 *
 * A targeted `ON CONFLICT (execution_intent_id)` would swallow a collision on the intent id and
 * raise `23505` for a collision on `idempotency_key` — so half the races this store exists to
 * arbitrate would arrive as driver exceptions instead of a classifiable answer. The untargeted form
 * skips on ANY unique violation, which is exactly the requirement: BOTH constraints arbitrate, and
 * either one winning produces the same observable result here — zero rows returned.
 *
 * ### Why the classification is NOT in this statement
 *
 * It would be tidier to write one CTE that inserts and then selects the winner. It would also be
 * wrong, and quietly so. `INSERT ... ON CONFLICT DO NOTHING` may WAIT on a concurrent session's
 * uncommitted conflicting row; when that session commits, this statement does nothing — but the
 * statement's own snapshot was taken before the wait, so a sibling `SELECT` branch of the SAME
 * statement is not guaranteed to see the row that just beat it. A classifier built on that would
 * report "no durable row" for the ordinary, correct case of losing a race, and the safest reading
 * of "no row" is the most dangerous answer available here.
 *
 * So this statement does one thing: it either creates the binding or it does not. The reconciliation
 * read below runs afterwards, as a SEPARATE statement with a FRESH snapshot, where the committed
 * winner is guaranteed visible under READ COMMITTED.
 *
 * ### Why there is no transaction around it
 *
 * The INSERT is atomic and self-committing on its own. Wrapping it would hold the new row
 * uncommitted across a network round trip — delaying the durability of the very answer
 * (`first-seen`) whose whole value is that it is durable, and blocking every concurrent claimant on
 * an uncommitted row for the length of that trip. Neither buys any correctness the two statements
 * do not already have.
 *
 * `claimed_at` and `record_version` are left to their column defaults. This package reads no clock:
 * the instant is the server's, and it is audit timing rather than an input to any decision.
 */
export const INSERT_CLAIM = `
  INSERT INTO qf_jarvis.execution_replay_claim
    (execution_intent_id, idempotency_key, body_digest_hex)
  VALUES ($1, $2, $3)
  ON CONFLICT DO NOTHING
  RETURNING execution_intent_id
`;

/**
 * The read-only reconciliation, run ONLY after the arbitration write reported that a durable row
 * won.
 *
 * `OR` rather than `AND`, and that is the whole crossed-conflict case: an incoming claim can collide
 * with the intent id of one row and the idempotency key of a DIFFERENT row. An `AND` would find
 * neither and report a repository invariant for a contradiction that is plainly visible.
 *
 * At most two rows can match — one per unique constraint — so `LIMIT 3` is a defensive bound that
 * still leaves any impossible third row observable rather than silently truncated.
 *
 * This statement writes nothing, locks nothing, and takes no `FOR UPDATE`: a claim row is
 * append-only and can never change after it is written, so there is nothing to protect it from.
 */
export const SELECT_COLLIDING_CLAIMS = `
  SELECT execution_intent_id, idempotency_key, body_digest_hex
    FROM qf_jarvis.execution_replay_claim
   WHERE execution_intent_id = $1
      OR idempotency_key = $2
   LIMIT 3
`;

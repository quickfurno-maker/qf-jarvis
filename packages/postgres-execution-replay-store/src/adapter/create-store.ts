/**
 * The durable execution replay / idempotency store (QFJ-P09.03, ADR-0091).
 *
 * PostgreSQL durability for the guard QFJ-P09.02 deliberately left injected and defaultless.
 *
 * ### What this changes, and what it does not
 *
 * It changes one thing: the replay fact now survives a restart. Before this package the only
 * available `ExecutionReplayGuard` was an in-memory test fake that would pass every test and lose
 * its state on every restart — the exact failure mode that produces a duplicate provider effect.
 *
 * It changes nothing else. There is no transport, no endpoint, no URL, no webhook, no workflow id,
 * no HTTP client, no n8n client, no provider client and no credential. The Core → n8n wire protocol
 * remains PROPOSED: storing a replay claim is not adopting a protocol, because none of the three
 * values stored is a transport artifact. Nothing here is an authority, and nothing imports it.
 *
 * ### The algorithm, and why it is two statements
 *
 * 1. ONE conditional INSERT. Two INDEPENDENT database uniqueness constraints — the primary key on
 *    `execution_intent_id` and the unique on `idempotency_key` — arbitrate the race. The database
 *    decides who won; this process never does.
 * 2. If this call created the row → `first-seen`. It is already committed, so the answer is durable
 *    at the instant it is given.
 * 3. If a durable row won instead, reconcile READ-ONLY in a NEW statement and a fresh snapshot, and
 *    classify what is actually there.
 *
 * Deliberately NOT a pre-read followed by an insert: `SELECT` then `INSERT` is racy, and the race
 * it loses is two callers both being told `first-seen`. Deliberately NOT one clever CTE either —
 * see `internal/sql.ts` for why same-statement snapshot visibility must not become the concurrency
 * proof. There is no retry loop, no advisory lock, no process mutex and no `SERIALIZABLE` (which
 * would create a retry obligation this boundary must not have).
 *
 * ### Uncertainty throws; it never becomes an outcome
 *
 * ADR-0090 §7: an unavailable replay store is exactly when a duplicate is most likely. Every
 * failure below is an exception, which the dispatch boundary converts into
 * `replay-guard-unavailable` and refuses. There is no path from "the database did not answer" to
 * `first-seen`.
 */
import type {
  ExecutionReplayGuard,
  ReplayClaimInput,
  ReplayClaimOutcome,
} from '@qf-jarvis/execution-dispatch-runtime';
import type { Pool, PoolClient } from 'pg';

import { PostgresExecutionReplayStoreError, classifyDatabaseError } from '../contracts/errors.js';
import type {
  PostgresExecutionReplayStore,
  PostgresExecutionReplayStoreConfig,
} from '../contracts/api.js';
import { validateClaim, type ValidatedClaim } from '../internal/claim-input.js';
import { INSERT_CLAIM, SELECT_COLLIDING_CLAIMS } from '../internal/sql.js';

function invariant(): never {
  throw new PostgresExecutionReplayStoreError('repository-invariant');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** One durable row, read back as three primitives. A malformed row is a refusal, not a guess. */
interface StoredClaim {
  readonly executionIntentId: string;
  readonly idempotencyKey: string;
  readonly bodyDigestHex: string;
}

/**
 * Rebuild one stored row.
 *
 * Every row is treated as untrusted structural input. "The CHECK constraints prevent that" is a
 * claim about a schema this process has not verified it is connected to — a partially applied
 * migration, a restore from an older dump or a hand-corrected row all arrive here looking exactly
 * like data. This is durable duplicate-prevention evidence, so a row that cannot be read becomes a
 * refusal rather than a confident classification.
 */
function readStoredClaim(row: unknown): StoredClaim {
  if (!isRecord(row)) {
    return invariant();
  }
  const executionIntentId: unknown = row['execution_intent_id'];
  const idempotencyKey: unknown = row['idempotency_key'];
  const bodyDigestHex: unknown = row['body_digest_hex'];
  if (
    typeof executionIntentId !== 'string' ||
    typeof idempotencyKey !== 'string' ||
    typeof bodyDigestHex !== 'string'
  ) {
    return invariant();
  }
  return { executionIntentId, idempotencyKey, bodyDigestHex };
}

/**
 * Classify what the durable store actually holds, after this caller lost the arbitration write.
 *
 * The three-way split is the whole safety property:
 *
 * - **Exactly one row matching all three values** is an `exact-replay`. It is the only case in
 *   which the store can say "this identical instruction already crossed", and it writes nothing:
 *   no second row, no `claimed_at` refresh, no audit append, no mutation of any kind.
 * - **Two rows** is the crossed collision — the incoming intent id matches one durable row while
 *   the incoming idempotency key matches a different one. A contradiction, so `conflict`.
 * - **One row that does not match all three** is one of the three smuggling routes ADR-0090 §7
 *   names: the same intent under a fresh key, one key reused across intents, or the same id and key
 *   carrying different bytes. All `conflict`.
 *
 * Nothing here repairs, overwrites, merges or picks a winner. A conflict at an execution boundary
 * fails closed; deciding which of two contradictory claims was "meant" is a judgement no storage
 * adapter is entitled to make.
 *
 * **Zero rows is impossible, and is therefore an invariant breach rather than a first-seen.** The
 * arbitration INSERT only reports zero inserted rows once a conflicting row is COMMITTED, and the
 * table is append-only, so the winner cannot have disappeared between the two statements. If it is
 * missing anyway, the store's assumptions about the schema are wrong and refusing is the only safe
 * answer — the tempting one, "nothing is there, so this must be new", would hand out a duplicate.
 */
function classifyCollisions(claim: ValidatedClaim, rows: readonly unknown[]): ReplayClaimOutcome {
  if (rows.length === 0) {
    return invariant();
  }
  // Two unique constraints can produce at most two colliding rows. A third means the uniqueness
  // this store's correctness rests on is not actually present in the database it is talking to.
  if (rows.length > 2) {
    return invariant();
  }
  if (rows.length === 2) {
    // Read both anyway: a structurally unreadable row is an invariant breach even here, and saying
    // `conflict` over evidence that could not be parsed would be a confident answer about nothing.
    readStoredClaim(rows[0]);
    readStoredClaim(rows[1]);
    return 'conflict';
  }

  const stored = readStoredClaim(rows[0]);
  if (
    stored.executionIntentId === claim.executionIntentId &&
    stored.idempotencyKey === claim.idempotencyKey &&
    stored.bodyDigestHex === claim.bodyDigestHex
  ) {
    return 'exact-replay';
  }
  return 'conflict';
}

/**
 * Build a durable execution replay store over an INJECTED pool. The caller owns the pool.
 *
 * Synchronous, and it opens no connection: constructing a store performs no I/O and proves nothing
 * about the database. Readiness is answered where it matters — the first `claim` against a database
 * without migration 0010 raises `schema-incompatible`, which the dispatch boundary turns into
 * `replay-guard-unavailable` and a refusal.
 */
export function createPostgresExecutionReplayStore(
  config: PostgresExecutionReplayStoreConfig,
): PostgresExecutionReplayStore {
  // Typed `unknown` at the check: the declared parameter says a pool is present, but this is a
  // package boundary, and an untyped caller — or a bare Pool passed instead of `{ pool }` — would
  // otherwise reach the first query as `undefined`.
  const supplied: unknown = config;
  if (
    !isRecord(supplied) ||
    supplied['pool'] === undefined ||
    supplied['pool'] === null ||
    typeof (supplied['pool'] as { connect?: unknown }).connect !== 'function'
  ) {
    throw new PostgresExecutionReplayStoreError('invalid-input');
  }
  const pool = supplied['pool'] as Pool;

  async function claim(input: ReplayClaimInput): Promise<ReplayClaimOutcome> {
    // Before any connection is taken. A malformed claim is the caller's defect, and it must not be
    // reported as a database problem or reach the server as a constraint violation.
    const validated = validateClaim(input);

    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (error) {
      throw classifyDatabaseError(error);
    }

    try {
      // 1. The arbitration write. Autocommit: a `first-seen` is durable the moment it is returned.
      const inserted = await client.query(INSERT_CLAIM, [
        validated.executionIntentId,
        validated.idempotencyKey,
        validated.bodyDigestHex,
      ]);

      if (inserted.rowCount === 1) {
        return 'first-seen';
      }
      if (inserted.rowCount !== 0) {
        // One row in, at most one row out. Anything else means the statement did not do what this
        // adapter believes it does, and guessing from there is not available.
        return invariant();
      }

      // 2. A durable row won. Reconcile in a NEW statement, and therefore a NEW snapshot, where the
      //    committed winner is guaranteed visible under READ COMMITTED. Read-only.
      const colliding = await client.query(SELECT_COLLIDING_CLAIMS, [
        validated.executionIntentId,
        validated.idempotencyKey,
      ]);

      return classifyCollisions(validated, colliding.rows);
    } catch (error) {
      // The single classification boundary. No raw driver error, SQL string, constraint name, host,
      // database name, credential or row value escapes past this point.
      throw classifyDatabaseError(error);
    } finally {
      client.release();
    }
  }

  // Frozen, and exactly one method. A caller cannot swap `claim` for something permissive on an
  // object the dispatch boundary has already been handed.
  const store: ExecutionReplayGuard = Object.freeze({ claim });
  return store;
}

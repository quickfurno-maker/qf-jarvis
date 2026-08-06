/**
 * The bounded replay-store error contract (QFJ-P09.03, ADR-0091).
 *
 * Four codes, four fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input, the database, or anything the driver said.
 *
 * ### Why this package throws instead of answering
 *
 * `ExecutionReplayGuard` has a closed set of answers — `first-seen`, `exact-replay`, `conflict` —
 * and there is deliberately no fourth. ADR-0090 §7: a guard that cannot answer must THROW, because
 * the dispatch boundary converts that into `replay-guard-unavailable` and refuses. An unavailable
 * replay store is exactly when a duplicate is most likely, so "assume first seen" is the one answer
 * that must never be reachable. Every failure below is therefore an exception, never an outcome.
 *
 * ### Why the driver error is classified and then discarded
 *
 * A `pg` error carries the failing SQL, the constraint and table names, the column, the bound
 * parameter values, the host and often the database user. The parameters this adapter binds are an
 * execution intent id, an idempotency key and a body digest — identifiers a hostile caller supplied
 * moments earlier at an authentication boundary. Reflecting a driver error upward would turn a
 * transient connection failure into a simultaneous schema disclosure and an oracle telling a prober
 * exactly which of their identifiers already exists. So the driver error is CLASSIFIED and dropped.
 *
 * ### There is no retryable code, on purpose
 *
 * `40001` and `40P01` are retryable *in principle*. This adapter does not retry and offers no code
 * that invites a caller to: ADR-0090 §7 — a retry inside a boundary that has already authenticated
 * an instruction is how one instruction becomes two effects.
 */
const POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODE_VALUES = [
  /** The supplied claim or configuration is not valid. Nothing was written. */
  'invalid-input',
  /** The database could not be reached, or the server aborted the statement. */
  'database-unavailable',
  /** The database is missing an object this adapter requires. Migration 0010 is not applied. */
  'schema-incompatible',
  /** Durable evidence contradicted itself. Trusting it would be worse than refusing. */
  'repository-invariant',
] as const;

export type PostgresExecutionReplayStoreErrorCode =
  (typeof POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODE_VALUES)[number];

export const POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODES: readonly PostgresExecutionReplayStoreErrorCode[] =
  Object.freeze([...POSTGRES_EXECUTION_REPLAY_STORE_ERROR_CODE_VALUES]);

/**
 * The fixed message per code. Content-free, identifier-free and stable.
 *
 * No message names an execution intent id, an idempotency key, a digest, a table, a column, a
 * constraint, a host or a database. A spec asserts exactly that.
 */
const MESSAGES: Readonly<Record<PostgresExecutionReplayStoreErrorCode, string>> = Object.freeze({
  'invalid-input': 'An execution replay claim is invalid.',
  'database-unavailable': 'The execution replay store is unavailable.',
  'schema-incompatible': 'The execution replay store schema is incompatible.',
  'repository-invariant': 'A stored execution replay claim is inconsistent.',
});

/** A bounded replay-store error. The code is the contract; the message is fixed per code. */
export class PostgresExecutionReplayStoreError extends Error {
  readonly code: PostgresExecutionReplayStoreErrorCode;

  constructor(code: PostgresExecutionReplayStoreErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PostgresExecutionReplayStoreError';
    this.code = code;
  }
}

/**
 * SQLSTATE classes that mean "the database, not the request".
 *
 * `08*` connection exception, `53*` insufficient resources, `57P0*` admin shutdown, `40001`
 * serialization failure and `40P01` deadlock. The last two are classified as unavailable rather
 * than retried — see the note above.
 */
function isUnavailableSqlState(code: string): boolean {
  return (
    code.startsWith('08') ||
    code.startsWith('53') ||
    code.startsWith('57P0') ||
    code === '40001' ||
    code === '40P01'
  );
}

/** SQLSTATEs that mean the schema or the grants are not the ones this adapter expects. */
function isSchemaSqlState(code: string): boolean {
  // 42P01 undefined_table (migration 0010 not applied), 42703 undefined_column, 42883
  // undefined_function, 42501 insufficient_privilege — a principal refused permission has the wrong
  // GRANTS, which is the same class of problem as a missing column and not corrupt data.
  return code === '42P01' || code === '42703' || code === '42883' || code === '42501';
}

/**
 * Is this `code` actually a SQLSTATE, or a Node socket errno wearing the same property name?
 *
 * `pg` puts the server's five-character SQLSTATE on `error.code` — but a connection that never
 * reached a server carries a Node errno there instead (`ECONNREFUSED`, `EPIPE`). Treating an errno
 * as a server rejection would report corrupt durable evidence when nothing was ever reached, which
 * is the opposite of the truth. (The rule established by `@qf-jarvis/postgres-conversation-state`
 * and `@qf-jarvis/postgres-approval-queue`.)
 */
function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(value);
}

/**
 * Classify an unknown thrown value into one bounded code, discarding everything else.
 *
 * An error this adapter raised itself passes through unchanged — it already carries a bounded code,
 * and re-classifying it would lose the more specific answer. Everything else is reduced by SQLSTATE
 * alone; the driver's message, detail, table, constraint, column, parameters and stack are never
 * read into the result.
 */
export function classifyDatabaseError(error: unknown): PostgresExecutionReplayStoreError {
  if (error instanceof PostgresExecutionReplayStoreError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (isSqlState(code)) {
    if (isUnavailableSqlState(code)) {
      return new PostgresExecutionReplayStoreError('database-unavailable');
    }
    if (isSchemaSqlState(code)) {
      return new PostgresExecutionReplayStoreError('schema-incompatible');
    }
    // Anything else the server rejected — a CHECK, the append-only trigger, or a unique violation
    // this adapter did not anticipate — means the durable evidence and this adapter disagree about
    // what is representable. An invariant breach, not a transient fault.
    //
    // A unique violation reaching here is itself notable: the arbitration INSERT uses
    // `ON CONFLICT DO NOTHING`, so a lawful race never raises `23505`. One that does means a
    // constraint exists that this adapter does not know about.
    return new PostgresExecutionReplayStoreError('repository-invariant');
  }
  return new PostgresExecutionReplayStoreError('database-unavailable');
}

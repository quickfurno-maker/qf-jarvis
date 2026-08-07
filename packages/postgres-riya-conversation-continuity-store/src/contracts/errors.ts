/**
 * The bounded adapter error contract (RWC-P2B, ADR-0095).
 *
 * Four codes, four fixed messages. The message is a CONSTANT chosen by the code and never built from
 * the input, from a row or from anything the driver said.
 *
 * That discipline matters especially here. A `pg` error carries the failing SQL, the constraint and
 * table names, the column, the parameter values, the host and often the database user -- and the
 * parameter values at this boundary are a tenant id, a conversation id and a NeedDiscovery snapshot
 * describing somebody's home. Passing a driver error upward would turn a transient connection
 * failure into a disclosure of both the schema and a client's project. So the driver error is
 * CLASSIFIED and then discarded: the code says which of four things went wrong, which is what a
 * caller needs, and nothing further.
 */
const POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODE_VALUES = [
  /** The supplied key or state is not valid. Nothing was sent to the database. */
  'invalid-input',
  /**
   * Durable evidence contradicted itself, or a stored row could not pass the canonical contract.
   * Trusting it would be worse than refusing, and repairing it is not this adapter's authority.
   */
  'repository-invariant',
  /** The database could not be reached, or the server aborted the statement. Nothing is known. */
  'store-unavailable',
  /** The database is missing an object this adapter requires. Migration 0011 has not been applied. */
  'schema-incompatible',
] as const;

export type PostgresRiyaContinuityStoreErrorCode =
  (typeof POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODE_VALUES)[number];

export const POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODES: readonly PostgresRiyaContinuityStoreErrorCode[] =
  Object.freeze([...POSTGRES_RIYA_CONTINUITY_STORE_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable -- asserted by the spec. */
const MESSAGES: Readonly<Record<PostgresRiyaContinuityStoreErrorCode, string>> = Object.freeze({
  'invalid-input': 'A continuity store request is invalid.',
  'repository-invariant': 'A stored continuity record is inconsistent.',
  'store-unavailable': 'The continuity store is unavailable.',
  'schema-incompatible': 'The continuity store schema is incompatible.',
});

/** A bounded adapter error. The code is the contract; the message is fixed per code. */
export class PostgresRiyaContinuityStoreError extends Error {
  readonly code: PostgresRiyaContinuityStoreErrorCode;

  constructor(code: PostgresRiyaContinuityStoreErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PostgresRiyaContinuityStoreError';
    this.code = code;
  }
}

/**
 * SQLSTATE classes that mean "the database, not the request".
 *
 * `08*` connection exception, `53*` insufficient resources, `57P0*` admin shutdown / cannot connect,
 * `40001` serialization failure and `40P01` deadlock. The last two are retryable *in principle*, and
 * this adapter deliberately does not retry: a compare-and-set carries an intent at an exact revision,
 * and silently re-running it is how one intent becomes two effects. The caller decides.
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

/**
 * SQLSTATEs that mean the schema is not the one this adapter was written against.
 *
 * `42P01` undefined_table, `42703` undefined_column, `42883` undefined_function -- and `42501`
 * insufficient_privilege. A principal refused permission on its own table has not hit a transient
 * fault and has not found contradictory data: it is connected to a database whose GRANTS are not the
 * ones migration 0011 issues. A caller reading `repository-invariant` would go looking for a corrupt
 * row instead of a deployment misconfiguration.
 */
function isSchemaSqlState(code: string): boolean {
  return code === '42P01' || code === '42703' || code === '42883' || code === '42501';
}

/**
 * Is this `code` actually a SQLSTATE, or a Node socket errno wearing the same property name?
 *
 * `pg` puts the server's five-character SQLSTATE on `error.code` -- but a connection that never
 * reached a server carries a Node errno there instead (`ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`). Both
 * are strings on `.code`, and treating an errno as a SQLSTATE sends it down the "the server rejected
 * this" branch, where it would become `repository-invariant`: the adapter would report corrupt
 * durable evidence when in fact nothing was ever reached. That is the opposite of the truth, and it
 * is the one misclassification an operator would act on incorrectly.
 *
 * Every PostgreSQL SQLSTATE is five characters whose two-character class begins with a digit, apart
 * from the classes `F0`, `HV`, `P0` and `XX`. `EPIPE` is five characters and would pass a naive
 * length check; it does not pass this one.
 */
function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(value);
}

/**
 * Classify an unknown thrown value into one bounded code, discarding everything else.
 *
 * An error this adapter raised itself passes through unchanged -- it already carries a bounded code
 * and re-classifying it would lose the more specific answer. Everything else is reduced to a code by
 * SQLSTATE alone; the driver's message, detail, table, constraint, column, parameters and stack are
 * never read into the result.
 *
 * The default is `store-unavailable`, not `repository-invariant`. An unclassifiable throw means this
 * adapter does not know what happened, and "the store did not answer" is the honest reading of not
 * knowing -- claiming a durable contradiction would assert a fact about data nobody observed.
 */
export function classifyDatabaseError(error: unknown): PostgresRiyaContinuityStoreError {
  if (error instanceof PostgresRiyaContinuityStoreError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (isSqlState(code)) {
    if (isUnavailableSqlState(code)) {
      return new PostgresRiyaContinuityStoreError('store-unavailable');
    }
    if (isSchemaSqlState(code)) {
      return new PostgresRiyaContinuityStoreError('schema-incompatible');
    }
    // Anything else the server rejected -- a CHECK, a trigger, a foreign key -- means the durable
    // evidence and this adapter disagree about what is representable. That is an invariant breach,
    // not a transient fault, and it must not be retried or reinterpreted.
    return new PostgresRiyaContinuityStoreError('repository-invariant');
  }
  return new PostgresRiyaContinuityStoreError('store-unavailable');
}

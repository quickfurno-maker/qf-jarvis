/**
 * The bounded coordinator error contract (RWC-P8, ADR-0104).
 *
 * Three codes, three fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input, from a row or from anything the driver said.
 *
 * That discipline matters especially here. A `pg` error carries the failing SQL, the constraint and
 * table names, the column, the parameter values, the host and often the database user — and the
 * parameters at this boundary are a tenant, a conversation and a message identity. Passing a driver
 * error upward would turn a transient connection failure into a disclosure of both the schema and a
 * client's conversation. So the driver error is CLASSIFIED and then discarded.
 */
const POSTGRES_RIYA_TURN_COORDINATOR_ERROR_CODE_VALUES = [
  /** The supplied begin input is not valid. Nothing was sent to the database. */
  'invalid-input',
  /**
   * Durable evidence contradicted itself — two claim rows that cannot both be true, or a row this
   * coordinator could never have written. Trusting it would be worse than refusing.
   */
  'repository-invariant',
  /** The database could not be reached, or the server aborted the statement. Nothing is known. */
  'coordinator-unavailable',
  /** The database is missing an object this coordinator requires. Migration 0012 is not applied. */
  'schema-incompatible',
] as const;

export type PostgresRiyaTurnCoordinatorErrorCode =
  (typeof POSTGRES_RIYA_TURN_COORDINATOR_ERROR_CODE_VALUES)[number];

export const POSTGRES_RIYA_TURN_COORDINATOR_ERROR_CODES: readonly PostgresRiyaTurnCoordinatorErrorCode[] =
  Object.freeze([...POSTGRES_RIYA_TURN_COORDINATOR_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<PostgresRiyaTurnCoordinatorErrorCode, string>> = Object.freeze({
  'invalid-input': 'A Riya turn coordination request is invalid.',
  'repository-invariant': 'A recorded Riya turn claim is inconsistent.',
  'coordinator-unavailable': 'The Riya turn coordinator is unavailable.',
  'schema-incompatible': 'The Riya turn coordinator schema is incompatible.',
});

/** A bounded coordinator error. The code is the contract; the message is fixed per code. */
export class PostgresRiyaTurnCoordinatorError extends Error {
  readonly code: PostgresRiyaTurnCoordinatorErrorCode;

  constructor(code: PostgresRiyaTurnCoordinatorErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PostgresRiyaTurnCoordinatorError';
    this.code = code;
  }
}

const SQLSTATE = /^[0-9A-Z]{5}$/u;

function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && SQLSTATE.test(value);
}

/**
 * SQLSTATE classes that mean "the database, not the request".
 *
 * `08*` connection exception, `53*` insufficient resources, `57P0*` admin shutdown, `40001`
 * serialization failure and `40P01` deadlock. The last two are retryable *in principle*, and this
 * coordinator deliberately does not retry: every write here is part of deciding whether one real
 * conversation turn may run, and silently re-running one is how a single message becomes two.
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

/** `3D*`/`3F*` invalid database or schema, `42P01` undefined table, `42703` undefined column. */
function isSchemaSqlState(code: string): boolean {
  return code.startsWith('3D') || code.startsWith('3F') || code === '42P01' || code === '42703';
}

/**
 * Reduce anything thrown to one bounded code.
 *
 * The default is `coordinator-unavailable`, not `repository-invariant`. An unclassifiable throw means
 * this coordinator does not know what happened, and "it did not answer" is the honest reading of not
 * knowing — claiming a durable contradiction would assert a fact about data nobody observed. It is
 * also the safer default: an unavailable coordinator fails the turn closed, while an invariant claim
 * might invite somebody to go and "fix" a row.
 */
export function classifyDatabaseError(error: unknown): PostgresRiyaTurnCoordinatorError {
  if (error instanceof PostgresRiyaTurnCoordinatorError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (isSqlState(code)) {
    if (isUnavailableSqlState(code)) {
      return new PostgresRiyaTurnCoordinatorError('coordinator-unavailable');
    }
    if (isSchemaSqlState(code)) {
      return new PostgresRiyaTurnCoordinatorError('schema-incompatible');
    }
    // Anything else the server rejected -- a CHECK, the lifecycle trigger, the unique index -- means
    // the durable evidence and this coordinator disagree about what is representable.
    return new PostgresRiyaTurnCoordinatorError('repository-invariant');
  }
  return new PostgresRiyaTurnCoordinatorError('coordinator-unavailable');
}

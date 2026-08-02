/**
 * The bounded adapter error contract (QFJ-P08-B2, ADR-0077).
 *
 * Seven codes, seven fixed messages. The message is a CONSTANT chosen by the code and never built
 * from the input or from anything the driver said.
 *
 * That matters more here than anywhere else in the repository. A `pg` error carries the failing SQL,
 * the constraint and table names, the column, the parameter values, the host and often the database
 * user — and this adapter handles operator identities and conversation ids. Passing a driver error
 * upward would turn a transient connection failure into a schema-and-identity disclosure. So the
 * driver error is CLASSIFIED and then discarded: the code says which of seven things went wrong,
 * which is what a caller needs, and nothing further.
 */
const POSTGRES_CONVERSATION_STATE_ERROR_CODE_VALUES = [
  /** The supplied key, command or provisioning input is not valid. Nothing was sent to the database. */
  'invalid-input',
  /** No authoritative row exists for this (tenant, conversation). It is never lazily created. */
  'state-not-found',
  /** A row exists whose Core-derived facts differ from the ones offered. Nothing was mutated. */
  'provisioning-conflict',
  /** This (tenant, commandId) already names a DIFFERENT command. Zero effect, fail closed. */
  'command-conflict',
  /** Durable evidence contradicted itself. Trusting it would be worse than refusing. */
  'repository-invariant',
  /** The database could not be reached, or the transaction was aborted by the server. */
  'database-unavailable',
  /** The database is missing an object this adapter requires. Migration 0008 has not been applied. */
  'schema-incompatible',
] as const;
export type PostgresConversationStateErrorCode =
  (typeof POSTGRES_CONVERSATION_STATE_ERROR_CODE_VALUES)[number];

export const POSTGRES_CONVERSATION_STATE_ERROR_CODES: readonly PostgresConversationStateErrorCode[] =
  Object.freeze([...POSTGRES_CONVERSATION_STATE_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<PostgresConversationStateErrorCode, string>> = Object.freeze({
  'invalid-input': 'A conversation-state request is invalid.',
  'state-not-found': 'No conversation runtime state exists for this key.',
  'provisioning-conflict': 'A conversation runtime state already exists with different facts.',
  'command-conflict': 'This command identity already names a different command.',
  'repository-invariant': 'A stored conversation-state record is inconsistent.',
  'database-unavailable': 'The conversation-state database is unavailable.',
  'schema-incompatible': 'The conversation-state schema is incompatible.',
});

/** A bounded adapter error. The code is the contract; the message is fixed per code. */
export class PostgresConversationStateError extends Error {
  readonly code: PostgresConversationStateErrorCode;

  constructor(code: PostgresConversationStateErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PostgresConversationStateError';
    this.code = code;
  }
}

/**
 * SQLSTATE classes that mean "the database, not the request".
 *
 * `08*` connection exception, `53*` insufficient resources, `57P0*` admin shutdown / cannot connect,
 * `40001` serialization failure and `40P01` deadlock. The last two are retryable *in principle*, and
 * this adapter deliberately does not retry: a control command carries an operator's intent at an
 * exact revision, and silently re-running it is how one intent becomes two effects. The caller
 * decides whether to reissue.
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
 * `42P01` undefined_table, `42703` undefined_column, `42883` undefined_function — and `42501`
 * insufficient_privilege, which belongs here rather than with the invariant breaches (QFJ-P08-B3).
 * A principal refused permission on its own tables has not encountered a transient fault and has not
 * found contradictory data: it is connected to a database whose GRANTS are not the ones migration
 * 0008 issues. That is the same class of problem as a missing column, and a caller that reads
 * `repository-invariant` would go looking for corrupt rows instead of a deployment misconfiguration.
 */
function isSchemaSqlState(code: string): boolean {
  return code === '42P01' || code === '42703' || code === '42883' || code === '42501';
}

/**
 * Is this `code` actually a SQLSTATE, or a Node socket errno wearing the same property name?
 *
 * `pg` puts the server's five-character SQLSTATE on `error.code` — but a connection that never
 * reached a server carries a Node errno there instead (`ECONNREFUSED`, `ETIMEDOUT`, `EPIPE`). Both
 * are strings on `.code`, and treating an errno as a SQLSTATE sends it down the "the server rejected
 * this" branch, where it becomes `repository-invariant`: the adapter would report corrupt durable
 * evidence when in fact nothing was ever reached. That is the opposite of the truth, and it is the
 * one misclassification an operator would act on incorrectly.
 *
 * Every PostgreSQL SQLSTATE is five characters whose two-character class begins with a digit, apart
 * from the classes `F0`, `HV`, `P0` and `XX`. `EPIPE` is five characters and would pass a naive
 * length check; it does not pass this one. (QFJ-P08-B3.)
 */
function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(value);
}

/**
 * Classify an unknown thrown value into one bounded code, discarding everything else.
 *
 * An error this adapter raised itself passes through unchanged — it already carries a bounded code
 * and re-classifying it would lose the more specific answer. Everything else is reduced to a code by
 * SQLSTATE alone; the driver's message, detail, table, constraint, column, parameters and stack are
 * never read into the result.
 */
export function classifyDatabaseError(error: unknown): PostgresConversationStateError {
  if (error instanceof PostgresConversationStateError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const sqlState: unknown = isSqlState(code) ? code : undefined;
  if (typeof sqlState === 'string') {
    if (isUnavailableSqlState(sqlState)) {
      return new PostgresConversationStateError('database-unavailable');
    }
    if (isSchemaSqlState(sqlState)) {
      return new PostgresConversationStateError('schema-incompatible');
    }
    // Anything else the server rejected — a CHECK, a trigger, a foreign key — means the durable
    // evidence and this adapter disagree about what is representable. That is an invariant breach,
    // not a transient fault, and it must not be retried or reinterpreted.
    return new PostgresConversationStateError('repository-invariant');
  }
  return new PostgresConversationStateError('database-unavailable');
}

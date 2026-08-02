/**
 * The bounded queue error contract (QFJ-P08, ADR-0081).
 *
 * Ten codes, ten fixed messages. The message is a CONSTANT chosen by the code and never built from
 * the input, the database, or anything the driver said.
 *
 * That matters more here than almost anywhere else. A `pg` error carries the failing SQL, the
 * constraint and table names, the column, the parameter values, the host and often the database
 * user — and the parameters this adapter binds include an approval request's summary, a policy
 * citation, an operator's identity inside a Core decision, and a recommendation's rationale and
 * evidence. Passing a driver error upward would turn a transient connection failure into a
 * simultaneous schema, identity and business-content disclosure. So the driver error is CLASSIFIED
 * and then discarded.
 *
 * The three conflict codes are distinguished deliberately, because each sends an operator somewhere
 * different: `request-conflict` means the same request id was reused for a different ask;
 * `active-request-conflict` means an unanswered ask for that action is still open;
 * `request-already-decided` means Core has already answered this one.
 */
const POSTGRES_APPROVAL_QUEUE_ERROR_CODE_VALUES = [
  /** The supplied input is not valid. Nothing was written. */
  'invalid-input',
  /** This approval request id already names a DIFFERENT ask. Zero effect, fail closed. */
  'request-conflict',
  /** An unanswered, unexpired ask for this (recommendation, action) is still outstanding. */
  'active-request-conflict',
  /** No stored request exists for this approval request id. */
  'request-not-found',
  /** This decision id already names a DIFFERENT decision. Zero effect, fail closed. */
  'decision-conflict',
  /** This request has already been answered, by a different decision. */
  'request-already-decided',
  /** The supplied request is not a faithful ask about the supplied source. */
  'binding-invalid',
  /** The database could not be reached, or the transaction was aborted by the server. */
  'database-unavailable',
  /** The database is missing an object this adapter requires. Migration 0009 is not applied. */
  'schema-incompatible',
  /** Durable evidence contradicted itself. Trusting it would be worse than refusing. */
  'repository-invariant',
] as const;

export type PostgresApprovalQueueErrorCode =
  (typeof POSTGRES_APPROVAL_QUEUE_ERROR_CODE_VALUES)[number];

export const POSTGRES_APPROVAL_QUEUE_ERROR_CODES: readonly PostgresApprovalQueueErrorCode[] =
  Object.freeze([...POSTGRES_APPROVAL_QUEUE_ERROR_CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<PostgresApprovalQueueErrorCode, string>> = Object.freeze({
  'invalid-input': 'An approval queue request is invalid.',
  'request-conflict': 'This approval request identity already names a different request.',
  'active-request-conflict': 'An active approval request already exists for this action.',
  'request-not-found': 'No approval request exists for this identity.',
  'decision-conflict': 'This decision identity already names a different decision.',
  'request-already-decided': 'This approval request has already been decided.',
  'binding-invalid': 'The approval request does not match its recommendation source.',
  'database-unavailable': 'The approval queue database is unavailable.',
  'schema-incompatible': 'The approval queue schema is incompatible.',
  'repository-invariant': 'A stored approval queue record is inconsistent.',
});

/** A bounded queue error. The code is the contract; the message is fixed per code. */
export class PostgresApprovalQueueError extends Error {
  readonly code: PostgresApprovalQueueErrorCode;

  constructor(code: PostgresApprovalQueueErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PostgresApprovalQueueError';
    this.code = code;
  }
}

/**
 * SQLSTATE classes that mean "the database, not the request".
 *
 * `08*` connection exception, `53*` insufficient resources, `57P0*` admin shutdown, `40001`
 * serialization failure and `40P01` deadlock. The last two are retryable *in principle*, and this
 * adapter deliberately does not retry: an approval ask carries an operator's intent at an exact
 * instant, and silently re-running it is how one ask becomes two.
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
  // 42P01 undefined_table, 42703 undefined_column, 42883 undefined_function, 42501
  // insufficient_privilege — a principal refused permission has the wrong GRANTS, which is the same
  // class of problem as a missing column and not a corrupt-data problem.
  return code === '42P01' || code === '42703' || code === '42883' || code === '42501';
}

/**
 * Is this `code` actually a SQLSTATE, or a Node socket errno wearing the same property name?
 *
 * `pg` puts the server's five-character SQLSTATE on `error.code` — but a connection that never
 * reached a server carries a Node errno there instead (`ECONNREFUSED`, `EPIPE`). Treating an errno
 * as a server rejection reports corrupt durable evidence when nothing was ever reached, which is the
 * opposite of the truth. (The same rule as `@qf-jarvis/postgres-conversation-state`, learned there.)
 */
function isSqlState(value: unknown): value is string {
  return typeof value === 'string' && /^([0-9][0-9A-Z]|F0|HV|P0|XX)[0-9A-Z]{3}$/.test(value);
}

/**
 * Classify an unknown thrown value into one bounded code, discarding everything else.
 *
 * An error this adapter raised itself passes through unchanged — it already carries a bounded code
 * and re-classifying it would lose the more specific answer. Everything else is reduced by SQLSTATE
 * alone; the driver's message, detail, table, constraint, column, parameters and stack are never
 * read into the result.
 */
export function classifyDatabaseError(error: unknown): PostgresApprovalQueueError {
  if (error instanceof PostgresApprovalQueueError) {
    return error;
  }
  const code: unknown =
    typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (isSqlState(code)) {
    if (isUnavailableSqlState(code)) {
      return new PostgresApprovalQueueError('database-unavailable');
    }
    if (isSchemaSqlState(code)) {
      return new PostgresApprovalQueueError('schema-incompatible');
    }
    // Anything else the server rejected — a CHECK, a trigger, a foreign key, a unique violation
    // this adapter did not anticipate — means the durable evidence and this adapter disagree about
    // what is representable. An invariant breach, not a transient fault.
    return new PostgresApprovalQueueError('repository-invariant');
  }
  return new PostgresApprovalQueueError('database-unavailable');
}

/**
 * The closed, repository-owned projection FAILURE TAXONOMY (Stage QFJ-P03.07B, ADR-0040).
 *
 * A projection handler failure is classified into exactly ONE of five closed categories. This module
 * is the single authority for that classification and for the explicit repository-owned mechanisms a
 * handler uses to DECLARE a deterministic failure, a repository-invariant failure, or a cancellation.
 *
 * **The required correction (ADR-0040 § Canonical categories).** The pre-P03.07B runner treated a
 * plain `Error` with no recognised SQLSTATE — an *absent* code — as a DETERMINISTIC handler failure,
 * so an ordinary bug (a `TypeError`, an assertion, an OOM-adjacent throw) was consumed as a bounded
 * retry attempt and could drive a projection to `blocked`. That is wrong: a value that cannot be
 * PROVEN deterministic must NOT be treated as deterministic. Under this taxonomy an absent-code /
 * ordinary error is `UNKNOWN_UNCLASSIFIED_FAILURE` — it fails closed, records no attempt, and never
 * progresses retry exhaustion.
 *
 * **Hostile-safe by construction.** Classification NEVER invokes a caller getter, `valueOf`,
 * `toString`, or any other caller method; it never throws while classifying; and it never lets a raw
 * thrown value, stack, message, SQL, secret, or payload cross the boundary. The classification result
 * carries only a closed category, a closed repository-owned diagnostic code, a fail-closed/retry
 * disposition, and a recognised 5-character SQLSTATE when (and only when) one is safely present.
 *
 * Nothing here is exported from the package root; the barrel's 39-symbol runtime surface is unchanged.
 */

import { ProjectionSafeErrorCodeError } from './projection-safe-error.js';

// --- The five closed categories ------------------------------------------------------------------

/** The closed, exhaustive projection-failure category vocabulary. */
export const PROJECTION_FAILURE_CATEGORIES = [
  'DETERMINISTIC_HANDLER_FAILURE',
  'TRANSIENT_INFRASTRUCTURE_FAILURE',
  'REPOSITORY_INVARIANT_FAILURE',
  'CANCELLATION_OR_SHUTDOWN',
  'UNKNOWN_UNCLASSIFIED_FAILURE',
] as const;

/** Exactly one projection-failure category. */
export type ProjectionFailureCategory = (typeof PROJECTION_FAILURE_CATEGORIES)[number];

/** True iff `value` is one of the five closed categories. */
export function isProjectionFailureCategory(value: unknown): value is ProjectionFailureCategory {
  return (
    typeof value === 'string' &&
    (PROJECTION_FAILURE_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The closed, repository-owned diagnostic code for each category (never caller-derived text). */
export const PROJECTION_FAILURE_DIAGNOSTIC_CODES = Object.freeze({
  DETERMINISTIC_HANDLER_FAILURE: 'projection-handler-failed',
  TRANSIENT_INFRASTRUCTURE_FAILURE: 'projection-infrastructure-failed',
  REPOSITORY_INVARIANT_FAILURE: 'projection-repository-invariant-failed',
  CANCELLATION_OR_SHUTDOWN: 'projection-cancelled',
  UNKNOWN_UNCLASSIFIED_FAILURE: 'projection-unknown-failure',
} as const);

/** One closed diagnostic code. */
export type ProjectionFailureDiagnosticCode =
  (typeof PROJECTION_FAILURE_DIAGNOSTIC_CODES)[ProjectionFailureCategory];

/** A retryable deterministic failure consumes a bounded attempt; everything else fails closed. */
export type ProjectionFailureDisposition = 'retry' | 'fail-closed';

/**
 * The normalized, immutable classification. It carries ONLY the minimum safe fields the runner needs:
 * the closed category, the closed diagnostic code, the disposition, and the recognised SQLSTATE (a
 * bounded 5-char `[0-9A-Z]` string) when one is safely present — never a raw thrown value, message,
 * stack, SQL, secret, or payload.
 */
export interface ProjectionFailureClassification {
  readonly category: ProjectionFailureCategory;
  readonly code: ProjectionFailureDiagnosticCode;
  readonly disposition: ProjectionFailureDisposition;
  readonly sqlstate: string | null;
}

function classification(
  category: ProjectionFailureCategory,
  sqlstate: string | null,
): ProjectionFailureClassification {
  return Object.freeze({
    category,
    code: PROJECTION_FAILURE_DIAGNOSTIC_CODES[category],
    disposition: category === 'DETERMINISTIC_HANDLER_FAILURE' ? 'retry' : 'fail-closed',
    sqlstate,
  });
}

// --- Hostile-safe own-property inspection --------------------------------------------------------

/**
 * Read an own DATA property `key` from `value` WITHOUT ever invoking a getter, `valueOf`, `toString`,
 * or any caller method. `getOwnPropertyDescriptor` is itself guarded (a revoked Proxy or a hostile
 * descriptor trap can throw); any throw is swallowed and reported as "absent". Returns the captured
 * data value, or a sentinel when the key is absent or is an accessor (its getter is never called).
 */
const ABSENT = Symbol('projection-failure-taxonomy.absent');
function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return ABSENT;
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return ABSENT; // revoked Proxy or hostile trap
  }
  if (descriptor === undefined || !('value' in descriptor)) {
    return ABSENT; // absent, or an accessor whose getter must never run
  }
  return descriptor.value;
}

/** True iff `value` carries an own DATA property `brand` whose value is the boolean `true`. */
function hasTrueBrand(value: unknown, brand: symbol): boolean {
  return readOwnDataProperty(value, brand) === true;
}

/** True iff `value` carries an own DATA `name` property equal to `expected` (getter never invoked). */
function hasOwnName(value: unknown, expected: string): boolean {
  return readOwnDataProperty(value, 'name') === expected;
}

// --- SQLSTATE inspection (closed tri-state) ------------------------------------------------------

/**
 * A closed, tri-state inspection of a caught value's own `code`. ABSENT (no own code) is materially
 * different from UNREADABLE (an accessor, a non-string, a malformed string, or an inspection that
 * threw): the former is an ordinary/unknown error, the latter is conservative infrastructure.
 */
export type SqlstateInspection =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly code: string }
  | { readonly kind: 'invalid' };

/** A well-formed SQLSTATE is EXACTLY five characters from `[0-9A-Z]` (digits and UPPERCASE letters). */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * Inspect a caught value's own `code` WITHOUT invoking a getter, `valueOf`, or `toString`. An accessor
 * `code` is `invalid` (its getter is never called); a non-object/function primitive is `absent`; a
 * hostile descriptor trap or revoked Proxy is `invalid`.
 */
export function inspectSqlstate(error: unknown): SqlstateInspection {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
    return { kind: 'absent' };
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(error, 'code');
  } catch {
    return { kind: 'invalid' };
  }
  if (descriptor === undefined) {
    return { kind: 'absent' };
  }
  if (!('value' in descriptor)) {
    return { kind: 'invalid' }; // accessor: getter never invoked
  }
  const value: unknown = descriptor.value;
  if (typeof value !== 'string' || !SQLSTATE_PATTERN.test(value)) {
    return { kind: 'invalid' };
  }
  return { kind: 'valid', code: value };
}

/** The recognised DETERMINISTIC handler-side SQLSTATEs (ADR-0040 classification table). */
export function isDeterministicHandlerSqlstate(code: string): boolean {
  return (
    code === '23505' || // unique_violation
    code === '23514' || // check_violation
    code === '23503' || // foreign_key_violation
    code === '23502' || // not_null_violation
    code.startsWith('22') || // data exceptions (class 22)
    code === '42501' || // insufficient_privilege
    code === '42P01' || // undefined_table
    code === '42703' || // undefined_column
    code === '42883' // undefined_function
  );
}

/** The recognised TRANSIENT INFRASTRUCTURE SQLSTATEs (ADR-0040 classification table). */
export function isRecognizedInfrastructureSqlstate(code: string): boolean {
  return (
    code === '40P01' || // deadlock_detected
    code === '40001' || // serialization_failure
    code.startsWith('08') || // connection exception (class 08)
    code.startsWith('57P0') || // operator intervention (57P0*)
    code.startsWith('53') // insufficient resources (class 53)
  );
}

// --- Explicit repository-owned failure contracts -------------------------------------------------

/** Bound a caller-supplied detail to a sanitized, length-capped ASCII string, or drop it entirely. */
const MAX_FAILURE_DETAIL_LENGTH = 200;
function sanitizeDetail(detail: unknown): string | undefined {
  if (typeof detail !== 'string' || detail.length === 0) {
    return undefined;
  }
  // Keep only printable ASCII (space..~), drop everything else, and cap the length. This is a
  // best-effort convenience field for the handler author; it is NEVER stored durably and NEVER
  // propagated into the classification result.
  const cleaned = detail.replace(/[^\x20-\x7e]/g, '').slice(0, MAX_FAILURE_DETAIL_LENGTH);
  return cleaned.length === 0 ? undefined : cleaned;
}

const DETERMINISTIC_HANDLER_FAILURE_BRAND = Symbol('projection-deterministic-handler-failure');
const REPOSITORY_INVARIANT_FAILURE_BRAND = Symbol('projection-repository-invariant-failure');
const CANCELLATION_BRAND = Symbol('projection-cancellation-or-shutdown');

/**
 * The explicit, repository-owned way a projection handler DECLARES a deterministic failure — a
 * refusal that will reproduce for the same handler version and event, and so is eligible for the
 * bounded deterministic-retry path. A plain `Error` is NOT deterministic; a handler must throw this
 * (or fail with a recognised deterministic SQLSTATE) to be treated deterministically.
 */
export class ProjectionDeterministicHandlerFailure extends Error {
  public readonly code = 'projection-handler-failed' as const;
  /** A bounded, sanitized, in-memory convenience field. Never stored durably, never classified. */
  public readonly detail: string | undefined;
  public readonly [DETERMINISTIC_HANDLER_FAILURE_BRAND] = true;

  public constructor(detail?: string) {
    super('A projection handler deterministically refused the event.');
    this.name = 'ProjectionDeterministicHandlerFailure';
    this.detail = sanitizeDetail(detail);
  }
}

/** Construct a deterministic handler failure (the approved factory). */
export function deterministicHandlerFailure(
  detail?: string,
): ProjectionDeterministicHandlerFailure {
  return new ProjectionDeterministicHandlerFailure(detail);
}

/** True iff `value` is a genuine deterministic-handler-failure declaration (hostile-safe brand read). */
export function isDeterministicHandlerFailure(value: unknown): boolean {
  return hasTrueBrand(value, DETERMINISTIC_HANDLER_FAILURE_BRAND);
}

/**
 * The explicit, repository-owned way a handler signals a REPOSITORY INVARIANT violation — an
 * impossible/inconsistent stored state. This fails closed; it never consumes a deterministic attempt.
 */
export class ProjectionRepositoryInvariantFailure extends Error {
  public readonly code = 'projection-repository-invariant-failed' as const;
  public readonly [REPOSITORY_INVARIANT_FAILURE_BRAND] = true;

  public constructor() {
    super('A projection repository invariant was violated.');
    this.name = 'ProjectionRepositoryInvariantFailure';
  }
}

/** Construct a repository-invariant failure (the approved factory). */
export function repositoryInvariantFailure(): ProjectionRepositoryInvariantFailure {
  return new ProjectionRepositoryInvariantFailure();
}

/** True iff `value` is a recognised repository-invariant failure (hostile-safe). */
export function isRepositoryInvariantFailure(value: unknown): boolean {
  if (hasTrueBrand(value, REPOSITORY_INVARIANT_FAILURE_BRAND)) {
    return true;
  }
  // A safe-error-code validation failure is itself a repository-owned invariant.
  try {
    return value instanceof ProjectionSafeErrorCodeError;
  } catch {
    return false;
  }
}

/**
 * The explicit, repository-owned way a handler signals cooperative CANCELLATION / SHUTDOWN. A standard
 * `AbortError` (own `name === 'AbortError'`) is also recognised. This fails closed and returns control
 * to worker supervision; it never consumes a deterministic attempt or fabricates a durable failure.
 */
export class ProjectionCancellation extends Error {
  public readonly code = 'projection-cancelled' as const;
  public readonly [CANCELLATION_BRAND] = true;

  public constructor() {
    super('The projection run was cancelled or the worker is shutting down.');
    this.name = 'ProjectionCancellation';
  }
}

/** Construct a cancellation/shutdown signal (the approved factory). */
export function projectionCancellation(): ProjectionCancellation {
  return new ProjectionCancellation();
}

/** True iff `value` is a recognised cancellation/shutdown signal (hostile-safe). */
export function isCancellationOrShutdown(value: unknown): boolean {
  return hasTrueBrand(value, CANCELLATION_BRAND) || hasOwnName(value, 'AbortError');
}

// --- The classifier ------------------------------------------------------------------------------

/**
 * Classify a caught projection-handler value into exactly one closed category, applying the ADR-0040
 * precedence. This function NEVER throws and NEVER invokes a caller method.
 *
 * Precedence:
 *   1. cancellation / shutdown                → CANCELLATION_OR_SHUTDOWN (fail closed)
 *   2. repository invariant                   → REPOSITORY_INVARIANT_FAILURE (fail closed)
 *   3. explicit deterministic contract        → DETERMINISTIC_HANDLER_FAILURE (retry)
 *   4. recognised deterministic SQLSTATE      → DETERMINISTIC_HANDLER_FAILURE (retry)
 *   5. recognised infrastructure SQLSTATE     → TRANSIENT_INFRASTRUCTURE_FAILURE (fail closed)
 *   6. valid but unrecognised SQLSTATE        → TRANSIENT_INFRASTRUCTURE_FAILURE (fail closed, conservative)
 *   7. invalid / unreadable / hostile code    → TRANSIENT_INFRASTRUCTURE_FAILURE (fail closed, conservative)
 *   8. absent code / ordinary Error           → UNKNOWN_UNCLASSIFIED_FAILURE (fail closed) — the correction
 */
export function classifyProjectionFailure(error: unknown): ProjectionFailureClassification {
  if (isCancellationOrShutdown(error)) {
    return classification('CANCELLATION_OR_SHUTDOWN', null);
  }
  if (isRepositoryInvariantFailure(error)) {
    return classification('REPOSITORY_INVARIANT_FAILURE', null);
  }
  if (isDeterministicHandlerFailure(error)) {
    return classification('DETERMINISTIC_HANDLER_FAILURE', null);
  }

  const inspection = inspectSqlstate(error);
  if (inspection.kind === 'valid') {
    return isDeterministicHandlerSqlstate(inspection.code)
      ? classification('DETERMINISTIC_HANDLER_FAILURE', inspection.code)
      : classification('TRANSIENT_INFRASTRUCTURE_FAILURE', inspection.code);
  }
  if (inspection.kind === 'invalid') {
    // Unreadable / hostile / malformed code — conservative infrastructure (ADR-0040), never deterministic.
    return classification('TRANSIENT_INFRASTRUCTURE_FAILURE', null);
  }
  // ABSENT code (ordinary Error / primitive / no own code) — the required correction: NOT deterministic.
  return classification('UNKNOWN_UNCLASSIFIED_FAILURE', null);
}

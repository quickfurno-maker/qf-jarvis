/**
 * The closed, repository-owned SAFE error vocabulary for the bounded rebuild driver
 * (QFJ-P03.08, ADR-0043).
 *
 * A rebuild aborts fail-closed with a bounded CODE and a FIXED message — never a raw exception, a
 * database message, a stack trace, a payload fragment, SQL, a connection detail, a subject, or any
 * caller/handler-provided string. This mirrors the {@link ../projection-definition.ProjectionDefinitionError}
 * discipline: the constructor accepts only a code, the code is normalised at runtime against the
 * closed table, and a thrown handler/infrastructure error's original object is deliberately NOT
 * retained as `cause` — that object is caller-controlled and would carry its text along for the ride.
 *
 * The rebuild path is a bounded local/CI PROOF (ADR-0043); it does not use the durable
 * `projection_attempt` / `projection_checkpoint` safe-code columns, so these codes are a SEPARATE,
 * rebuild-scoped vocabulary and never reach those columns.
 *
 * Not exported from the package root — internal projection vocabulary.
 */

/** The closed set of rebuild failure codes, each mapped to its FIXED message. */
const PROJECTION_REBUILD_ERROR_MESSAGES = {
  'projection-rebuild-invalid-request':
    'A rebuild request must carry a borrowed client, a valid frozen projection definition, and a non-negative horizon.',
  'projection-rebuild-horizon-failed':
    'The rebuild horizon could not be captured from the projection position map.',
  'projection-rebuild-read-failed': 'A projection event at a rebuild position could not be read.',
  'projection-rebuild-position-missing':
    'A rebuild position within the captured horizon had no event; the position prefix is not gap-free.',
  'projection-rebuild-handler-failed':
    'A projection reducer rejected while applying an event during rebuild.',
  'projection-rebuild-uncanonical-value':
    'A read-model value could not be canonicalised deterministically for the rebuild digest.',
} as const;

/** The closed set of rebuild failure codes. */
export const PROJECTION_REBUILD_ERROR_CODES = Object.freeze(
  Object.keys(PROJECTION_REBUILD_ERROR_MESSAGES) as ProjectionRebuildErrorCode[],
);

/** One rebuild failure code. */
export type ProjectionRebuildErrorCode = keyof typeof PROJECTION_REBUILD_ERROR_MESSAGES;

/** The safe, generic classification applied when a supplied code is not one of the closed codes. */
const REBUILD_FALLBACK_CODE: ProjectionRebuildErrorCode = 'projection-rebuild-invalid-request';

/**
 * Normalise an arbitrary runtime value into a known code, or the safe fallback. `hasOwnProperty` on
 * the closed table (never `in`, which would also match inherited `constructor`/`__proto__`) is the
 * runtime gate, so an unrecognised value — e.g. a secret `as`-cast into the code position — can never
 * be stored on the error.
 */
function normalizeRebuildCode(code: unknown): ProjectionRebuildErrorCode {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(PROJECTION_REBUILD_ERROR_MESSAGES, code)
    ? (code as ProjectionRebuildErrorCode)
    : REBUILD_FALLBACK_CODE;
}

/**
 * A rebuild aborted. The constructor accepts ONLY a closed code (normalised at runtime), so neither
 * `message` NOR `code` can carry caller/handler text. A thrown reducer's or driver's original error is
 * deliberately NOT retained as `cause`; callers branch on the stable {@link code}, never by parsing a
 * message.
 */
export class ProjectionRebuildError extends Error {
  public readonly code: ProjectionRebuildErrorCode;

  public constructor(code: ProjectionRebuildErrorCode) {
    const safeCode = normalizeRebuildCode(code);
    super(PROJECTION_REBUILD_ERROR_MESSAGES[safeCode]);
    this.name = 'ProjectionRebuildError';
    this.code = safeCode;
  }
}

/** True iff `value` is a {@link ProjectionRebuildError} carrying a closed code. */
export function isProjectionRebuildError(value: unknown): value is ProjectionRebuildError {
  return (
    value instanceof ProjectionRebuildError &&
    typeof value.code === 'string' &&
    (PROJECTION_REBUILD_ERROR_CODES as readonly string[]).includes(value.code)
  );
}

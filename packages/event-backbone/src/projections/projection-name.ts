/**
 * A projection name — an INTERNAL, repository-owned identifier (Stage 3.4, ADR-0034).
 *
 * A projection name is chosen by the repository, never by a sender and never by event content. It is
 * lowercase kebab-case, bounded, and used only to key a projection's checkpoint, attempts, and
 * advisory lock. Keeping the format strict here (and mirrored by a SQL CHECK in migration 0004) is
 * what lets the advisory-lock key be derived deterministically from the name alone.
 *
 * Not exported from the package root in Stage 3.4.1 — this is internal projection vocabulary.
 */

/**
 * Lowercase kebab-case: a leading lowercase letter, then lowercase-alphanumeric segments joined by
 * single hyphens. No leading digit, no uppercase, no whitespace, no path separators, no trailing or
 * doubled hyphens. Mirrored exactly by the `~` CHECK in `0004_projection_foundation.sql`.
 */
export const PROJECTION_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The maximum length of a projection name, matching the SQL `length(...) BETWEEN 1 AND 64` bound. */
export const MAX_PROJECTION_NAME_LENGTH = 64;

/** A validated projection name. The brand cannot be forged without going through {@link toProjectionName}. */
export type ProjectionName = string & { readonly __brand: 'ProjectionName' };

/** Thrown when a value is not a valid projection name. Carries no sender-controlled text beyond the code. */
export class ProjectionNameError extends Error {
  public readonly code = 'projection-name-invalid';

  public constructor(message: string) {
    super(message);
    this.name = 'ProjectionNameError';
  }
}

/** True iff `value` is a syntactically valid projection name. */
export function isProjectionName(value: unknown): value is ProjectionName {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_PROJECTION_NAME_LENGTH &&
    PROJECTION_NAME_PATTERN.test(value)
  );
}

/**
 * Validate and brand a projection name. Throws {@link ProjectionNameError} on any invalid value —
 * empty, uppercase, whitespace, path-like, over-length, or otherwise not matching the pattern.
 */
export function toProjectionName(value: unknown): ProjectionName {
  if (typeof value !== 'string') {
    throw new ProjectionNameError('A projection name must be a string.');
  }
  if (value.length === 0) {
    throw new ProjectionNameError('A projection name must not be empty.');
  }
  if (value.length > MAX_PROJECTION_NAME_LENGTH) {
    throw new ProjectionNameError('A projection name is longer than the permitted bound.');
  }
  if (!PROJECTION_NAME_PATTERN.test(value)) {
    throw new ProjectionNameError('A projection name must be bounded lowercase kebab-case.');
  }
  return value as ProjectionName;
}

/**
 * Typed, safe errors for the projection repositories (Stage 3.4, ADR-0034).
 *
 * Every message here is a fixed, repository-owned string. None carries a payload, a raw database
 * error, a stack trace, or any sender-controlled text — an error message becomes a log line, and the
 * projection layer logs nothing sensitive (ADR-0026). Callers distinguish cases by the stable `code`,
 * never by parsing the message.
 */

/** A caller supplied a structurally invalid input to a projection repository (bad version, sequence, count, timestamps). */
export class ProjectionInputError extends Error {
  public readonly code = 'projection-input-invalid';

  public constructor(message: string) {
    super(message);
    this.name = 'ProjectionInputError';
  }
}

/**
 * A checkpoint invariant was violated at the persistence boundary — a missing checkpoint where one
 * was required, a wrong affected-row count, an attempt to advance a blocked checkpoint, a sequence
 * regression, or failure metadata referencing an event at or below the checkpoint. This is fail-closed:
 * it throws rather than guessing.
 */
export class ProjectionCheckpointInvalidError extends Error {
  public readonly code = 'projection-checkpoint-invalid';

  public constructor(message: string) {
    super(message);
    this.name = 'ProjectionCheckpointInvalidError';
  }
}

/**
 * A value READ BACK from the projection store does not match the closed vocabulary the schema is
 * supposed to guarantee (an out-of-vocabulary outcome or safe error code). This should be impossible
 * given the CHECK constraints, so it fails closed rather than passing an unchecked value up. The
 * message is fixed and carries none of the offending value.
 */
export class ProjectionStoredDataError extends Error {
  public readonly code = 'projection-stored-data-invalid';

  public constructor(message: string) {
    super(message);
    this.name = 'ProjectionStoredDataError';
  }
}

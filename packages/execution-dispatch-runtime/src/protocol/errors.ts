/**
 * Errors that are CALLER mistakes, not dispatch refusals.
 *
 * A forged, malformed or expired dispatch is DATA. It is answered with an
 * `ExecutionDispatchReason` the caller can count -- never a thrown exception, because a boundary
 * that throws on hostile input hands an attacker a denial-of-service primitive.
 *
 * These two are different: they mean the caller wired the boundary wrongly -- an invalid clock, an
 * out-of-range window, a key registry that contradicts itself. Those are programming errors, and
 * there is no sensible reason code for "you called this incorrectly".
 *
 * Neither carries the raw body, the signature, key material or any parameter value. An error
 * message becomes a log line, and a boundary that refused a payload must not log it.
 */

/** The boundary was called with an invalid configuration: a bad `now` or an out-of-range window. */
export class ExecutionDispatchConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExecutionDispatchConfigError';
  }
}

/** A key registry was constructed from records that are internally invalid or contradictory. */
export class ExecutionDispatchKeyRegistryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExecutionDispatchKeyRegistryError';
  }
}

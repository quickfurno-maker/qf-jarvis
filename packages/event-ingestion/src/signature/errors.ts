/**
 * Errors that are **caller mistakes**, not envelope rejections.
 *
 * A malformed or forged event is *data*, and it is answered with a
 * `SignatureVerificationReason` — a value the caller inspects and counts, never a
 * thrown exception. These two errors are different: they mean the *caller* invoked
 * the verifier wrongly (an out-of-range window, an invalid clock, a registry that
 * contradicts itself). Those are programming errors, and they throw, because there
 * is no sensible reason code for "you called this function incorrectly."
 *
 * Neither error carries the raw body, the signature, or any key material. An error
 * message here becomes a log line, and a verifier that refused a payload must not
 * then log it (ADR-0026, security-principles §5).
 */

/** The verifier was called with an invalid configuration: a bad `now` or an out-of-range window. */
export class SignatureVerificationConfigError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SignatureVerificationConfigError';
  }
}

/** A public-key registry was constructed from records that are internally invalid or contradictory. */
export class PublicKeyRegistryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PublicKeyRegistryError';
  }
}

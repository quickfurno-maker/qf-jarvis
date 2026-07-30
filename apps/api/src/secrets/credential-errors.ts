/**
 * The closed credential-binding failure vocabulary (QFJ-S2-D-B, ADR-0064 §11).
 *
 * A credential failure is a bounded CODE and a FIXED message — never a filesystem path, a backend
 * exception, a `credentialReference`, a raw value, file metadata, or an environment-variable name. The
 * constructor accepts only a code, normalised at runtime against the closed table, so neither `message`
 * nor `code` can carry backend text, and no `cause` is retained. This mirrors `ModelGatewayError` and
 * `EvaluationError`, which are the repository's existing shape for a content-free error.
 *
 * Six codes, deliberately. `credential-access-denied` and `credential-backend-misconfigured` fold into
 * `credential-unavailable`: a file adapter cannot separate "not mounted" from "no permission" without
 * leaking the path, and the distinction tells an operator nothing the audit event does not.
 * `credential-expired` and `credential-revoked` are deferred with the concepts they name.
 */

const CREDENTIAL_FAILURE_MESSAGES = {
  /** The supplied reference is not the one this binding was configured for, or is malformed. */
  'credential-reference-invalid':
    'The supplied credential reference is not the configured reference.',
  /** The backend could not be read: permission, I/O, descriptor, mount, or an unsafe target. */
  'credential-unavailable': 'The credential backend is unavailable.',
  /** The configured credential file does not exist. */
  'credential-not-found': 'The configured credential was not found.',
  /** The backend was readable but its contents are not an acceptable credential. */
  'credential-value-invalid': 'The credential value is not acceptable.',
  /** A forced refresh failed while a last-known-good credential is still held. */
  'credential-refresh-failed':
    'The credential refresh failed; the previous credential is retained.',
  /** A binding invariant was violated. */
  'internal-invariant': 'A credential binding invariant was violated.',
} as const;

/** The closed set of credential-binding failure codes. */
export const CREDENTIAL_FAILURE_CODES = Object.freeze(
  Object.keys(CREDENTIAL_FAILURE_MESSAGES) as CredentialFailureCode[],
);

/** One credential-binding failure code. */
export type CredentialFailureCode = keyof typeof CREDENTIAL_FAILURE_MESSAGES;

/** The safe classification applied when a supplied code is not one of the closed codes. */
const FALLBACK_CODE: CredentialFailureCode = 'internal-invariant';

function normalizeCode(code: unknown): CredentialFailureCode {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(CREDENTIAL_FAILURE_MESSAGES, code)
    ? (code as CredentialFailureCode)
    : FALLBACK_CODE;
}

/**
 * A credential-binding failure. The constructor accepts ONLY a closed code, so neither `message` nor
 * `code` can carry backend text, and no `cause` is retained. Callers branch on {@link code}, never by
 * parsing a message.
 */
export class CredentialBindingError extends Error {
  public readonly code: CredentialFailureCode;

  public constructor(code: CredentialFailureCode) {
    const safe = normalizeCode(code);
    super(CREDENTIAL_FAILURE_MESSAGES[safe]);
    this.name = 'CredentialBindingError';
    this.code = safe;
  }
}

/** True iff `value` is a {@link CredentialBindingError} carrying a closed code. */
export function isCredentialBindingError(value: unknown): value is CredentialBindingError {
  return (
    value instanceof CredentialBindingError &&
    typeof value.code === 'string' &&
    (CREDENTIAL_FAILURE_CODES as readonly string[]).includes(value.code)
  );
}

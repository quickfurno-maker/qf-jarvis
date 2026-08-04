/**
 * The authentication failure taxonomy (JOS-01C, ADR-0087).
 *
 * ### Two audiences, and only one of them gets detail
 *
 * A server operator debugging a broken deployment needs to know that the config file was
 * group-readable. An attacker probing the login form must learn nothing at all — not which factor
 * failed, not whether the operator id exists, not where the secret file lives.
 *
 * So failures carry a precise `code` for server-side reasoning and a deliberately coarse
 * `publicOutcome` for anything that crosses the wire. There are exactly three public outcomes, and
 * every credential-shaped failure collapses into the first of them.
 */

export const AUTH_FAILURE_CODES = [
  // --- credential failures: all present as ONE outcome -----------------------------------------
  'operator-unknown',
  'password-mismatch',
  'totp-missing',
  'totp-malformed',
  'totp-mismatch',
  // --- request shape ---------------------------------------------------------------------------
  'request-malformed',
  'origin-rejected',
  'csrf-rejected',
  'method-not-allowed',
  // --- session -----------------------------------------------------------------------------------
  'session-absent',
  'session-malformed',
  'session-undecryptable',
  'session-claims-invalid',
  'session-expired',
  'session-revision-stale',
  'session-operator-changed',
  // --- configuration -----------------------------------------------------------------------------
  'config-path-unset',
  'config-unreadable',
  'config-too-large',
  'config-not-regular-file',
  'config-permissions-too-open',
  'config-malformed',
  'config-invalid',
  'config-algorithm-unavailable',
  // --- throttling ---------------------------------------------------------------------------------
  'rate-limited',
] as const;

export type AuthFailureCode = (typeof AUTH_FAILURE_CODES)[number];

/**
 * What a caller outside the server may learn.
 *
 * `INVALID_CREDENTIALS` covers unknown operator, wrong password AND wrong TOTP. Collapsing them is
 * the whole point: a distinguishable "no such operator" is an enumeration oracle, and a
 * distinguishable "password right, code wrong" tells an attacker their password guess landed.
 */
export type PublicAuthOutcome = 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'UNAVAILABLE';

const PUBLIC_OUTCOME: Readonly<Record<AuthFailureCode, PublicAuthOutcome>> = Object.freeze({
  'operator-unknown': 'INVALID_CREDENTIALS',
  'password-mismatch': 'INVALID_CREDENTIALS',
  'totp-missing': 'INVALID_CREDENTIALS',
  'totp-malformed': 'INVALID_CREDENTIALS',
  'totp-mismatch': 'INVALID_CREDENTIALS',
  'request-malformed': 'INVALID_CREDENTIALS',
  'origin-rejected': 'INVALID_CREDENTIALS',
  'csrf-rejected': 'INVALID_CREDENTIALS',
  'method-not-allowed': 'INVALID_CREDENTIALS',
  'session-absent': 'INVALID_CREDENTIALS',
  'session-malformed': 'INVALID_CREDENTIALS',
  'session-undecryptable': 'INVALID_CREDENTIALS',
  'session-claims-invalid': 'INVALID_CREDENTIALS',
  'session-expired': 'INVALID_CREDENTIALS',
  'session-revision-stale': 'INVALID_CREDENTIALS',
  'session-operator-changed': 'INVALID_CREDENTIALS',
  'config-path-unset': 'UNAVAILABLE',
  'config-unreadable': 'UNAVAILABLE',
  'config-too-large': 'UNAVAILABLE',
  'config-not-regular-file': 'UNAVAILABLE',
  'config-permissions-too-open': 'UNAVAILABLE',
  'config-malformed': 'UNAVAILABLE',
  'config-invalid': 'UNAVAILABLE',
  'config-algorithm-unavailable': 'UNAVAILABLE',
  'rate-limited': 'RATE_LIMITED',
});

/** The three messages a browser may ever see. None names a factor, a path or a value. */
export const PUBLIC_MESSAGE: Readonly<Record<PublicAuthOutcome, string>> = Object.freeze({
  INVALID_CREDENTIALS: 'Those credentials were not accepted.',
  RATE_LIMITED: 'Too many attempts. Try again shortly.',
  UNAVAILABLE: 'Secure access is unavailable.',
});

/**
 * The only error this subsystem throws.
 *
 * `message` is derived from the PUBLIC outcome, so it is safe wherever it lands — including an
 * unhandled rejection that reaches a log aggregator. Anything sharper lives on `code`, and a
 * caller must choose to read it.
 */
export class AuthFailure extends Error {
  public readonly code: AuthFailureCode;
  public readonly publicOutcome: PublicAuthOutcome;

  public constructor(code: AuthFailureCode) {
    super(PUBLIC_MESSAGE[PUBLIC_OUTCOME[code]]);
    this.name = 'AuthFailure';
    this.code = code;
    this.publicOutcome = PUBLIC_OUTCOME[code];
    Object.freeze(this);
  }
}

export const publicOutcomeOf = (code: AuthFailureCode): PublicAuthOutcome => PUBLIC_OUTCOME[code];

/** Narrow an unknown thrown value without letting a foreign error's text escape. */
export function toAuthFailure(error: unknown, fallback: AuthFailureCode): AuthFailure {
  return error instanceof AuthFailure ? error : new AuthFailure(fallback);
}

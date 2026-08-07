/**
 * The closed ingress failure vocabulary (private Riya web ingress, ADR-0097).
 *
 * Nine codes, nine fixed messages. A message is a CONSTANT chosen by the code and never built from
 * the request, the signature, the key ring, the downstream service or anything a person typed.
 *
 * This boundary handles a browser visitor's own words about their home, relayed by a QuickFurno
 * server. Everything that could carry that content one layer further out — a zod issue naming a
 * field and quoting its value, a `RiyaWebConversationError` message, a Node socket error, a crypto
 * error, a stack — is discarded here rather than wrapped. A failure says what KIND of thing went
 * wrong. Nothing else.
 *
 * It also refuses to be an oracle. `authentication-failed` covers a missing header, a duplicated
 * header, a malformed signature, an unknown key id, a wrong signature and a stale or future
 * `issuedAt` alike: telling a caller WHICH of those failed would help someone who does not already
 * hold the private key, and would help nobody who does.
 */

const CODE_VALUES = [
  /** The request could not be parsed, or violated the strict wire schema. Nothing ran. */
  'invalid-request',
  /** Signature, key id, caller/audience or freshness failed. Deliberately undifferentiated. */
  'authentication-failed',
  /** This `(caller, requestId)` was already served in the freshness window, with the same body. */
  'replay-detected',
  /** This `(caller, requestId)` was already served with a DIFFERENT body. Two distinct requests. */
  'request-conflict',
  /** The raw body exceeded the byte bound. Refused before parsing, never buffered past the limit. */
  'payload-too-large',
  /** The media type or content encoding is not the one this route accepts. */
  'unsupported-media',
  /** The injected server-side classification policy refused, threw, or returned a non-class. */
  'policy-refused',
  /** The downstream conversation service could not answer. Fail closed; never fabricate a turn. */
  'service-unavailable',
  /** Internal evidence contradicted itself. Trusting it would be worse than refusing. */
  'internal-invariant',
] as const;

export type PrivateRiyaWebIngressErrorCode = (typeof CODE_VALUES)[number];

export const PRIVATE_RIYA_WEB_INGRESS_ERROR_CODES: readonly PrivateRiyaWebIngressErrorCode[] =
  Object.freeze([...CODE_VALUES]);

/** The fixed message per code. Content-free, identifier-free and stable — asserted by the spec. */
const MESSAGES: Readonly<Record<PrivateRiyaWebIngressErrorCode, string>> = Object.freeze({
  'invalid-request': 'The private Riya web ingress request is invalid.',
  'authentication-failed': 'The private Riya web ingress request could not be authenticated.',
  'replay-detected': 'This private Riya web ingress request identifier was already used.',
  'request-conflict': 'This private Riya web ingress request identifier is already in use.',
  'payload-too-large': 'The private Riya web ingress request body is too large.',
  'unsupported-media': 'The private Riya web ingress request media type is not supported.',
  'policy-refused': 'The private Riya web ingress classification policy refused the request.',
  'service-unavailable': 'The Riya web conversation service is unavailable.',
  'internal-invariant': 'A private Riya web ingress invariant was violated.',
});

/** The fixed HTTP status per code. One place, so a status can never drift from its meaning. */
const STATUS: Readonly<Record<PrivateRiyaWebIngressErrorCode, number>> = Object.freeze({
  'invalid-request': 400,
  'authentication-failed': 401,
  'replay-detected': 409,
  'request-conflict': 409,
  'payload-too-large': 413,
  'unsupported-media': 415,
  // A misconfigured or failing SERVER-side policy is this deployment's defect, not the caller's.
  // Reporting it as a 4xx would invite a QuickFurno engineer to go looking at their request.
  'policy-refused': 500,
  'service-unavailable': 503,
  'internal-invariant': 500,
});

/** A bounded ingress failure. The code is the contract; the message and status are fixed per code. */
export class PrivateRiyaWebIngressError extends Error {
  readonly code: PrivateRiyaWebIngressErrorCode;
  readonly status: number;

  constructor(code: PrivateRiyaWebIngressErrorCode) {
    super(MESSAGES[code]);
    this.name = 'PrivateRiyaWebIngressError';
    this.code = code;
    this.status = STATUS[code];
  }
}

/** The fixed status for a code, without constructing an error. */
export function statusForIngressError(code: PrivateRiyaWebIngressErrorCode): number {
  return STATUS[code];
}

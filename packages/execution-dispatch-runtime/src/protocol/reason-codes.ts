/**
 * The stable, machine-countable reasons an execution dispatch can be refused.
 *
 * Tokens, not prose. A reason that cannot be counted cannot be governed, and a boundary that
 * invents a sentence at each call site cannot be alerted on. The set is CLOSED.
 *
 * The order below is the VERIFICATION ORDER. The first failing check wins, so a dispatch that is
 * both forged and expired is reported as whichever cheap check caught it first — and the verifier
 * never spends an Ed25519 verification on something it has already decided to refuse.
 *
 * No reason carries a raw body, a signature, key material, a parameter value or any personal data.
 * A boundary that refused a payload must not then hand that payload to a log.
 */
export const EXECUTION_DISPATCH_REASONS = [
  // --- transport-shaped refusals, cheapest first -------------------------------------------------
  'body-too-large',
  'signature-missing',
  'signature-malformed',
  'unsupported-algorithm',
  'signed-at-malformed',
  'unknown-key-id',
  'key-wrong-purpose',
  'key-revoked',
  'key-not-yet-valid',
  'key-expired',
  'signature-stale',
  'signature-future',
  'body-digest-mismatch',
  'signature-invalid',

  // --- body refusals, only after authenticity is proven ------------------------------------------
  'body-not-utf8',
  'body-has-bom',
  'body-not-json',
  'intent-contract-invalid',

  // --- dispatch-time temporal refusals -----------------------------------------------------------
  /** `signedAt` precedes the instant Core says it issued the intent. */
  'signed-before-issued',
  /** `signedAt` is at or after the intent's own expiry: the signature outlives what it authorises. */
  'signed-at-or-after-expiry',
  /** The intent has expired by the injected execution-boundary `now`. */
  'intent-expired',

  // --- replay / idempotency ----------------------------------------------------------------------
  /**
   * The atomic guard reports a contradiction: the same intent under a different key, the same key
   * bound to a different intent, or the same intent with different bytes. Fails closed.
   */
  'idempotency-conflict',
  /**
   * The guard itself could not answer. NOT "assume first seen" -- an unavailable replay store is
   * exactly when a duplicate is most likely, so the boundary refuses instead of guessing.
   */
  'replay-guard-unavailable',
] as const;

/** One stable reason an execution dispatch was refused. */
export type ExecutionDispatchReason = (typeof EXECUTION_DISPATCH_REASONS)[number];

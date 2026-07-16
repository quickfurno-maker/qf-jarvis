/**
 * The stable, machine-countable reasons a signature verification can fail.
 *
 * These are tokens, not prose. Each one is a value that can be counted, alerted on,
 * and reasoned about without parsing a human sentence — *"a reason that cannot be
 * counted cannot be governed"* (ADR-0020 §11). The set is closed: a verifier that
 * invents a new reason at the call site defeats the point of having stable codes.
 *
 * The order of this array is the **verification order** (ADR-0027). A failure is
 * always reported for the *first* check that fails, so an event that is both stale
 * and forged is reported as stale — the cheaper, earlier check wins, and the
 * verifier never spends an Ed25519 verification on an event it already knows it will
 * refuse.
 *
 * Stage 3.2 scope: these thirteen cover **signature verification only**. Reasons
 * that belong to *ingestion* — contract-validation failure, unknown event type or
 * version, and duplicate conflict (ADR-0020 §11) — are deliberately absent here.
 * They arrive with Stage 3.3 (validated signed ingestion), which composes this
 * verifier with contract validation and persistence.
 */
export const SIGNATURE_VERIFICATION_REASONS = [
  'body-too-large',
  'signature-missing',
  'signature-malformed',
  'unsupported-algorithm',
  'signed-at-malformed',
  'unknown-key-id',
  'key-revoked',
  'key-not-yet-valid',
  'key-expired',
  'replay-window-expired',
  'replay-window-future',
  'body-digest-mismatch',
  'signature-invalid',
] as const;

/** One stable reason a signature verification failed. */
export type SignatureVerificationReason = (typeof SIGNATURE_VERIFICATION_REASONS)[number];

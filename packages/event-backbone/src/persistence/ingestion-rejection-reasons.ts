/**
 * The persistence vocabulary for `qf_jarvis.ingestion_rejection` — the closed set of reason codes
 * and safe issue codes the append-only rejection log will store (Stage 3.3.3, ADR-0031).
 *
 * ### Why this list lives HERE and not in `@qf-jarvis/event-ingestion`
 *
 * The authoritative reason codes are owned by `@qf-jarvis/event-ingestion`
 * (`SIGNATURE_VERIFICATION_REASONS` + the validated-event-preparation rejection reasons) and the
 * safe issue-code vocabulary is `SAFE_VALIDATION_ISSUE_CODES` there. But **`event-ingestion`
 * already depends on `event-backbone`**, so `event-backbone` importing `event-ingestion` would be
 * a dependency cycle. So the persistence layer re-declares the union it must store, and a
 * **database-free conformance test that lives in `event-ingestion`** (which may depend on both)
 * asserts these two vocabularies stay aligned — every code the ingestion layer can emit is a code
 * this persistence layer accepts, and no extra code leaks in. The migration `0003` `CHECK`
 * constraints enumerate exactly these arrays; an integration test proves the SQL and this
 * TypeScript stay in step. Nothing here is guessed: it is the union of the two authoritative
 * ingestion vocabularies, pinned and tested.
 *
 * These are stable, countable machine tokens (ADR-0020 §11). A reason that cannot be counted
 * cannot be governed.
 */

/**
 * The signature-verification failure reasons, mirroring `@qf-jarvis/event-ingestion`'s
 * `SIGNATURE_VERIFICATION_REASONS` (ADR-0027). Includes `unsupported-algorithm` and `key-expired`.
 */
const SIGNATURE_REJECTION_REASON_CODES = [
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

/**
 * The validated-event-preparation rejection reasons, mirroring `@qf-jarvis/event-ingestion`'s
 * `VALIDATED_EVENT_REJECTIONS` (ADR-0030). `duplicate-conflict` is deliberately ABSENT — a
 * conflicting duplicate is recorded in `qf_jarvis.event_conflict`, not `ingestion_rejection`.
 */
const PREPARATION_REJECTION_REASON_CODES = [
  'contract-validation-failed',
  'unknown-event-type',
  'unknown-event-version',
] as const;

/**
 * The complete closed set of reason codes `qf_jarvis.ingestion_rejection` accepts — the union of
 * the signature and preparation rejection reasons. Frozen; the migration `CHECK` enumerates it.
 */
export const INGESTION_REJECTION_REASON_CODES = Object.freeze([
  ...SIGNATURE_REJECTION_REASON_CODES,
  ...PREPARATION_REJECTION_REASON_CODES,
] as const);

/** One reason code accepted by the ingestion-rejection log. */
export type IngestionRejectionReasonCode = (typeof INGESTION_REJECTION_REASON_CODES)[number];

/**
 * The closed, repository-owned safe issue-code vocabulary, mirroring `@qf-jarvis/event-ingestion`'s
 * `SAFE_VALIDATION_ISSUE_CODES` (ADR-0030). A stored `issue_codes` array holds only these — never a
 * validator-native code, a message, a field path, or any sender-controlled value.
 */
export const INGESTION_REJECTION_ISSUE_CODES = Object.freeze([
  'required',
  'invalid-type',
  'invalid-format',
  'invalid-value',
  'unknown-field',
  'constraint-violation',
  'malformed-body',
] as const);

/** One safe issue code that may appear in `issue_codes`. */
export type IngestionRejectionIssueCode = (typeof INGESTION_REJECTION_ISSUE_CODES)[number];

/**
 * The maximum number of issues a single rejection may report — mirroring
 * `@qf-jarvis/event-ingestion`'s `MAX_REJECTION_ISSUES` (ADR-0030). `issue_count` is bounded to
 * `0..MAX_INGESTION_REJECTION_ISSUES`, and `cardinality(issue_codes)` never exceeds it.
 */
export const MAX_INGESTION_REJECTION_ISSUES = 16;

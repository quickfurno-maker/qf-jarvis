/**
 * The closed refusal vocabulary (QFJ-P09.05, ADR-0110).
 *
 * Thirteen reasons, and deliberately no fourteenth called `invalid`, `other`, `unknown` or
 * `error`. A generic bucket is what turns a fail-closed policy into an unreadable one: every refusal
 * this runtime can reach is a specific, nameable disagreement between two records, and a caller that
 * switches over these must be forced to handle each on its own terms.
 *
 * ### Nothing here carries content
 *
 * A refusal reason is a token and never a sentence, and never a sentence BUILT from what arrived.
 * The records this runtime reads name a recipient -- an opaque Core reference, but still an identity
 * -- a purpose code, a correlation id and an explanation written for a human. Zod's issues quote the
 * values that failed. So the canonical parse result is reduced to `current-record-invalid` or
 * `next-record-invalid` and the issues are DISCARDED, rather than summarised, formatted or attached
 * to the result "for debugging". A refusal that travels into a log line, a screenshot or a support
 * ticket must not take a recipient with it.
 *
 * That is also why there is no field naming WHICH identity field mismatched beyond the reason token
 * itself: `recipient-mismatch` says a mismatch happened; it does not print either recipient.
 *
 * ### Why the two record-invalid reasons are separate
 *
 * `current-record-invalid` means the caller's idea of where the lifecycle stands does not survive
 * the canonical schema -- the premise of the question is broken. `next-record-invalid` means the
 * candidate does not. Collapsing them would hide the difference between "your history is wrong" and
 * "your proposal is wrong", which are fixed in entirely different places.
 */

const COMMUNICATION_LIFECYCLE_REFUSAL_REASON_VALUES = [
  // --- the records themselves, before any policy runs -------------------------------------------
  /** The supplied current record fails `communicationStateRecordV1Schema`. */
  'current-record-invalid',
  /** The supplied candidate record fails `communicationStateRecordV1Schema`. */
  'next-record-invalid',

  // --- lifecycle start --------------------------------------------------------------------------
  /** No current record, and the candidate is not `draft`. A lifecycle may begin nowhere else. */
  'initial-state-not-draft',
  /** No current record, yet the candidate claims a previous state. There was nothing to leave. */
  'initial-previous-state-present',

  // --- identity continuity ----------------------------------------------------------------------
  /** The two records describe different governed communications. */
  'communication-id-mismatch',
  /** The channel changed mid-lifecycle. */
  'channel-mismatch',
  /** The recipient changed mid-lifecycle. */
  'recipient-mismatch',
  /** The approved purpose changed mid-lifecycle. */
  'purpose-code-mismatch',
  /** The correlation changed mid-lifecycle. */
  'correlation-id-mismatch',

  // --- history evidence -------------------------------------------------------------------------
  /** A non-initial candidate carries no `previousState`, so it evidences no departure. */
  'previous-state-missing',
  /** The candidate's `previousState` names a state other than the one actually being left. */
  'previous-state-mismatch',

  // --- ordering ---------------------------------------------------------------------------------
  /** The candidate was recorded strictly before the record it claims to follow. */
  'timestamp-regression',

  // --- the edge ---------------------------------------------------------------------------------
  /** The graph in docs/architecture/communication-model.md contains no such edge. */
  'transition-not-allowed',
] as const;

export type CommunicationLifecycleRefusalReason =
  (typeof COMMUNICATION_LIFECYCLE_REFUSAL_REASON_VALUES)[number];

export const COMMUNICATION_LIFECYCLE_REFUSAL_REASONS: readonly CommunicationLifecycleRefusalReason[] =
  Object.freeze([...COMMUNICATION_LIFECYCLE_REFUSAL_REASON_VALUES]);

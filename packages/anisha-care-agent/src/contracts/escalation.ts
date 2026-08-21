/**
 * The closed CUSTOMER-CARE escalation vocabulary.
 *
 * ### Why escalation reasons live in their own file
 *
 * An escalation reason is the one thing a care turn produces that a human will read before acting.
 * It has to be closed, content-free and stable — a reason built from client text would carry
 * personal data into an operational queue, and a free-form reason would make queue routing
 * unenforceable.
 *
 * ### TARGET-NEUTRAL, deliberately
 *
 * These say WHY a turn needs a person. They never say WHICH person, which team or which queue.
 * That is a routing decision owned by orchestration, which can see the roster; this package cannot,
 * and a behaviour kernel that named a target would be asserting something it has no basis for.
 */

export const CARE_ESCALATION_REASONS = [
  /** The client asked for a person. The most direct reason there is. */
  'CLIENT_REQUESTED_HUMAN',
  /** Disputed, sensitive, legal, fraud or policy-exception, as classified upstream. */
  'SENSITIVE_OR_DISPUTED_MATTER',
  /** Refund, cancellation or billing. Care may never state an outcome, an amount or a date. */
  'COMMERCIAL_DECISION_REQUIRED',
  /** A complaint that needs ownership rather than acknowledgement. */
  'COMPLAINT_REQUIRES_OWNER',
  /**
   * The matter has already been escalated once and has come back.
   *
   * Its own reason because a repeat escalation is not the same event as a first one: handling it as
   * a fresh escalation is how a client ends up explaining themselves three times.
   */
  'REPEAT_ESCALATION',
  /** An ageing or overdue matter that care cannot progress. */
  'MATTER_OVERDUE',
] as const;
export type CareEscalationReason = (typeof CARE_ESCALATION_REASONS)[number];

export const CARE_ESCALATION_REASONS_FROZEN: readonly CareEscalationReason[] = Object.freeze([
  ...CARE_ESCALATION_REASONS,
]);

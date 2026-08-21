/**
 * What a CUSTOMER-CARE turn concluded should happen next.
 *
 * Deliberately NOT a replacement for the runtime's own orchestration result — that shape is owned
 * elsewhere. This is the narrower question "what should this care turn do next?", and every value
 * is something the caller may CHOOSE to do, never an instruction that executes itself.
 */

export const CARE_DISPOSITIONS = [
  /** Draft a client-facing informational or acknowledgement reply through the model boundary. */
  'DRAFT_REPLY',
  /** Reply, but only to gather context. Nothing may be asserted about the matter yet. */
  'CONTINUE_CLARIFICATION',
  /**
   * Record the matter and acknowledge it. Never resolve it.
   *
   * The care-specific disposition. A complaint, a warranty claim and a refund request all need the
   * client to know they were heard, and none of them may be answered with an outcome by a model.
   */
  'ACKNOWLEDGE_AND_RECORD',
  /**
   * Request escalation-required handling.
   *
   * Target-neutral, exactly as the escalation reasons are: it states the need, and orchestration
   * maps it to a person or a queue.
   */
  'REQUEST_CARE_ESCALATION',
  /**
   * Hand the turn to the sibling agent that owns it.
   *
   * Its own disposition rather than a refusal, because a sales turn arriving at care is not an
   * error and the client should not be declined — someone can help, and this names that.
   */
  'REFER_TO_SALES_AGENT',
  /** Decline safely. No model, no proposal. */
  'REFUSE',
] as const;
export type CareDisposition = (typeof CARE_DISPOSITIONS)[number];

export const CARE_DISPOSITIONS_FROZEN: readonly CareDisposition[] = Object.freeze([
  ...CARE_DISPOSITIONS,
]);

/**
 * The dispositions on which the model boundary may be invoked.
 *
 * Derived from this one list rather than decided at each call site, so "which paths may reach a
 * model" is answerable by reading a single constant. Everything else — escalation, referral,
 * refusal — reaches no model at all.
 */
export const CARE_MODEL_ELIGIBLE_DISPOSITIONS: readonly CareDisposition[] = Object.freeze([
  'DRAFT_REPLY',
  'CONTINUE_CLARIFICATION',
  'ACKNOWLEDGE_AND_RECORD',
]);

/** Whether a disposition may reach the model boundary. Total over the closed vocabulary. */
export function isCareModelEligibleDisposition(disposition: CareDisposition): boolean {
  return CARE_MODEL_ELIGIBLE_DISPOSITIONS.includes(disposition);
}

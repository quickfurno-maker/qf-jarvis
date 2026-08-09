/**
 * What a structured action reports (RWC-P6B, ADR-0102 §2, §16).
 *
 * ### State and status. Never text.
 *
 * There is no reply body, no draft, no authorized reply, no raw Core result, no evidence reference, no
 * contact or consent payload and no lead reference in this shape. A structured action makes no model
 * call, so it has nothing to say in words — and if it could return text, the acknowledgement of a
 * confirmation would become one more place a value the client agreed to gets restated by something
 * that did not check it.
 *
 * ### Four dispositions, and they are not interchangeable
 *
 * The distinction that matters most is `NOT_READY` versus `REFUSED`. `REFUSED` is a decision — the
 * client declined, or the action is not legal for this conversation. `NOT_READY` is a state that may
 * change: an authority is down, availability moved, Core has not got what it needs yet. Collapsing
 * them would either invite a caller to retry a decision, or tell a client "no" because a network was
 * briefly unreachable.
 *
 * `CONFLICT` is separate again: somebody else changed the conversation. Nothing was decided and
 * nothing is wrong; the surface should re-render and let the client act on what is actually there.
 *
 * ### The reason is a closed token, and the closure is the privacy property
 *
 * Every reason below is chosen from this list by this service. None is built from an input, a store
 * answer, a Core payload or a reader error, so no host, table, credential, Core sentence or word of a
 * client's own can reach a caller through it.
 */
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

const DISPOSITION_VALUES = [
  /** The action was applied and the continuity below is what is durably stored. */
  'APPLIED',
  /** Not servable now, possibly servable later. Never a statement about the client. */
  'NOT_READY',
  /** A decision, and it was no. Retrying it unchanged will produce the same answer. */
  'REFUSED',
  /** Another writer moved this conversation. Nothing was decided; re-render and try again. */
  'CONFLICT',
] as const;

export type RiyaStructuredActionDisposition = (typeof DISPOSITION_VALUES)[number];

export const RIYA_STRUCTURED_ACTION_DISPOSITIONS: readonly RiyaStructuredActionDisposition[] =
  Object.freeze([...DISPOSITION_VALUES]);

const REASON_CODE_VALUES = [
  /** No conversation exists. Structured actions never create one (ADR-0102 §3). */
  'CONTINUITY_NOT_FOUND',
  /** The action was built against a revision that is no longer current. */
  'STALE_REVISION',
  /** Legal shape, illegal for this conversation's phase, flag or completion state. */
  'ACTION_NOT_PERMITTED',
  /** An injected authority could not answer, or answered something unprovable. */
  'AUTHORITY_UNAVAILABLE',
  /** An authority answered about a different tenant, conversation, subject or key. */
  'AUTHORITY_MISMATCH',
  /** Core no longer sells this service in this city. The summary cannot stand as rendered. */
  'AVAILABILITY_CHANGED',
  /** Core holds no usable contact for this subject yet. */
  'CONTACT_MISSING',
  /** Core has recorded no consent decision for this intake yet. */
  'CONSENT_MISSING',
  /** The client declined THIS intake. Not a global stop, and not ours to override. */
  'CONSENT_DECLINED',
  /** The stronger Core-owned stop. Never ignored, and never treated as a retryable state. */
  'CONSENT_OPTED_OUT',
  /** Core says not yet. A business state that may change. */
  'CORE_NOT_READY',
  /** Core says no. A business decision, not an outage. */
  'CORE_REJECTED',
  /** A person decided this conversation needs looking at, and P6 does not overrule that. */
  'HUMAN_REVIEW_REQUIRED',
  /** Continuity moved underneath this action and could not be reconciled. */
  'CONTINUITY_CONFLICT',
  /**
   * One submit was made and its outcome is unknown (ADR-0102 §14).
   *
   * Deliberately its own reason, and deliberately not `AUTHORITY_UNAVAILABLE`: the difference is that
   * a business mutation MAY have succeeded. A caller that treated this as a plain outage would retry,
   * and the retry is the thing that creates a second enquiry.
   */
  'SUBMISSION_INDETERMINATE',
] as const;

export type RiyaStructuredActionReasonCode = (typeof REASON_CODE_VALUES)[number];

export const RIYA_STRUCTURED_ACTION_REASON_CODES: readonly RiyaStructuredActionReasonCode[] =
  Object.freeze([...REASON_CODE_VALUES]);

/** One bounded structured-action outcome. */
export interface RiyaStructuredActionResultV1 {
  readonly version: 1;
  readonly disposition: RiyaStructuredActionDisposition;
  /**
   * The AUTHORITATIVE continuity after the action.
   *
   * Present for every outcome that had a conversation to report — including every refusal, because a
   * surface that cannot re-render is a surface that will guess. Absent ONLY with
   * `CONTINUITY_NOT_FOUND`, where there is genuinely no state: reporting a fabricated one would be
   * this service inventing the conversation it just refused to create.
   */
  readonly continuity?: RiyaConversationContinuityStateV1;
  /** Required on every non-`APPLIED` disposition, and forbidden on `APPLIED`. */
  readonly reasonCode?: RiyaStructuredActionReasonCode;
}

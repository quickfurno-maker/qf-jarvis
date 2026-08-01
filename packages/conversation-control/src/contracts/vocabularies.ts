/**
 * The closed conversation-control vocabularies (QFJ-P08-A, ADR-0074).
 *
 * Four actions, three outcomes, five reasons. Every one is a fixed token a human operator's intent
 * maps onto — never free text, never a business verb. There is deliberately no `ASSIGN`, `APPROVE`,
 * `REJECT`, `RESOLVE`, `SEND`, `EXECUTE` or `AUTHORIZE` here: this package moves two booleans and
 * nothing else, and a vocabulary is the cheapest place to make that structural rather than a promise.
 */

/**
 * The four control actions.
 *
 * `RESUME_AI` is separate from `RELEASE_OWNERSHIP` on purpose. ADR-0054 E: "Return-to-AI requires an
 * explicit authorized runtime transition — there is no automatic release from human takeover." A
 * single "hand it back" action would make returning to AI a side effect of a human finishing their
 * work, which is exactly the automatic release that decision forbids.
 */
const CONVERSATION_CONTROL_ACTION_VALUES = [
  'TAKE_OWNERSHIP',
  'RELEASE_OWNERSHIP',
  'PAUSE_AI',
  'RESUME_AI',
] as const;
export type ConversationControlAction = (typeof CONVERSATION_CONTROL_ACTION_VALUES)[number];

export const CONVERSATION_CONTROL_ACTIONS_FROZEN: readonly ConversationControlAction[] =
  Object.freeze([...CONVERSATION_CONTROL_ACTION_VALUES]);

/**
 * The three outcomes.
 *
 * `NO_CHANGE` is distinct from `APPLIED` because a re-issued command must be visibly a no-op rather
 * than silently advancing the revision — a revision bump that changed nothing would invalidate every
 * other operator's `expectedRevision` for no reason.
 */
const CONVERSATION_CONTROL_OUTCOME_VALUES = ['APPLIED', 'NO_CHANGE', 'REFUSED'] as const;
export type ConversationControlOutcome = (typeof CONVERSATION_CONTROL_OUTCOME_VALUES)[number];

export const CONVERSATION_CONTROL_OUTCOMES_FROZEN: readonly ConversationControlOutcome[] =
  Object.freeze([...CONVERSATION_CONTROL_OUTCOME_VALUES]);

/**
 * The five reasons. One per distinguishable cause, and no more.
 *
 * `human-takeover-active` is the only *semantic* refusal: a human holds the conversation, so AI may
 * not be resumed under them. The other refusals are structural (a stale revision, an exhausted
 * counter).
 */
const CONVERSATION_CONTROL_REASON_VALUES = [
  'applied',
  'already-satisfied',
  'revision-mismatch',
  'human-takeover-active',
  'revision-exhausted',
] as const;
export type ConversationControlReason = (typeof CONVERSATION_CONTROL_REASON_VALUES)[number];

export const CONVERSATION_CONTROL_REASONS_FROZEN: readonly ConversationControlReason[] =
  Object.freeze([...CONVERSATION_CONTROL_REASON_VALUES]);

/** Internal, unexported: the raw tuples the schemas need. Never widened at the package root. */
export const ACTION_VALUES = CONVERSATION_CONTROL_ACTION_VALUES;
export const OUTCOME_VALUES = CONVERSATION_CONTROL_OUTCOME_VALUES;
export const REASON_VALUES = CONVERSATION_CONTROL_REASON_VALUES;

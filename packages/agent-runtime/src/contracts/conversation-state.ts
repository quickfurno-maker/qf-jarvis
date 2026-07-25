/**
 * The validated conversation-state machine (QFJ-M1, ADR-0054 §D, §E).
 *
 * Deterministic, fail-closed transitions. Returning to AI from `HUMAN_TAKEOVER` (or `ESCALATED`)
 * requires an EXPLICIT authorized transition — there is no automatic release from human takeover.
 * There is no persistence here; this is a pure validation of a proposed state change.
 */
import type { ConversationState } from './vocabularies.js';

/** The permitted forward transitions from each state (before the authorized-only guard). */
const BASE_TRANSITIONS: Readonly<Record<ConversationState, readonly ConversationState[]>> =
  Object.freeze({
    NEW: ['ACTIVE_AI', 'HUMAN_TAKEOVER', 'ESCALATED', 'CLOSED'],
    ACTIVE_AI: ['WAITING_EXTERNAL', 'FOLLOW_UP_DUE', 'ESCALATED', 'HUMAN_TAKEOVER', 'CLOSED'],
    WAITING_EXTERNAL: ['ACTIVE_AI', 'FOLLOW_UP_DUE', 'ESCALATED', 'HUMAN_TAKEOVER', 'CLOSED'],
    FOLLOW_UP_DUE: ['ACTIVE_AI', 'ESCALATED', 'HUMAN_TAKEOVER', 'CLOSED'],
    ESCALATED: ['HUMAN_TAKEOVER', 'ACTIVE_AI', 'CLOSED'],
    HUMAN_TAKEOVER: ['ACTIVE_AI', 'CLOSED'],
    CLOSED: [],
  });

/** Transitions that return control to AI and therefore require an explicit authorized transition. */
const AUTHORIZED_ONLY: ReadonlySet<string> = new Set([
  'HUMAN_TAKEOVER>ACTIVE_AI',
  'ESCALATED>ACTIVE_AI',
]);

export interface TransitionOptions {
  /** Set true only for an explicit, authorized return-to-AI transition. */
  readonly authorized?: boolean;
}

/**
 * True iff `to` is a permitted transition from `from`. A return-to-AI edge out of `HUMAN_TAKEOVER`/
 * `ESCALATED` is permitted ONLY when `options.authorized` is true (no automatic release).
 */
export function isValidConversationTransition(
  from: ConversationState,
  to: ConversationState,
  options?: TransitionOptions,
): boolean {
  if (!BASE_TRANSITIONS[from].includes(to)) {
    return false;
  }
  if (AUTHORIZED_ONLY.has(`${from}>${to}`)) {
    return options?.authorized === true;
  }
  return true;
}

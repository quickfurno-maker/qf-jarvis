/**
 * `@qf-jarvis/conversation-control` — the conversation control command foundation (QFJ-P08-A, ADR-0074).
 *
 * A MECHANISM, not a control plane. Merged `main` already READS
 * `ConversationControlState.humanTakeover` / `.aiPaused` through one authoritative source and blocks
 * every AI reply when either is set — but that port is `read(conversationId)` only, so no production
 * code in the repository can SET or CLEAR them. The runtime obeys a takeover it has no way to declare.
 * Canonical QFJ-P09 transport depends on QFJ-P08, and no real-recipient path may exist before the
 * minimum human-control mechanism does.
 *
 * This package supplies the deterministic semantics that gap needs, and only those. It answers one
 * question — "given this validated control fragment and this validated command, what is the next
 * fragment and what evidence describes the transition?" — and it stores nothing, exposes no port,
 * composes into no runtime and makes nothing authoritative.
 *
 * The permanent shape of the four actions:
 *
 * - `TAKE_OWNERSHIP` enters takeover AND forces the AI pause;
 * - `RELEASE_OWNERSHIP` exits takeover and LEAVES AI PAUSED — it never resumes;
 * - `PAUSE_AI` pauses without touching ownership;
 * - `RESUME_AI` is the only action that may clear the pause, and is refused while a human holds the
 *   conversation.
 *
 * That asymmetry is ADR-0054 E, not a preference: "Return-to-AI requires an explicit authorized
 * runtime transition — there is no automatic release from human takeover."
 *
 * **This is not QFJ-P08.** Consent state, opt-out enforcement, the approval request/decision runtime,
 * broader human control and the operator interface all remain unimplemented. No persistence, no
 * durable idempotency claim, no HTTP, no UI, no transport, no provider, no Core call, no clock, no
 * randomness, no environment read.
 *
 * Nine root runtime symbols. Every schema, regex, validator, re-validator and audit factory stays
 * internal.
 */
export {
  CONVERSATION_CONTROL_VERSION,
  createConversationControlCommand,
} from './contracts/control-command.js';
export type {
  ConversationControlVersion,
  ConversationControlCommandInput,
  ConversationControlCommand,
} from './contracts/control-command.js';

export { createConversationControlSnapshot } from './contracts/control-snapshot.js';
export type {
  ConversationControlSnapshotInput,
  ConversationControlSnapshot,
} from './contracts/control-snapshot.js';

export {
  CONVERSATION_CONTROL_ACTIONS_FROZEN,
  CONVERSATION_CONTROL_OUTCOMES_FROZEN,
  CONVERSATION_CONTROL_REASONS_FROZEN,
} from './contracts/vocabularies.js';
export type {
  ConversationControlAction,
  ConversationControlOutcome,
  ConversationControlReason,
} from './contracts/vocabularies.js';

export type {
  ConversationControlAuditRecord,
  ConversationControlDecision,
} from './contracts/control-decision.js';

export { ConversationControlError, CONVERSATION_CONTROL_ERROR_CODES } from './contracts/errors.js';
export type { ConversationControlErrorCode } from './contracts/errors.js';

export { applyConversationControlCommand } from './service/apply-control-command.js';

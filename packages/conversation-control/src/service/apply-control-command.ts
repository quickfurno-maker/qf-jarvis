/**
 * The pure conversation-control reducer (QFJ-P08-A, ADR-0074).
 *
 * One synchronous, total function. Given a validated control fragment and a validated operator
 * command, it answers what the next fragment is and emits one piece of content-free evidence.
 *
 * It does NOT store that answer, and nothing in this package makes it authoritative. The authoritative
 * conversation record is owned by QuickFurno Core and read through `jarvis-runtime`'s
 * `AuthoritativeConversationStatePort`; wiring this reducer behind a WRITABLE port is QFJ-P08-A PR 2,
 * and durable persistence is a later slice that needs its own schema audit. Until then this is a
 * decision procedure a caller may consult, not a control plane.
 *
 * Deterministic: no clock, no randomness, no crypto, no I/O, no module-level mutable state. The same
 * fragment and command always yield a deep-equal decision — which is what will later let the same
 * command be safely replayed against a store without a second effect.
 */
import { ConversationControlError } from '../contracts/errors.js';
import {
  revalidateCommand,
  type ConversationControlCommand,
} from '../contracts/control-command.js';
import {
  revalidateSnapshot,
  type ConversationControlSnapshot,
} from '../contracts/control-snapshot.js';
import {
  CONVERSATION_CONTROL_RECORD_VERSION,
  type ConversationControlAuditRecord,
  type ConversationControlDecision,
} from '../contracts/control-decision.js';
import type {
  ConversationControlOutcome,
  ConversationControlReason,
} from '../contracts/vocabularies.js';

/** The two booleans a control action may move, and nothing else. */
interface ControlFlags {
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}

/**
 * The action semantics, as pure flag arithmetic.
 *
 * `undefined` means "this action refuses here"; a returned pair equal to the current one becomes
 * `NO_CHANGE`, and a different pair becomes `APPLIED`. Expressing it this way keeps every rule in one
 * readable place and makes "which actions can clear the pause?" answerable by reading eight lines.
 */
function nextFlags(
  action: ConversationControlCommand['action'],
  current: ControlFlags,
): ControlFlags | undefined {
  switch (action) {
    // Taking ownership ALWAYS forces the pause. A human holding a conversation while AI keeps
    // replying into it is the exact failure the launch gate "human takeover stops AI = 100%" names,
    // so takeover and pause are set together rather than left to a second command that might not
    // arrive.
    case 'TAKE_OWNERSHIP':
      return { humanTakeover: true, aiPaused: true };

    // Releasing ownership LEAVES AI PAUSED. ADR-0054 E: "Return-to-AI requires an explicit authorized
    // runtime transition -- there is no automatic release from human takeover." An operator finishing
    // their work is not the same decision as declaring the conversation safe for AI again, and
    // collapsing the two would make every handoff silently re-arm automatic replies.
    case 'RELEASE_OWNERSHIP':
      return current.humanTakeover ? { humanTakeover: false, aiPaused: true } : current;

    // Pausing never touches takeover: pausing AI under a human who already holds the conversation is
    // a no-op on ownership, not a release.
    case 'PAUSE_AI':
      return current.aiPaused ? current : { humanTakeover: current.humanTakeover, aiPaused: true };

    // The ONLY action that may clear the pause, and it refuses outright while a human holds the
    // conversation -- resuming AI under someone else's takeover would override a colleague's control
    // decision without their knowledge.
    case 'RESUME_AI':
      if (current.humanTakeover) {
        return undefined;
      }
      return current.aiPaused ? { humanTakeover: false, aiPaused: false } : current;

    default:
      return undefined;
  }
}

/** Build the one frozen, content-free audit record for a decision. */
function auditRecord(args: {
  readonly command: ConversationControlCommand;
  readonly observedRevision: number;
  readonly outcome: ConversationControlOutcome;
  readonly reason: ConversationControlReason;
  readonly next: ConversationControlSnapshot;
}): ConversationControlAuditRecord {
  const { command, observedRevision, outcome, reason, next } = args;
  return Object.freeze({
    recordVersion: CONVERSATION_CONTROL_RECORD_VERSION,
    commandId: command.commandId,
    conversationId: command.conversationId,
    action: command.action,
    operatorRef: command.operatorRef,
    ...(command.reasonRef === undefined ? {} : { reasonRef: command.reasonRef }),
    expectedRevision: command.expectedRevision,
    observedRevision,
    outcome,
    reason,
    resultingRevision: next.revision,
    humanTakeover: next.humanTakeover,
    aiPaused: next.aiPaused,
    issuedAt: command.issuedAt,
  });
}

function decision(
  outcome: ConversationControlOutcome,
  reason: ConversationControlReason,
  next: ConversationControlSnapshot,
  command: ConversationControlCommand,
  observedRevision: number,
): ConversationControlDecision {
  return Object.freeze({
    outcome,
    reason,
    nextState: next,
    auditRecord: auditRecord({ command, observedRevision, outcome, reason, next }),
  });
}

/**
 * Apply one operator control command to one control fragment.
 *
 * Order matters, and each step is a different KIND of wrongness:
 *
 * 1. **Conversation identity.** A command for another conversation is not a refusal, it is a wiring
 *    error — refusing it would return a plausible decision for a conversation nobody asked about. It
 *    throws `invalid-application`.
 * 2. **Expected revision.** Checked BEFORE the action semantics, so a stale operator gets
 *    `revision-mismatch` rather than a confident answer computed from state they never saw. Staleness
 *    also takes precedence over overflow: the operator's problem is that they are looking at an old
 *    conversation, and telling them the counter is exhausted would send them to the wrong place.
 * 3. **Action safety.** Only `RESUME_AI` can refuse here, and only under an active takeover.
 * 4. **Revision overflow**, but only when a change is actually required. A `NO_CHANGE` at
 *    `MAX_SAFE_INTEGER` is still a valid no-op — nothing needs to be counted.
 *
 * Both arguments are RE-VALIDATED. They are structural interfaces, so a plain object literal
 * satisfies them at compile time without having passed either constructor, and a command carries an
 * operator's identity into audit evidence. The canonical results are what the reducer then uses:
 * validating and continuing with the caller's object would leave it reading a value it does not own.
 *
 * Neither argument is mutated or frozen.
 */
export function applyConversationControlCommand(
  snapshot: ConversationControlSnapshot,
  command: ConversationControlCommand,
): ConversationControlDecision {
  const state = revalidateSnapshot(snapshot);
  const cmd = revalidateCommand(command);

  if (cmd.conversationId !== state.conversationId) {
    throw new ConversationControlError('invalid-application');
  }

  const observedRevision = state.revision;

  if (cmd.expectedRevision !== observedRevision) {
    return decision('REFUSED', 'revision-mismatch', state, cmd, observedRevision);
  }

  const current: ControlFlags = { humanTakeover: state.humanTakeover, aiPaused: state.aiPaused };
  const proposed = nextFlags(cmd.action, current);

  if (proposed === undefined) {
    // The only semantic refusal: RESUME_AI under an active human takeover.
    return decision('REFUSED', 'human-takeover-active', state, cmd, observedRevision);
  }

  const unchanged =
    proposed.humanTakeover === current.humanTakeover && proposed.aiPaused === current.aiPaused;

  if (unchanged) {
    return decision('NO_CHANGE', 'already-satisfied', state, cmd, observedRevision);
  }

  if (observedRevision >= Number.MAX_SAFE_INTEGER) {
    // A revision that cannot be incremented is not a state to guess past: a further change would have
    // to reuse or overflow the number every other reader compares against.
    return decision('REFUSED', 'revision-exhausted', state, cmd, observedRevision);
  }

  const next: ConversationControlSnapshot = Object.freeze({
    conversationId: state.conversationId,
    revision: observedRevision + 1,
    humanTakeover: proposed.humanTakeover,
    aiPaused: proposed.aiPaused,
  });
  return decision('APPLIED', 'applied', next, cmd, observedRevision);
}

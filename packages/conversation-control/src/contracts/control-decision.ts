/**
 * The control decision and its audit record (QFJ-P08-A, ADR-0074).
 *
 * A decision is the reducer's whole answer: what the next fragment is, and one immutable piece of
 * evidence describing how it got there. The evidence is produced for `REFUSED` and `NO_CHANGE` too,
 * not only for `APPLIED` — "an operator tried to resume AI while a colleague held the conversation"
 * is exactly the event an operations review needs, and a record that only existed on success would
 * make refusals invisible.
 *
 * The record is CONTENT-FREE. Every field is an opaque reference, a closed token, a boolean or an
 * integer. There is no message, prompt, model output, subject, tenant, party, provider, free-text
 * reason or PII, and no field that could carry one.
 */
import type { ConversationControlAction } from './vocabularies.js';
import type { ConversationControlOutcome, ConversationControlReason } from './vocabularies.js';
import type { ConversationControlSnapshot } from './control-snapshot.js';

/** The audit RECORD version. Independent of the command grammar version it records. */
export const CONVERSATION_CONTROL_RECORD_VERSION = 1 as const;
export type ConversationControlRecordVersion = typeof CONVERSATION_CONTROL_RECORD_VERSION;

/**
 * One immutable, content-free control audit record.
 *
 * `expectedRevision` and `observedRevision` are BOTH recorded. On a refusal they are what makes the
 * refusal explicable without re-reading the state; on success they prove the command was applied to
 * the revision its operator believed they were acting on.
 *
 * `commandId` is carried so a LATER phase can deduplicate on it. This package stores nothing, so it
 * makes no durable idempotency claim — it only ensures the identifier a future store would key on is
 * already in the evidence rather than needing to be retrofitted.
 */
export interface ConversationControlAuditRecord {
  readonly recordVersion: ConversationControlRecordVersion;
  readonly commandId: string;
  readonly conversationId: string;
  readonly action: ConversationControlAction;
  readonly operatorRef: string;
  readonly reasonRef?: string;
  /** The revision the operator believed they were acting on. */
  readonly expectedRevision: number;
  /** The revision the snapshot actually carried. */
  readonly observedRevision: number;
  readonly outcome: ConversationControlOutcome;
  readonly reason: ConversationControlReason;
  /** The revision AFTER this decision. Equals `observedRevision` unless the outcome is `APPLIED`. */
  readonly resultingRevision: number;
  /** The resulting flags. Always equal to `nextState`'s — asserted by the spec. */
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  /** The operator's own instant, carried through exactly. Never this package's clock. */
  readonly issuedAt: string;
}

/**
 * The reducer's complete answer.
 *
 * `nextState` is present on EVERY outcome, including refusals, where it is the unchanged fragment.
 * A decision whose `nextState` were absent on refusal would force every caller to write the same
 * "if refused, keep the old one" branch, and one of them would eventually write it wrong.
 */
export interface ConversationControlDecision {
  readonly outcome: ConversationControlOutcome;
  readonly reason: ConversationControlReason;
  readonly nextState: ConversationControlSnapshot;
  readonly auditRecord: ConversationControlAuditRecord;
}

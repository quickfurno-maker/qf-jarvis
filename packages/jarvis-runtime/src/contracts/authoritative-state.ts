/**
 * The ONE authoritative content-free conversation-state source (QFJ-M5, ADR-0059 §C, §D).
 *
 * This is the single source of conversation-control truth the composition root wires ALL lower state
 * readers to (the M2 conversation-context port, the M3 `CoreDecisionStateReader`, the M4
 * `ReplyStateReader`, and the privacy gate). There is no module-local competing state authority; every
 * gate re-reads THIS source across each awaited boundary, so a change during an await is observed and
 * fails closed. It is provider-neutral, content-free, and asynchronous (a live read is database-backed,
 * ADR-0058 §1). It reads no message/reply/prompt/knowledge content; the only concrete implementation is
 * the deterministic fake under `./testing`. It carries NO business rule — QuickFurno Core stays
 * authoritative.
 */
import type {
  RuntimeDataClass,
  RuntimePartyType,
  RuntimeSubjectStatus,
} from '@qf-jarvis/agent-runtime';

/** The safe, content-free control state of one conversation, keyed by conversation id. */
export interface ConversationControlState {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly revision: number;
  readonly partyType: RuntimePartyType;
  readonly dataClass: RuntimeDataClass;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  /** The subject privacy/tombstone status; only `clear` permits proceeding. */
  readonly subjectStatus: RuntimeSubjectStatus;
  /** An optional OPAQUE subject reference (never subject content); its presence triggers the privacy gate. */
  readonly subjectRef: string | undefined;
  /** A canonical observed-at instant/reference (safe; for correlation only). */
  readonly observedAt: string;
}

/** Supplies the current authoritative content-free control state for a conversation. Awaited. */
export interface AuthoritativeConversationStatePort {
  read(conversationId: string): Promise<ConversationControlState>;
}

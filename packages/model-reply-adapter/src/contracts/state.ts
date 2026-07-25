/**
 * The injected content-free conversation-state reader (QFJ-M4, ADR-0057 §J).
 *
 * The adapter re-reads the current conversation state IMMEDIATELY BEFORE gateway invocation and
 * IMMEDIATELY AFTER the gateway result (the pre/post-gateway state gate). The reader is provider-
 * neutral and content-free — it exposes only the revision, party type, assigned actor, data class,
 * the human-takeover / AI-pause / cancellation flags, and the subject privacy status. It reads no
 * message content; the only concrete implementation is the deterministic fake under `./testing`.
 */
import type {
  RuntimeActor,
  RuntimeDataClass,
  RuntimePartyType,
  RuntimeSubjectStatus,
} from '@qf-jarvis/agent-runtime';

/** The safe, content-free current state of one conversation for reply drafting. */
export interface ReplyState {
  readonly revision: number;
  readonly partyType: RuntimePartyType;
  readonly assignedActor: RuntimeActor;
  readonly dataClass: RuntimeDataClass;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  /** The subject privacy status; `clear` permits drafting, any other status blocks it. */
  readonly subjectStatus: RuntimeSubjectStatus;
}

/** Supplies the current content-free conversation state. Read at the pre- and post-gateway gates. */
export interface ReplyStateReader {
  read(): ReplyState;
}

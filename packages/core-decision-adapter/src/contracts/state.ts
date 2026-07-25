/**
 * The injected content-free conversation-state reader (QFJ-M3, ADR-0056 §I).
 *
 * The adapter re-reads the current conversation state BEFORE transport and AFTER the response (the
 * double state gate). The reader is provider-neutral and content-free — it exposes only the revision,
 * party type, human-takeover / AI-pause / cancellation flags, and the subject privacy status. It reads
 * no message content; the only concrete implementation is the deterministic fake under `./testing`.
 */
import type { RuntimePartyType, RuntimeSubjectStatus } from '@qf-jarvis/agent-runtime';

/** The safe, content-free current state of one conversation. */
export interface CoreDecisionState {
  readonly revision: number;
  readonly partyType: RuntimePartyType;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  /** The subject privacy status; `clear` permits acceptance, any other status blocks it. */
  readonly subjectStatus: RuntimeSubjectStatus;
}

/** Supplies the current content-free conversation state. Read at the pre-transport and post-response gates. */
export interface CoreDecisionStateReader {
  read(): CoreDecisionState;
}

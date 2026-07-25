/**
 * Thin projections of the ONE authoritative state source into each lower reader shape (QFJ-M5,
 * ADR-0059 §C, §D).
 *
 * Every adapter here closes over the SAME `AuthoritativeConversationStatePort` instance and the same
 * conversation id, so the M2 conversation-context port, the M4 `ReplyStateReader`, the M3
 * `CoreDecisionStateReader`, and the privacy gate all observe one truth. None caches state across an
 * awaited boundary: each `read`/`subjectStatus` re-reads the source, so a change during any await is
 * seen at the next gate and fails closed. These are PURE projections — no business rule; the derived
 * `assignedActor` reuses M1's deterministic `assignAgent` rather than re-deciding routing.
 */
import type {
  ConversationContextPort,
  ConversationPrivacyGate,
  OrchestrationContext,
  RuntimePolicy,
  RuntimeSubjectStatus,
} from '@qf-jarvis/agent-runtime';
import { assignAgent, createOrchestrationContext } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionState, CoreDecisionStateReader } from '@qf-jarvis/core-decision-adapter';
import type { ReplyState, ReplyStateReader } from '@qf-jarvis/model-reply-adapter';

import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
} from '../contracts/authoritative-state.js';

/** The M2 conversation-context port, projected from the single authoritative source. */
export function conversationContextPortFor(
  source: AuthoritativeConversationStatePort,
  conversationId: string,
): ConversationContextPort {
  return Object.freeze({
    async read(): Promise<OrchestrationContext> {
      const s = await source.read(conversationId);
      return createOrchestrationContext({
        conversationId: s.conversationId,
        tenantId: s.tenantId,
        partyType: s.partyType,
        dataClass: s.dataClass,
        revision: s.revision,
        humanTakeover: s.humanTakeover,
        aiPaused: s.aiPaused,
        cancelled: s.cancelled,
        subjectRef: s.subjectRef,
      });
    },
  });
}

/** The M4 reply-state reader, projected from the single authoritative source. */
export function replyStateReaderFor(
  source: AuthoritativeConversationStatePort,
  conversationId: string,
  policy: RuntimePolicy,
): ReplyStateReader {
  return Object.freeze({
    async read(): Promise<ReplyState> {
      const s = await source.read(conversationId);
      return {
        revision: s.revision,
        partyType: s.partyType,
        // Derived with M1's deterministic router — NOT a second routing decision.
        assignedActor: assignAgent(s.partyType, s.humanTakeover, policy),
        dataClass: s.dataClass,
        humanTakeover: s.humanTakeover,
        aiPaused: s.aiPaused,
        cancelled: s.cancelled,
        subjectStatus: s.subjectStatus,
      };
    },
  });
}

/** The M3 Core-decision-state reader, projected from the single authoritative source. */
export function coreStateReaderFor(
  source: AuthoritativeConversationStatePort,
  conversationId: string,
): CoreDecisionStateReader {
  return Object.freeze({
    async read(): Promise<CoreDecisionState> {
      const s = await source.read(conversationId);
      return {
        revision: s.revision,
        partyType: s.partyType,
        humanTakeover: s.humanTakeover,
        aiPaused: s.aiPaused,
        cancelled: s.cancelled,
        subjectStatus: s.subjectStatus,
      };
    },
  });
}

/** The M1 privacy gate, projected from the single authoritative source (same tombstone truth). */
export function privacyGateFor(
  source: AuthoritativeConversationStatePort,
  conversationId: string,
): ConversationPrivacyGate {
  return Object.freeze({
    async subjectStatus(_subjectRef: string): Promise<RuntimeSubjectStatus> {
      const s: ConversationControlState = await source.read(conversationId);
      return s.subjectStatus;
    },
  });
}

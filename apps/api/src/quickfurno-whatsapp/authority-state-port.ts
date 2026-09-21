import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
  ConversationStateKey,
} from '@qf-jarvis/jarvis-runtime';

import type { QuickFurnoWhatsAppAuthorityReader } from './quickfurno-http.js';

/**
 * QuickFurno production authority adapter.
 *
 * Read-only by construction: there is no provision/apply/write capability here.
 * Every runtime read performs a fresh signed QuickFurno authority request through
 * the injected reader, so revision/takeover/pause/privacy changes made while a
 * model call is in flight are observed by the next Jarvis gate.
 */
export function createQuickFurnoWhatsAppAuthorityStatePort(
  reader: QuickFurnoWhatsAppAuthorityReader,
): AuthoritativeConversationStatePort {
  return Object.freeze({
    async read(key: ConversationStateKey): Promise<ConversationControlState> {
      const authority = await reader.read(key);
      return Object.freeze({
        tenantId: authority.tenantId,
        conversationId: authority.conversationId,
        revision: authority.revision,
        partyType: authority.partyType,
        dataClass: authority.dataClass,
        humanTakeover: authority.humanTakeover,
        // jarvisAllowed=false is itself a QuickFurno control fact. Folding it
        // into aiPaused makes the generic runtime block even if the reason is an
        // account-level/route-level Jarvis disable rather than a UI pause.
        aiPaused: authority.aiPaused || !authority.jarvisAllowed,
        cancelled: authority.cancelled,
        subjectStatus: authority.subjectStatus,
        subjectRef: authority.subjectRef,
        observedAt: authority.observedAt,
      });
    },
  });
}

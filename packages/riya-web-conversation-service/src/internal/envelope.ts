/**
 * The WEB envelope builder (RWC-P2C, ADR-0094).
 *
 * INTERNAL. The one place `channel`, `partyType` and `direction` are decided — by the service, never
 * by a caller.
 */
import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { InboundEnvelope } from '@qf-jarvis/agent-runtime';

import { RiyaWebConversationError } from '../contracts/errors.js';
import type { RiyaWebConversationTurnV1 } from '../contracts/turn.js';

/**
 * Build the existing runtime envelope for one WEB turn.
 *
 * No second envelope type exists, and none is needed: JRW-0B (ADR-0092) established that a WEB turn
 * is the EXISTING `InboundEnvelope` with an existing field set, and `providerMessageRef` was already
 * an opaque bounded string.
 *
 * The three fixed values are literals here rather than parameters. A parameter would be a seam
 * somebody could reach — and a caller that could set `partyType: 'VENDOR'` would have Riya answer a
 * browser as though it were a vendor, through prompt selection rules that are scope-bound by design.
 *
 * Re-validated through the canonical constructor, so the runtime's own rules decide what a valid
 * envelope is; this module never becomes a second definition of one.
 */
export function buildWebInboundEnvelope(
  turn: RiyaWebConversationTurnV1,
  runtimeId: string,
): InboundEnvelope {
  try {
    return createInboundEnvelope({
      runtimeId,
      tenantId: turn.tenantId,
      conversationId: turn.conversationId,
      messageId: turn.messageId,
      // Fixed by the service. Not caller-selectable, and not configurable.
      channel: 'WEB',
      partyType: 'CLIENT',
      direction: 'INBOUND',
      receivedAt: turn.receivedAt,
      // The mature runtime field is NOT renamed for the web. It is already opaque and
      // provider-neutral, and renaming a cross-runtime field for one surface would be a breaking
      // change made for tidiness.
      providerMessageRef: turn.webTurnRef,
      dataClass: turn.dataClass,
      ...(turn.subjectRef === undefined ? {} : { subjectRef: turn.subjectRef }),
      ...(turn.normalizedText === undefined ? {} : { normalizedText: turn.normalizedText }),
    });
  } catch {
    // The runtime's own `AgentRuntimeError` is not surfaced: it is a different package's bounded
    // vocabulary, and re-throwing it would make this service's error surface open-ended.
    throw new RiyaWebConversationError('invalid-input');
  }
}

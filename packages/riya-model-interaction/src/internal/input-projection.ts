/**
 * The content-minimised current-continuity projection sent to the model (RWC-P4B, ADR-0099 §9).
 *
 * ### Why the model needs this at all
 *
 * One inference has to behave as a MULTI-TURN Riya: it must not re-ask what the conversation already
 * knows, and it must be able to tell a correction from a first statement. That needs the current
 * state, and there is nowhere else to put it — the envelope is generic and immutable, and stuffing
 * continuity into `normalizedText` would make a person's message and the system's memory the same
 * field.
 *
 * ### What it may carry, and what it must not
 *
 * Present discovery values with their provenance, the phase, `summaryConfirmed`, and the current
 * message. That is all. No `tenantId`, `conversationId`, `messageId` or `subjectRef` — the model has
 * no use for identity and every identifier sent is one that can come back in an answer. No contact
 * detail, consent, `canSubmit`, lead, vendor, package, price or completion evidence: none of those
 * are Jarvis's to hold, let alone to describe to a model. No history, transcript or recent turns.
 *
 * `missingFields` and `completeness` are deliberately omitted: both are DERIVABLE from what is here,
 * and sending a derived value invites the model to reason from a copy that could disagree with the
 * reducer's own computation.
 *
 * ### No instructions live here
 *
 * This is data. How Riya should behave belongs to the evaluated system prompt, whose bytes are sent
 * verbatim and whose digest is matched. Instructions smuggled into dynamic user content would be an
 * un-evaluated prompt that no gate ever reviewed.
 */
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField, NeedDiscovery } from '@qf-jarvis/riya-agent';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

/** Which `NeedDiscovery` value a `DiscoveryField` names. Restated; the canonical set is closed. */
const VALUE_KEY = {
  serviceInterest: 'serviceInterestRef',
  location: 'locationRef',
  propertyType: 'propertyTypeRef',
  scope: 'scopeSummary',
  budget: 'budgetNote',
  timeline: 'timelineNote',
  consultationPreference: 'consultationPreferenceRef',
} as const satisfies Readonly<Record<DiscoveryField, keyof NeedDiscovery>>;

/**
 * The hard bound on the serialized user payload.
 *
 * Separate from — and larger than — the 4096-character inbound message bound, because the payload
 * carries the message PLUS the bounded known-field projection. The inbound bound is unchanged.
 */
export const MAX_RIYA_USER_CONTENT_CHARS = 8192;

/** Build the ONE user message. Deterministic: the same inputs give byte-identical output. */
export function buildRiyaUserContent(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly message: string | undefined;
}): string {
  const { current, message } = args;

  // Iterated in the frozen canonical order rather than over `Object.keys`, so the serialization is
  // stable regardless of how the state object happened to be built.
  const known: Record<string, { value: string; provenance: string }> = {};
  for (const field of DISCOVERY_FIELDS_FROZEN) {
    const value = current.discovery[VALUE_KEY[field]];
    const provenance = current.fieldProvenance[field];
    if (value === undefined || provenance === undefined) {
      continue;
    }
    // Value and provenance travel TOGETHER. A value without its origin would invite the model to
    // overwrite something a person confirmed as though it were its own earlier guess.
    known[field] = { value, provenance };
  }

  const payload = {
    version: 1,
    phase: current.phase,
    known,
    summaryConfirmed: current.summaryConfirmed,
    message: message ?? '',
  };

  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_RIYA_USER_CONTENT_CHARS) {
    // Fail closed BEFORE the gateway. Truncating would send the model a silently different
    // conversation from the one the reducer is about to judge its answer against.
    throw new Error('riya-user-content-too-large');
  }
  return serialized;
}

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
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import type { DiscoveryField, NeedDiscovery } from '@qf-jarvis/riya-agent';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import { projectCoreAvailability } from './availability.js';
import { provenGroundedContext } from './grounded-context.js';
import type { RiyaGroundedKnowledgeContextV1 } from './grounded-context.js';

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
 * carries the message PLUS the bounded known-field projection PLUS the bounded Core availability
 * context. The inbound bound is unchanged.
 *
 * RWC-P5 raised this from 8192 to 12288. The authoritative availability context is itself bounded at
 * 6000 serialized characters by its own contract, and 8192 left roughly 2700 characters of headroom
 * once a maximum-length message and all seven known fields were present -- not enough. This is a
 * RIYA-LOCAL constant: the generic model-gateway request limits and
 * `DEFAULT_GATEWAY_REQUEST_BUDGETS` are deliberately untouched, because one agent needing more room
 * is not a reason every agent should get it.
 */
export const MAX_RIYA_USER_CONTENT_CHARS = 12_288;

/** Build the ONE user message. Deterministic: the same inputs give byte-identical output. */
export function buildRiyaUserContent(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly message: string | undefined;
  readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
  /**
   * Governed knowledge for a grounded turn (RWC-P7), or absent.
   *
   * When absent the serialized payload is BYTE-IDENTICAL to the pre-P7 shape. That is deliberate and
   * asserted: an ungrounded deployment must not have its evaluated prompt silently fed a differently
   * shaped message because a feature it does not use exists.
   */
  readonly groundedKnowledge?: RiyaGroundedKnowledgeContextV1;
}): string {
  const { current, message, availabilitySnapshot } = args;

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
    // The CURRENT Core-owned business authority, kept structurally separate from `known` (RWC-P5,
    // ADR-0100 s15). `known` is what this conversation believes; `coreAvailability` is what the
    // business currently sells and where. Folding one into the other would invite the model to treat
    // a catalogue entry as something the client said -- or a client's words as a catalogue fact.
    coreAvailability: projectCoreAvailability(availabilitySnapshot),
    message: message ?? '',
    // ONE additive sibling, and only when a grounded turn actually retrieved something (RWC-P7,
    // ADR-0103 s8). Structurally separate from `coreAvailability` for the same reason that is separate
    // from `known`: P5 is what the business currently sells and where, and it OUTRANKS a governed
    // snapshot for current availability. Folding them together would invite the model to answer a
    // live question from a document.
    //
    // Re-proved on the way in, so a context carrying a permission, an owner or a subject reference is
    // a refusal rather than a field that happens not to be read today.
    ...(args.groundedKnowledge === undefined
      ? {}
      : { groundedKnowledge: provenGroundedContext(args.groundedKnowledge) }),
  };

  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_RIYA_USER_CONTENT_CHARS) {
    // Fail closed BEFORE the gateway. Truncating would send the model a silently different
    // conversation from the one the reducer is about to judge its answer against.
    throw new Error('riya-user-content-too-large');
  }
  return serialized;
}

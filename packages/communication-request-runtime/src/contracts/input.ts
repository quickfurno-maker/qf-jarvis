/**
 * The runtime input (QFJ-P08, ADR-0133).
 *
 * ### What a caller may state, and what it may not
 *
 * Eleven fields, and every one of them is a fact with **no safer canonical source**: which governed
 * action this is about, who Core should resolve, what purpose Core should validate the request
 * against, which channel is being *proposed*, which approved template or script would be rendered,
 * when the requester would like it to happen, and when the ask dies.
 *
 * Everything governance-shaped is absent, because it is DERIVED from the recommendation in
 * `create-communication-request-runtime.ts`: `requiredApproval`, `priority`, `requestingAgent`,
 * `requestingAgentVersion`, `correlationId`, `summary`, `producingSystem` and both identities. That
 * is the same reasoning `@qf-jarvis/approval-runtime` applies to `risk` and `requestedAuthority`,
 * and it matters more here, not less. A caller able to restate `requiredApproval` could take a
 * recommendation that requires founder approval and ask about it as `authorized-team-human` — or
 * propose an outbound VOICE call, which the contract requires explicit human approval for, while
 * naming a weaker level. The request is a faithful ask about an existing recommendation, not a
 * second chance to set its governance.
 *
 * `policy` is the one governance-shaped field a caller does supply, and it is a CITATION, not an
 * authority (`policyReferenceSchema` is strict, so the policy's contents cannot travel with the
 * reference).
 *
 * ### The schema is `strictObject`, and that is a security control
 *
 * An unknown key is a refusal, not something quietly dropped. So `approved`, `authorized`,
 * `canSend`, `canExecute`, `eligible`, `consent`, `hasConsent`, `optedIn`, `optedOut`, `stop`,
 * `dnc`, `suppressed`, `permission`, `validUntil`, `authorizedUntil`, `sent`, `delivered`,
 * `provider`, `destination`, `phone`, `phoneNumber`, `email`, `webhook`, `workflowId`,
 * `executionIntentId`, `executionResultId` and `idempotencyKey` are all unknown keys here. Offering
 * one is an `invalid-input` refusal rather than a value that silently disappears — and a field that
 * silently disappears is how a caller comes to believe it was honoured.
 *
 * ### `recipient` is a reference, and `content` is a reference
 *
 * `entityReferenceSchema` excludes `@` and `+` from an entity id, so an email address and an E.164
 * number will not parse. `contentReferenceSchema` names an approved template or script and its
 * version; there is **no message body field**, and `templateVariablesSchema` refuses `body`,
 * `message`, `text`, `content` and `script` by key, alongside the always-forbidden credential,
 * contact, raw-provider-content and model-internal sets by key *and* by value shape. Both are the
 * canonical contract schemas, reused unchanged — this package adds no rule of its own to them and
 * relaxes none.
 */
import {
  communicationChannelSchema,
  contentReferenceSchema,
  entityReferenceSchema,
  eventIdSchema,
  policyReferenceSchema,
  reasonCodeSchema,
  requestedTimingSchema,
  utcTimestampSchema,
} from '@qf-jarvis/contracts';
import type {
  ActionId,
  CommunicationChannel,
  ContentReference,
  EntityReference,
  EventId,
  PolicyReference,
  ReasonCode,
  RequestedTiming,
  UtcTimestamp,
} from '@qf-jarvis/contracts';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';
import { z } from 'zod';

/**
 * `source` and `proposedActionId` are validated structurally elsewhere.
 *
 * `z.unknown()` here is not laziness. `RecommendationRuntimeResult` is a deep governed artifact, and
 * re-declaring its shape in this package would create a second definition of a contract that
 * `@qf-jarvis/contracts` already owns — one that could drift. It is parsed with the REAL schema, and
 * its bindings are re-proved against a recomputed digest, in `source-validation.ts`.
 */
export const communicationRequestRuntimeInputSchema = z.strictObject({
  source: z.unknown(),
  proposedActionId: z.unknown(),
  recipient: entityReferenceSchema,
  purposeCode: reasonCodeSchema,
  proposedChannel: communicationChannelSchema,
  content: contentReferenceSchema,
  requestedTiming: requestedTimingSchema,
  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  policy: policyReferenceSchema,
  causationEventId: eventIdSchema.optional(),
});

/** What a caller supplies to ASK about ONE action of an already-created recommendation. */
export interface CommunicationRequestRuntimeInput {
  /** The exact result `@qf-jarvis/recommendation-runtime` returned. Re-validated, never trusted. */
  readonly source: RecommendationRuntimeResult;
  /** Which of that recommendation's proposed actions this communication would carry out. */
  readonly proposedActionId: ActionId;
  /**
   * WHO Core should resolve. An opaque Core entity reference, never a destination.
   *
   * Deliberately caller-stated rather than taken from `recommendation.subject`. A recommendation's
   * subject is what it is ABOUT; the party a communication reaches is not always that party, and
   * assuming otherwise would silently address the wrong person on the recommendations where they
   * differ. Nothing in the canonical contracts equates the two, so nothing here does either.
   */
  readonly recipient: EntityReference;
  /** The approved purpose this communication serves. Core validates it against policy. */
  readonly purposeCode: ReasonCode;
  /** PROPOSED, not chosen. Core may refuse it, name another, or refuse the whole request. */
  readonly proposedChannel: CommunicationChannel;
  /** An approved template (messaging) or script (voice), by reference and version. Never a body. */
  readonly content: ContentReference;
  /** When the requester would LIKE this to happen. Not a schedule, and not permission. */
  readonly requestedTiming: RequestedTiming;
  readonly createdAt: UtcTimestamp;
  /** Mandatory. An unanswered request expires; it is never sent late and never auto-approved. */
  readonly expiresAt: UtcTimestamp;
  /** The policy Jarvis believed applied. A citation; Core's answer is the one that counts. */
  readonly policy: PolicyReference;
  readonly causationEventId?: EventId;
}

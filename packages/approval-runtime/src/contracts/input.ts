/**
 * The runtime inputs (QFJ-P08, ADR-0080).
 *
 * ### The request input is deliberately tiny
 *
 * Six fields, and four of them are timing, policy and causation. Everything that describes WHAT is
 * being asked about — the recommendation, the action, its fingerprint, its risk, the authority it
 * needs, the requesting agent, the correlation thread, the wording — is DERIVED from the governed
 * recommendation the caller supplies.
 *
 * That is the whole point of the shape. `risk` and `requiredApproval` were governed once already,
 * when `recommendationV1Schema` validated the recommendation: money-related escalates,
 * informational proposes nothing, and a wrong pairing was refused. If `createRequest` accepted them
 * again, a caller could take a `money-related` + `founder` recommendation and ask about it as
 * `money-related` + `delegated-approver` — laundering an approval down to someone who should never
 * have seen it, with a perfectly valid recommendation sitting behind it. The request is a faithful
 * ask about an existing recommendation, not a second chance to set its governance.
 *
 * `policy` is the one governance-shaped field a caller does supply, and it is a CITATION, not an
 * authority (`policyReferenceSchema` is strict, so the policy's contents cannot travel with the
 * reference). Recording which policy Jarvis believed applied is what makes a later mismatch with
 * Core's policy visible rather than silent.
 *
 * Both schemas are `strictObject`: an unknown key is a refusal, not something quietly dropped.
 */
import { eventIdSchema, policyReferenceSchema, utcTimestampSchema } from '@qf-jarvis/contracts';
import type {
  ActionId,
  ApprovalDecisionV1,
  ApprovalRequestV1,
  EventId,
  PolicyReference,
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
export const approvalRequestRuntimeInputSchema = z.strictObject({
  source: z.unknown(),
  proposedActionId: z.unknown(),
  createdAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  policy: policyReferenceSchema,
  causationEventId: eventIdSchema.optional(),
});

/** What a caller supplies to ask about ONE action of an already-created recommendation. */
export interface ApprovalRequestRuntimeInput {
  /** The exact result `@qf-jarvis/recommendation-runtime` returned. Re-validated, never trusted. */
  readonly source: RecommendationRuntimeResult;
  /** Which of that recommendation's proposed actions this asks about. */
  readonly proposedActionId: ActionId;
  readonly createdAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  /** The policy Jarvis believed applied. A citation; Core's answer is the one that counts. */
  readonly policy: PolicyReference;
  readonly causationEventId?: EventId;
}

/** Same treatment: parsed with the real contracts schemas, never re-declared here. */
export const approvalDecisionValidationInputSchema = z.strictObject({
  source: z.unknown(),
  request: z.unknown(),
  decision: z.unknown(),
});

/**
 * What a caller supplies to correlate a decision Core has ALREADY issued.
 *
 * This method obtains nothing. The decision arrived from a boundary outside this package — a Core
 * transport that does not exist yet — and all three values are treated as untrusted structural
 * input, including the request, which may have been serialized, stored and read back by something
 * that is not this runtime.
 */
export interface ApprovalDecisionValidationInput {
  readonly source: RecommendationRuntimeResult;
  readonly request: ApprovalRequestV1;
  readonly decision: ApprovalDecisionV1;
}

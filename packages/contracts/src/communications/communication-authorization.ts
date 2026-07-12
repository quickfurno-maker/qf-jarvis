/**
 * CommunicationAuthorizationV1 — the QuickFurno Communication Core decided.
 *
 * This is the artifact that makes the phrase "Core is the consent authority" mean
 * something operationally rather than rhetorically. A `CommunicationRequestV1` asks; this
 * answers; and **only this can authorize**.
 *
 * ### Why an authorization is not an approval decision
 *
 * `ApprovalDecisionV1` records that a *human or policy approved an action*. This records
 * that the **Communication Core validated the recipient's eligibility** — consent
 * evidence, preferences, suppressions, STOP/START state, do-not-contact status, approved
 * purpose, attempt limits, quiet hours.
 *
 * They are different questions, and a communication needs *both* to be yes. A founder can
 * approve a message to a client who has opted out, and the message must still not be
 * sent. **A communication request for an opted-out recipient is refused — including one
 * the founder made.** Merging the two contracts would make that sentence unenforceable,
 * because there would be only one "approved" to check.
 *
 * ### Refusal reasons are structured, and opt-out is one of them
 *
 * There is no `opted-out` communication *state* — that would be a nineteenth state and it
 * would fork the lifecycle, letting a consumer handle `rejected` while quietly ignoring
 * "opted out", which is the one refusal that must never be ignored. So an opt-out is a
 * `rejected` outcome with a machine-readable reason, and it is countable
 * (communication-state.ts).
 *
 * ### Eligibility is evaluated at execution time, not here
 *
 * This record says what Core decided **when it decided**. It is not a permission slip
 * that travels forward in time. A scheduled communication whose recipient withdraws
 * consent before the scheduled moment is **not sent** — the runtime re-validates against
 * Core at execution time, and Core's answer then is the one that counts
 * (communication-model.md).
 *
 * That is why this contract carries no `validUntil` and no consent snapshot. A consent
 * snapshot with a future expiry is precisely the stale permission that lets a withdrawn
 * consent be ignored.
 */

import { z } from 'zod';

import {
  communicationIdSchema,
  communicationRequestIdSchema,
  correlationIdSchema,
  decisionIdSchema,
} from '../common/identifiers.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { communicationChannelSchema } from './communication-channel.js';
import { policyReferenceSchema } from '../common/policy.js';
import { quickfurnoCoreSchema } from '../common/systems.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const COMMUNICATION_AUTHORIZATION_CONTRACT_VERSION = 1;

export const COMMUNICATION_AUTHORIZATION_OUTCOMES = ['authorized', 'rejected'] as const;

export const communicationAuthorizationOutcomeSchema = z.enum(COMMUNICATION_AUTHORIZATION_OUTCOMES);
export type CommunicationAuthorizationOutcome = z.infer<
  typeof communicationAuthorizationOutcomeSchema
>;

/**
 * The refusals that must be individually countable.
 *
 * Not an exhaustive list of everything Core may refuse for — `reasonCode` is open, and
 * Core owns its own reason taxonomy. These are the ones the architecture *names*, and
 * they are exported so that a consumer can check for them explicitly rather than
 * pattern-matching on a string it hopes is stable.
 *
 * Every one of these is a refusal that must never be silently retried.
 */
export const COMMUNICATION_REFUSAL_REASONS = [
  'recipient-opted-out',
  'consent-withdrawn',
  'do-not-contact',
  'suppressed',
  'stop-received',
  'purpose-not-approved',
  'attempt-limit-reached',
  'quiet-hours',
  'identity-unverified',
  'channel-not-eligible',
] as const;

export type CommunicationRefusalReason = (typeof COMMUNICATION_REFUSAL_REASONS)[number];

const communicationAuthorizationShapeSchema = z.strictObject({
  contractVersion: z.literal(COMMUNICATION_AUTHORIZATION_CONTRACT_VERSION),

  communicationId: communicationIdSchema,
  communicationRequestId: communicationRequestIdSchema,

  /** The authority. Always Core — specifically, the QuickFurno Communication Core. */
  issuer: quickfurnoCoreSchema,

  outcome: communicationAuthorizationOutcomeSchema,

  /** The channel Core actually authorized. It may not be the one that was proposed. */
  authorizedChannel: communicationChannelSchema.optional(),

  /**
   * The human or policy approval this authorization rests on.
   *
   * Required when authorized. A communication needs **both** a human's approval and
   * Core's eligibility check — this field is where the first one is named, and its
   * absence on an authorization would mean Core authorized a message nobody approved.
   */
  approvalDecisionId: decisionIdSchema.optional(),

  decidedAt: utcTimestampSchema,

  /** Why. For a rejection, this is the field that carries the opt-out. */
  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export const communicationAuthorizationV1Schema = communicationAuthorizationShapeSchema.superRefine(
  (value, ctx) => {
    if (value.outcome === 'authorized') {
      if (value.authorizedChannel === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['authorizedChannel'],
          message: 'An authorized communication must name the channel Core authorized',
        });
      }

      // Core's eligibility check is not a substitute for a human's approval. Both are
      // required, and an authorization that names no approval is Core authorizing a
      // message that nobody agreed to send.
      if (value.approvalDecisionId === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['approvalDecisionId'],
          message:
            'An authorized communication must name the approval decision it rests on. Eligibility is not approval, and both are required',
        });
      }
    }

    if (value.outcome === 'rejected') {
      if (value.authorizedChannel !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['authorizedChannel'],
          message: 'A rejected communication authorizes no channel',
        });
      }

      if (value.approvalDecisionId !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['approvalDecisionId'],
          message:
            'A rejected communication must not name an approval decision as though it rested on one. Core refused it — whether or not a human had approved it',
        });
      }
    }
  },
);

export type CommunicationAuthorizationV1 = z.infer<typeof communicationAuthorizationV1Schema>;

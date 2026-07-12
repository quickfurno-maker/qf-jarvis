/**
 * Client reassignment: the request, and the decision.
 *
 * Two contracts, and keeping them apart is the point. **Riya asks. Core decides.**
 *
 * `ClientReassignmentRequestV1` is produced by QF Jarvis, carries no authority, and —
 * critically — **contains no vendors**. There is no field in which Riya could name a
 * replacement vendor even if she concluded one. Choosing vendors is Core's, and the
 * request has no shape in which to smuggle a choice.
 *
 * `ClientReassignmentDecisionV1` is issued by QuickFurno Core, decided by a human or
 * a named policy, and it is the only thing that can authorize a replacement batch.
 *
 * ### Dissatisfaction is never inferred
 *
 * The request requires a `ClientConfirmationV1` — an artifact pointing at the
 * canonical event in which the client actually said so. An agent noticing that a
 * client has gone quiet, or scoring a conversation as unhappy, is **evidence**, not
 * confirmation. The two live in different fields precisely so that nobody can
 * promote the first into the second by being confident about it.
 *
 * The failure this prevents is concrete and expensive: three new vendors are
 * contacted about a real person's home renovation because a model decided their tone
 * had cooled. That is not a recoverable error — the vendors have been paid for in
 * lead value, and the client has been shopped around without asking.
 */

import { z } from 'zod';

import {
  assignmentBatchIdSchema,
  correlationIdSchema,
  eventIdSchema,
  reassignmentDecisionIdSchema,
  reassignmentRequestIdSchema,
} from '../common/identifiers.js';
import { actorReferenceSchema } from '../common/actor.js';
import { agentIdSchema, qfJarvisSchema, quickfurnoCoreSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { clientConfirmationV1Schema } from './client-confirmation.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { evidenceItemSchema, MAX_EVIDENCE_ITEMS } from '../recommendations/recommendation.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { policyReferenceSchema } from '../common/policy.js';

export const CLIENT_REASSIGNMENT_REQUEST_CONTRACT_VERSION = 1;
export const CLIENT_REASSIGNMENT_DECISION_CONTRACT_VERSION = 1;

/**
 * How badly it went. A stable band, not a model's score.
 *
 * Bands are countable, so "how often does a reassignment follow a `severe`?" has an
 * answer, and a drift in that answer is a signal.
 */
export const DISSATISFACTION_SEVERITIES = ['mild', 'moderate', 'severe'] as const;

export const dissatisfactionSeveritySchema = z.enum(DISSATISFACTION_SEVERITIES);
export type DissatisfactionSeverity = z.infer<typeof dissatisfactionSeveritySchema>;

// ---------------------------------------------------------------------------
// The request — Jarvis asking
// ---------------------------------------------------------------------------

const clientReassignmentRequestShapeSchema = z.strictObject({
  reassignmentRequestId: reassignmentRequestIdSchema,
  contractVersion: z.literal(CLIENT_REASSIGNMENT_REQUEST_CONTRACT_VERSION),

  /** The lead-category pair whose batch the client is unhappy with. */
  lead: entityReferenceSchema,
  category: entityReferenceSchema,
  client: entityReferenceSchema,

  /** The batch being complained about. */
  currentBatchId: assignmentBatchIdSchema,

  /** Only QF Jarvis asks. Riya never assigns, and cannot name a vendor here. */
  producingSystem: qfJarvisSchema,
  requestingAgent: agentIdSchema,
  requestingAgentVersion: machineTokenSchema,

  /**
   * Why we think the client is dissatisfied — the *evidence*.
   *
   * Mandatory and non-empty. "A recommendation without evidence is a defect"
   * (agent-model.md), and a reassignment request is a recommendation with real
   * consequences for real vendors.
   */
  dissatisfaction: z.strictObject({
    reasonCode: reasonCodeSchema,
    severity: dissatisfactionSeveritySchema,
    evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),
  }),

  /**
   * The client's explicit confirmation. **Mandatory.**
   *
   * Evidence says *we think they are unhappy*. This says *they asked*. Only the
   * second one may move vendors.
   */
  clientConfirmation: clientConfirmationV1Schema,

  summary: boundedText(TEXT_LIMITS.summary),

  policy: policyReferenceSchema,

  createdAt: utcTimestampSchema,
  /** Mandatory. An unanswered request expires; it never ripens into an authorization. */
  expiresAt: utcTimestampSchema,

  correlationId: correlationIdSchema,
  causationEventId: eventIdSchema.optional(),
});

export const clientReassignmentRequestV1Schema = clientReassignmentRequestShapeSchema.superRefine(
  (value, ctx) => {
    if (!isStrictlyBefore(value.createdAt, value.expiresAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be strictly after createdAt',
      });
    }

    // The person who confirmed must be the client whose lead this is. A confirmation
    // from somebody else is not a confirmation.
    if (value.clientConfirmation.confirmedBy.entityId !== value.client.entityId) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientConfirmation', 'confirmedBy'],
        message: 'The confirming party must be the client named on the request',
      });
    }

    // A confirmation dated after the request was made was not available when the
    // request was made, which means the request was not actually based on it.
    if (isStrictlyBefore(value.createdAt, value.clientConfirmation.confirmedAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientConfirmation', 'confirmedAt'],
        message:
          'The client confirmation must not post-date the request. A request cannot be justified by a confirmation that had not happened yet',
      });
    }
  },
);

export type ClientReassignmentRequestV1 = z.infer<typeof clientReassignmentRequestV1Schema>;

// ---------------------------------------------------------------------------
// The decision — Core deciding
// ---------------------------------------------------------------------------

export const REASSIGNMENT_OUTCOMES = ['authorized', 'rejected'] as const;

export const reassignmentOutcomeSchema = z.enum(REASSIGNMENT_OUTCOMES);
export type ReassignmentOutcome = z.infer<typeof reassignmentOutcomeSchema>;

const clientReassignmentDecisionShapeSchema = z.strictObject({
  reassignmentDecisionId: reassignmentDecisionIdSchema,
  contractVersion: z.literal(CLIENT_REASSIGNMENT_DECISION_CONTRACT_VERSION),

  reassignmentRequestId: reassignmentRequestIdSchema,

  /** The authority. Always Core. */
  issuer: quickfurnoCoreSchema,

  /** A named human, or a named and versioned policy. Never an agent — there is no variant. */
  decidedBy: actorReferenceSchema,
  decidedAt: utcTimestampSchema,

  outcome: reassignmentOutcomeSchema,

  /**
   * The batch Core created as a result. Present exactly when authorized.
   *
   * An authorization that produced no batch authorized nothing; a rejection that
   * produced one is a contradiction.
   */
  authorizedBatchId: assignmentBatchIdSchema.optional(),

  reasonCode: reasonCodeSchema,
  explanation: boundedText(TEXT_LIMITS.explanation).optional(),

  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
});

export const clientReassignmentDecisionV1Schema = clientReassignmentDecisionShapeSchema.superRefine(
  (value, ctx) => {
    if (value.outcome === 'authorized' && value.authorizedBatchId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizedBatchId'],
        message: 'An authorized reassignment must name the replacement batch Core created',
      });
    }

    if (value.outcome === 'rejected' && value.authorizedBatchId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizedBatchId'],
        message: 'A rejected reassignment must not name an authorized batch',
      });
    }
  },
);

export type ClientReassignmentDecisionV1 = z.infer<typeof clientReassignmentDecisionV1Schema>;

/**
 * ExtraVendorReviewRequestV1 / DecisionV1.
 *
 * The client may ask for more comparison, but Riya cannot extend vendor exposure.
 * She may only ask Core to review the request. Core re-reads the lead, current
 * assignment state and policy; the contract contains no vendor identities or count.
 */
import { z } from 'zod';

import { actorReferenceSchema } from '../common/actor.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import {
  assignmentBatchIdSchema,
  correlationIdSchema,
  eventIdSchema,
  extraVendorReviewDecisionIdSchema,
  extraVendorReviewRequestIdSchema,
} from '../common/identifiers.js';
import { policyReferenceSchema } from '../common/policy.js';
import { qfJarvisSchema, quickfurnoCoreSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { evidenceItemSchema, MAX_EVIDENCE_ITEMS } from '../recommendations/recommendation.js';
import { clientConfirmationV1Schema } from './client-confirmation.js';

export const EXTRA_VENDOR_REVIEW_REQUEST_CONTRACT_VERSION = 1;
export const EXTRA_VENDOR_REVIEW_DECISION_CONTRACT_VERSION = 1;
export const extraVendorReviewRequestV1Schema = z
  .strictObject({
    extraVendorReviewRequestId: extraVendorReviewRequestIdSchema,
    contractVersion: z.literal(EXTRA_VENDOR_REVIEW_REQUEST_CONTRACT_VERSION),
    client: entityReferenceSchema,
    lead: entityReferenceSchema,
    category: entityReferenceSchema,
    currentBatchId: assignmentBatchIdSchema,
    expectedLeadRevision: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    producingSystem: qfJarvisSchema,
    requestingAgent: z.literal('riya'),
    requestingAgentVersion: machineTokenSchema,
    evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),
    clientConfirmation: clientConfirmationV1Schema,
    summary: boundedText(TEXT_LIMITS.summary),
    reasonCode: reasonCodeSchema,
    policy: policyReferenceSchema,
    createdAt: utcTimestampSchema,
    expiresAt: utcTimestampSchema,
    correlationId: correlationIdSchema,
    causationEventId: eventIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!isStrictlyBefore(value.createdAt, value.expiresAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'expiresAt must be strictly after createdAt',
      });
    }
    if (value.clientConfirmation.confirmedBy.entityId !== value.client.entityId) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientConfirmation', 'confirmedBy'],
        message: 'The confirming party must be the client named on the request',
      });
    }
    if (isStrictlyBefore(value.createdAt, value.clientConfirmation.confirmedAt)) {
      ctx.addIssue({
        code: 'custom',
        path: ['clientConfirmation', 'confirmedAt'],
        message: 'The client confirmation must not post-date the request',
      });
    }
  });

export type ExtraVendorReviewRequestV1 = z.infer<typeof extraVendorReviewRequestV1Schema>;

export const EXTRA_VENDOR_REVIEW_OUTCOMES = [
  'authorized_additional_batch',
  'rejected',
  'wait_for_vendor_response',
  'human_review_required',
] as const;
export const extraVendorReviewOutcomeSchema = z.enum(EXTRA_VENDOR_REVIEW_OUTCOMES);
export type ExtraVendorReviewOutcome = z.infer<typeof extraVendorReviewOutcomeSchema>;
export const extraVendorReviewDecisionV1Schema = z
  .strictObject({
    extraVendorReviewDecisionId: extraVendorReviewDecisionIdSchema,
    contractVersion: z.literal(EXTRA_VENDOR_REVIEW_DECISION_CONTRACT_VERSION),
    extraVendorReviewRequestId: extraVendorReviewRequestIdSchema,
    issuer: quickfurnoCoreSchema,
    decidedBy: actorReferenceSchema,
    decidedAt: utcTimestampSchema,
    outcome: extraVendorReviewOutcomeSchema,
    authorizedBatchId: assignmentBatchIdSchema.optional(),
    reasonCode: reasonCodeSchema,
    explanation: boundedText(TEXT_LIMITS.explanation).optional(),
    policy: policyReferenceSchema,
    correlationId: correlationIdSchema,
  })
  .superRefine((value, ctx) => {
    const authorized = value.outcome === 'authorized_additional_batch';
    if (authorized !== (value.authorizedBatchId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizedBatchId'],
        message: 'authorizedBatchId is present exactly when Core authorizes an additional batch',
      });
    }
  });

export type ExtraVendorReviewDecisionV1 = z.infer<typeof extraVendorReviewDecisionV1Schema>;

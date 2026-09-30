/**
 * ClientMatchRequestV1 / ClientMatchDecisionV1.
 *
 * Riya may ask QuickFurno Core to evaluate matching readiness. She never chooses
 * vendors, never requests named vendors, and never controls batch size. Core
 * revalidates the lead, category, client confirmation and current revision.
 */
import { z } from 'zod';

import { actorReferenceSchema } from '../common/actor.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import {
  assignmentBatchIdSchema,
  clientMatchDecisionIdSchema,
  clientMatchRequestIdSchema,
  correlationIdSchema,
  eventIdSchema,
} from '../common/identifiers.js';
import { policyReferenceSchema } from '../common/policy.js';
import { qfJarvisSchema, quickfurnoCoreSchema } from '../common/systems.js';
import { boundedText, machineTokenSchema, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { evidenceItemSchema, MAX_EVIDENCE_ITEMS } from '../recommendations/recommendation.js';
import { clientConfirmationV1Schema } from './client-confirmation.js';

export const CLIENT_MATCH_REQUEST_CONTRACT_VERSION = 1;
export const CLIENT_MATCH_DECISION_CONTRACT_VERSION = 1;
export const clientMatchRequestV1Schema = z
  .strictObject({
    matchRequestId: clientMatchRequestIdSchema,
    contractVersion: z.literal(CLIENT_MATCH_REQUEST_CONTRACT_VERSION),
    client: entityReferenceSchema,
    lead: entityReferenceSchema,
    category: entityReferenceSchema,
    expectedLeadRevision: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    producingSystem: qfJarvisSchema,
    requestingAgent: z.literal('riya'),
    requestingAgentVersion: machineTokenSchema,
    evidence: z.array(evidenceItemSchema).min(1).max(MAX_EVIDENCE_ITEMS),
    clientConfirmation: clientConfirmationV1Schema,
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

export type ClientMatchRequestV1 = z.infer<typeof clientMatchRequestV1Schema>;

export const CLIENT_MATCH_OUTCOMES = [
  'authorized',
  'not_ready',
  'rejected',
  'human_review_required',
  'retry_later',
] as const;
export const clientMatchOutcomeSchema = z.enum(CLIENT_MATCH_OUTCOMES);
export type ClientMatchOutcome = z.infer<typeof clientMatchOutcomeSchema>;
export const clientMatchDecisionV1Schema = z
  .strictObject({
    matchDecisionId: clientMatchDecisionIdSchema,
    contractVersion: z.literal(CLIENT_MATCH_DECISION_CONTRACT_VERSION),
    matchRequestId: clientMatchRequestIdSchema,
    issuer: quickfurnoCoreSchema,
    decidedBy: actorReferenceSchema,
    decidedAt: utcTimestampSchema,
    outcome: clientMatchOutcomeSchema,
    authorizedBatchId: assignmentBatchIdSchema.optional(),
    missingFieldCodes: z.array(machineTokenSchema).max(16).optional(),
    reasonCode: reasonCodeSchema,
    explanation: boundedText(TEXT_LIMITS.explanation).optional(),
    policy: policyReferenceSchema,
    correlationId: correlationIdSchema,
  })
  .superRefine((value, ctx) => {
    const authorized = value.outcome === 'authorized';
    if (authorized !== (value.authorizedBatchId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizedBatchId'],
        message: 'authorizedBatchId is present exactly when the match is authorized',
      });
    }

    const notReady = value.outcome === 'not_ready';
    const missing = value.missingFieldCodes ?? [];
    if (notReady && missing.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['missingFieldCodes'],
        message: 'A not_ready decision must name at least one missing field code',
      });
    }
    if (!notReady && missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['missingFieldCodes'],
        message: 'Only a not_ready decision may carry missing field codes',
      });
    }
    if (new Set(missing).size !== missing.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['missingFieldCodes'],
        message: 'missingFieldCodes must be unique',
      });
    }
  });

export type ClientMatchDecisionV1 = z.infer<typeof clientMatchDecisionV1Schema>;

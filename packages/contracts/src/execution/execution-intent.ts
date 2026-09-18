/**
 * ExecutionIntentV1 — a narrow, expiring authorization to do one specific thing.
 *
 * Jarvis cannot construct one. QuickFurno Core is the issuer and QuickFurno Core Automation is the
 * only executor. Temporal is deliberately absent: durable orchestration never becomes execution
 * authority. Every effect still carries an idempotency key and at-most-once semantics.
 */
import { z } from 'zod';
import {
  actionIdSchema,
  contractVersionSchema,
  correlationIdSchema,
  decisionIdSchema,
  executionIntentIdSchema,
  idempotencyKeySchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { executionParametersSchema } from '../common/governed-parameters.js';
import { quickfurnoCoreAutomationSchema, quickfurnoCoreSchema } from '../common/systems.js';
import { machineTokenSchema } from '../common/text.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';

export const deliverySemanticsSchema = z.literal('at-most-once');
export type DeliverySemantics = z.infer<typeof deliverySemanticsSchema>;
export const EXECUTION_INTENT_CONTRACT_VERSION = 1;

const executionIntentShapeSchema = z.strictObject({
  executionIntentId: executionIntentIdSchema,
  contractVersion: z.literal(EXECUTION_INTENT_CONTRACT_VERSION),
  recommendationId: recommendationIdSchema,
  approvalDecisionId: decisionIdSchema,
  approvedActionId: actionIdSchema,
  actionType: machineTokenSchema,
  actionContractVersion: contractVersionSchema,
  parameters: executionParametersSchema,
  issuer: quickfurnoCoreSchema,
  executor: quickfurnoCoreAutomationSchema,
  issuedAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  idempotencyKey: idempotencyKeySchema,
  deliverySemantics: deliverySemanticsSchema,
  correlationId: correlationIdSchema,
});

export const executionIntentV1Schema = executionIntentShapeSchema.superRefine((value, ctx) => {
  if (!isStrictlyBefore(value.issuedAt, value.expiresAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'expiresAt must be strictly after issuedAt',
    });
  }
});
export type ExecutionIntentV1 = z.infer<typeof executionIntentV1Schema>;

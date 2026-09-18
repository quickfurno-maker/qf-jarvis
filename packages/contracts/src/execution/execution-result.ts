/**
 * ExecutionResultV1 — what actually happened, as recorded by QuickFurno Core.
 *
 * Core Automation and the Communications Runtime may report evidence. Reporting is not authority;
 * QuickFurno Core records the authoritative result. Ambiguous outcomes stay first-class and must be
 * reconciled before any new attempt.
 */
import { z } from 'zod';
import {
  correlationIdSchema,
  executionIntentIdSchema,
  executionResultIdSchema,
  providerReferenceSchema,
} from '../common/identifiers.js';
import { resultMetadataSchema } from '../common/governed-parameters.js';
import { executionReportingSystemSchema } from '../common/systems.js';
import { boundedText, reasonCodeSchema, TEXT_LIMITS } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';

export const EXECUTION_OUTCOMES = [
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'indeterminate',
] as const;
export const executionOutcomeSchema = z.enum(EXECUTION_OUTCOMES);
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;

export const FAILURE_CATEGORIES = [
  'transient',
  'permanent',
  'validation',
  'policy',
  'provider',
  'ambiguous',
  'unknown',
] as const;
export const failureCategorySchema = z.enum(FAILURE_CATEGORIES);
export type FailureCategory = z.infer<typeof failureCategorySchema>;

export const RETRY_CLASSIFICATIONS = [
  'retryable',
  'not-retryable',
  'requires-reconciliation',
] as const;
export const retryClassificationSchema = z.enum(RETRY_CLASSIFICATIONS);
export type RetryClassification = z.infer<typeof retryClassificationSchema>;

export const executionFailureSchema = z.strictObject({
  failureCode: reasonCodeSchema,
  failureCategory: failureCategorySchema,
  retryClassification: retryClassificationSchema,
  description: boundedText(TEXT_LIMITS.description).optional(),
});
export type ExecutionFailure = z.infer<typeof executionFailureSchema>;

export const EXECUTION_RESULT_CONTRACT_VERSION = 1;
const executionResultShapeSchema = z.strictObject({
  executionResultId: executionResultIdSchema,
  executionIntentId: executionIntentIdSchema,
  contractVersion: z.literal(EXECUTION_RESULT_CONTRACT_VERSION),
  reportingSystem: executionReportingSystemSchema,
  recordedByCoreAt: utcTimestampSchema,
  providerOccurredAt: utcTimestampSchema.optional(),
  outcome: executionOutcomeSchema,
  providerReference: providerReferenceSchema.optional(),
  failure: executionFailureSchema.optional(),
  metadata: resultMetadataSchema.optional(),
  correlationId: correlationIdSchema,
});

export const executionResultV1Schema = executionResultShapeSchema.superRefine((value, ctx) => {
  if (value.outcome === 'succeeded' && value.failure !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['failure'],
      message: 'A succeeded result must not carry a failure',
    });
  }
  if (value.outcome === 'failed' && value.failure === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['failure'],
      message: 'A failed result must carry a structured failure',
    });
  }
  if (value.outcome === 'indeterminate') {
    if (value.failure === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message:
          'An indeterminate result must carry a structured failure classified as requires-reconciliation',
      });
    } else if (value.failure.retryClassification !== 'requires-reconciliation') {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'retryClassification'],
        message: 'An indeterminate outcome must be classified requires-reconciliation',
      });
    }
  }
});
export type ExecutionResultV1 = z.infer<typeof executionResultV1Schema>;

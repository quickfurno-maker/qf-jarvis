/**
 * ExecutionResultV1 — what actually happened, as recorded by QuickFurno Core.
 *
 * The distinction this contract exists to protect: **reporting is not authority.**
 * n8n and the QF Communications Runtime *observe* what a provider did and report
 * it. The result becomes truth when **Core records it** and emits the canonical
 * event. "A provider's own view of a delivery is not truth until Core has recorded
 * it" (execution-governance.md §6).
 *
 * That is why `reportingSystem` may be n8n or the runtime, while the canonical
 * event carrying this payload is always sourced from `quickfurno-core`. The two
 * are different claims, and this package keeps them apart.
 *
 * ### `indeterminate` is the field that matters most
 *
 * Most result contracts have `success | failure`. That is a bug, and it is the
 * expensive kind: it forces an ambiguous provider response — a timeout, a dropped
 * connection mid-dial, a webhook that never arrived — to be recorded as one or the
 * other. Recorded as failure, the system retries and someone's phone rings twice.
 * Recorded as success, a founder believes a conversation happened that did not.
 *
 * So ambiguity is a **first-class outcome**. When the answer to "did that call
 * connect?" is *we do not know*, the contract says exactly that, and it requires
 * the result to be classified as `requires-reconciliation`. The rule from
 * execution-governance.md §7 is enforced rather than hoped for:
 *
 * > "An ambiguous provider outcome is reconciled before another attempt is made —
 * > the answer to 'did that call connect?' is to find out, not to dial and see."
 *
 * **An indeterminate outcome can never be represented as a success**, because
 * they are different enum members and the schema will not let a caller carry the
 * ambiguity in a success-shaped record.
 *
 * ### What this contract will not carry
 *
 * No raw transcripts, no recordings, no complete unredacted provider payloads, no
 * secrets. `metadata` is bounded and governed and refuses all of them by key and
 * by shape. Transcript and summary processing belongs to the QF Communications
 * Runtime, on the far side of the boundary, and is not part of a generic execution
 * result (communication-model.md, privacy-principles.md).
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

/**
 * The five outcomes. Note that ambiguity has its own.
 *
 * - `succeeded` — the provider did the thing, and we know it.
 * - `failed` — the provider did not, and we know it.
 * - `cancelled` — cancelled before execution, while cancellation was permitted.
 * - `expired` — the intent expired before execution. Not sent, and not approved.
 * - `indeterminate` — **we do not know.** Requires reconciliation before anything
 *   else is attempted. This is not a failure and it is certainly not a success.
 */
export const EXECUTION_OUTCOMES = [
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'indeterminate',
] as const;

export const executionOutcomeSchema = z.enum(EXECUTION_OUTCOMES);
export type ExecutionOutcome = z.infer<typeof executionOutcomeSchema>;

/** Broad, stable classes a failure falls into. Machine-readable, so it can be counted. */
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

/**
 * Retryability is **evidence, not permission.**
 *
 * Classifying a failure as `retryable` says something about the failure. It does
 * not authorize a second external effect. A retry re-attempts the same execution
 * under the same idempotency key; a genuinely new attempt requires a new
 * Core-authorized intent. Nothing in this contract can grant that.
 */
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

  /** Who observed and reported this. Reporting is not authority. */
  reportingSystem: executionReportingSystemSchema,

  /** When QuickFurno Core recorded it. This is the moment it became truth. */
  recordedByCoreAt: utcTimestampSchema,
  /** When the provider says it happened, where the provider says so at all. */
  providerOccurredAt: utcTimestampSchema.optional(),

  outcome: executionOutcomeSchema,

  /** An opaque provider handle — a message id, a call id. Evidence, never authority. */
  providerReference: providerReferenceSchema.optional(),

  failure: executionFailureSchema.optional(),

  /** Bounded and governed. No transcripts, no recordings, no raw payloads, no secrets. */
  metadata: resultMetadataSchema.optional(),

  correlationId: correlationIdSchema,
});

export const executionResultV1Schema = executionResultShapeSchema.superRefine((value, ctx) => {
  // A success that carries a failure is a contradiction, and it is the shape a
  // partially-handled error takes on its way to being ignored.
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

  // Ambiguity must be recorded as ambiguity, and it must be routed to
  // reconciliation rather than to another attempt. "On ambiguity, it fails rather
  // than repeats" — but first, somebody has to go and find out what happened.
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
        message:
          'An indeterminate outcome must be classified "requires-reconciliation": it must never be retried, and it must never be treated as success',
      });
    }
  }
});

export type ExecutionResultV1 = z.infer<typeof executionResultV1Schema>;

/**
 * **The single authoritative payload-schema registry, keyed by `eventType` + `eventVersion`.**
 *
 * ### This is the primary control
 *
 * Every canonical event resolves to **exactly one** payload schema. Every payload is a strict
 * object of explicitly declared, individually bounded fields. There is **no free text**, **no
 * `Record<string, unknown>` freedom**, **no unknown key**, and — this is the part that matters —
 * **no permissive fallback**.
 *
 * > **A payload with nowhere to put a coordinate does not need to be searched for one.**
 *
 * The prohibited-content scan (`common/prohibited-content.ts`) runs over every payload as well,
 * because a schema cannot see *inside* a string and because the next person to add a field will
 * not read this comment. **That is the second lock. This registry is the first**, and a detector
 * must never be asked to do a schema's job.
 *
 * ### Fails closed, and never guesses
 *
 * An unregistered `eventType`, or a registered type at an **unregistered version**, resolves to
 * nothing and is rejected. It is **never** parsed as some other version and never has its
 * unrecognised fields dropped: *"the fields it does not recognise are precisely the ones that
 * changed"* ([ADR-0013](../../../docs/decisions/ADR-0013-canonical-event-envelope-and-versioning.md) §8).
 *
 * ### Why v1 is not here
 *
 * **Version 1 payloads are deliberately absent from this registry**, and that is the whole point
 * of Stage 3.1.4. A v1 observation payload carried `detail` — an arbitrary 500-character string —
 * and `signals`, an open dictionary. Leaving v1 registered would leave the door it opened
 * standing open, and closing the door while leaving the door open is not a fix.
 *
 * The v1 schemas still **exist**, in `event-catalog.ts`, and the regression tests parse against
 * them directly to prove what they used to accept. **They are simply not ingestible.** A v1 event
 * now fails closed — which is safe precisely because **no producer has ever emitted one**
 * (ADR-0025, ADR-0026 §5).
 */

import type { z } from 'zod';

import { approvalDecisionV1Schema } from '../approvals/approval-decision.js';
import { additionalServiceRequestV1Schema } from '../assignments/additional-service.js';
import { assignmentBatchV1Schema } from '../assignments/assignment-batch.js';
import { batchNumberSchema } from '../assignments/assignment-policy.js';
import { clientConfirmationV1Schema } from '../assignments/client-confirmation.js';
import {
  clientReassignmentDecisionV1Schema,
  clientReassignmentRequestV1Schema,
  dissatisfactionSeveritySchema,
} from '../assignments/client-reassignment.js';
import { linkedLeadCreatedV1Schema } from '../assignments/linked-lead.js';
import { communicationAuthorizationV1Schema } from '../communications/communication-authorization.js';
import { communicationChannelSchema } from '../communications/communication-channel.js';
import { communicationResultV1Schema } from '../communications/communication-result.js';
import { communicationStateRecordV1Schema } from '../communications/communication-state-record.js';
import {
  humanHandoffRecordV1Schema,
  humanHandoffRequestV1Schema,
} from '../communications/human-handoff.js';
import {
  additionalServiceRequestIdSchema,
  assignmentBatchIdSchema,
  clientConfirmationIdSchema,
} from '../common/identifiers.js';
import { entityReferenceSchema } from '../common/entity-reference.js';
import { machineTokenSchema } from '../common/text.js';
import { utcTimestampSchema } from '../common/timestamp.js';
import { executionIntentV1Schema } from '../execution/execution-intent.js';
import { executionResultV1Schema } from '../execution/execution-result.js';
import { policyVersionChangeV1Schema } from '../governance/policy-version.js';
import { erasureRecordV1Schema, erasureRequestV1Schema } from '../privacy/erasure.js';
import { recommendationLifecycleRecordV1Schema } from '../recommendations/recommendation-lifecycle.js';
import { recommendationV1Schema } from '../recommendations/recommendation.js';
import { z as zod } from 'zod';
import {
  contractPayloadV2,
  leadCategoryShape,
  observationPayloadV2,
  qualitativeBandSchema,
  unitIntervalSchema,
} from './payload-primitives.js';
import {
  categoryCreatedPayloadSchema,
  categoryDeactivatedPayloadSchema,
  categoryUpdatedPayloadSchema,
  cityCreatedPayloadSchema,
  cityDeactivatedPayloadSchema,
  cityUpdatedPayloadSchema,
  subcategoryCreatedPayloadSchema,
  subcategoryDeactivatedPayloadSchema,
  subcategoryMovedPayloadSchema,
  subcategoryUpdatedPayloadSchema,
  taxonomyVersionPublishedPayloadSchema,
} from './taxonomy-events.js';

/** How a client's lifecycle ended. */
const clientOutcomeSchema = zod.enum(['converted', 'lost', 'abandoned', 'withdrawn']);

/**
 * The registry. **One entry per event type per version. No wildcards. No defaults.**
 *
 * The `@2` on every non-taxonomy event is the privacy hardening: v1 exists, and is not ingestible.
 * The taxonomy events are new in this stage, so they begin — correctly — at `@1`.
 */
export const CANONICAL_PAYLOAD_SCHEMAS = {
  // --- Architecture lifecycle: recommend -> authorize -> execute -> report ---
  // The contract shapes are unchanged; what they gained is a guard over the human-authored text
  // inside them. A recommendation's `rationale` must exist and must be challengeable — and it
  // must still be structurally unable to carry somebody's coordinates.
  'qf.recommendation.created@2': contractPayloadV2({ recommendation: recommendationV1Schema }),
  'qf.recommendation.lifecycle-state-recorded@2': contractPayloadV2({
    record: recommendationLifecycleRecordV1Schema,
  }),
  'qf.approval.decision-recorded@2': contractPayloadV2({ decision: approvalDecisionV1Schema }),
  'qf.execution.intent-issued@2': contractPayloadV2({ intent: executionIntentV1Schema }),
  'qf.execution.result-recorded@2': contractPayloadV2({ result: executionResultV1Schema }),
  'qf.communication.state-recorded@2': contractPayloadV2({
    record: communicationStateRecordV1Schema,
  }),

  // --- The client journey ---
  'qf.client.requirement-completed@2': observationPayloadV2(leadCategoryShape),
  'qf.client.follow-up-due-detected@2': observationPayloadV2({
    ...leadCategoryShape,
    dueAt: utcTimestampSchema,
  }),
  'qf.client.follow-up-completed@2': observationPayloadV2({
    ...leadCategoryShape,
    channel: communicationChannelSchema.optional(),
  }),
  'qf.client.satisfaction-recorded@2': observationPayloadV2(leadCategoryShape),
  'qf.client.dissatisfaction-recorded@2': observationPayloadV2({
    ...leadCategoryShape,
    severity: dissatisfactionSeveritySchema,
  }),
  'qf.client.complaint-recorded@2': observationPayloadV2({
    lead: entityReferenceSchema.optional(),
    category: entityReferenceSchema.optional(),
    severity: qualitativeBandSchema,
  }),
  'qf.client.reassignment-requested@2': contractPayloadV2({
    request: clientReassignmentRequestV1Schema,
  }),
  'qf.client.reassignment-authorized@2': contractPayloadV2({
    decision: clientReassignmentDecisionV1Schema,
  }),
  'qf.client.reassignment-rejected@2': contractPayloadV2({
    decision: clientReassignmentDecisionV1Schema,
  }),
  'qf.assignment.batch-created@2': contractPayloadV2({ batch: assignmentBatchV1Schema }),
  'qf.assignment.batch-completed@2': observationPayloadV2({
    ...leadCategoryShape,
    assignmentBatchId: assignmentBatchIdSchema,
    batchNumber: batchNumberSchema,
  }),
  'qf.client.additional-service-identified@2': contractPayloadV2({
    request: additionalServiceRequestV1Schema,
  }),
  'qf.client.additional-service-confirmed@2': observationPayloadV2({
    additionalServiceRequestId: additionalServiceRequestIdSchema,
    clientConfirmation: clientConfirmationV1Schema,
    proposedCategory: entityReferenceSchema,
  }),
  'qf.client.additional-service-rejected@2': observationPayloadV2({
    additionalServiceRequestId: additionalServiceRequestIdSchema,
    proposedCategory: entityReferenceSchema,
  }),
  'qf.lead.linked-created@2': contractPayloadV2({ link: linkedLeadCreatedV1Schema }),
  'qf.client.review-requested@2': observationPayloadV2({
    ...leadCategoryShape,
    clientConfirmationId: clientConfirmationIdSchema.optional(),
  }),
  'qf.client.lifecycle-closed@2': observationPayloadV2({
    ...leadCategoryShape,
    outcome: clientOutcomeSchema,
  }),

  // --- The vendor journey. Money-adjacent events carry BANDS, never balances. ---
  'qf.vendor.registration-started@2': observationPayloadV2({
    registrationChannelCode: machineTokenSchema.optional(),
  }),
  'qf.vendor.profile-completed@2': observationPayloadV2({
    completeness: unitIntervalSchema.optional(),
  }),
  'qf.vendor.verification-requested@2': observationPayloadV2({}),
  'qf.vendor.activated@2': observationPayloadV2({}),
  'qf.vendor.inactivity-detected@2': observationPayloadV2({
    inactiveSinceAt: utcTimestampSchema,
  }),
  'qf.vendor.performance-updated@2': observationPayloadV2({
    performanceBand: qualitativeBandSchema,
  }),
  'qf.vendor.package-readiness-changed@2': observationPayloadV2({
    readinessBand: qualitativeBandSchema,
  }),
  'qf.vendor.recharge-opportunity-detected@2': observationPayloadV2({
    opportunityBand: qualitativeBandSchema,
  }),
  'qf.vendor.complaint-recorded@2': observationPayloadV2({ severity: qualitativeBandSchema }),
  'qf.vendor.retention-risk-detected@2': observationPayloadV2({ riskBand: qualitativeBandSchema }),
  'qf.vendor.winback-candidate-detected@2': observationPayloadV2({
    candidacyBand: qualitativeBandSchema,
  }),

  // --- Governance, privacy, and communication authority ---
  'qf.privacy.erasure-requested@2': contractPayloadV2({ request: erasureRequestV1Schema }),
  'qf.privacy.erasure-recorded@2': contractPayloadV2({ record: erasureRecordV1Schema }),
  'qf.policy.version-changed@2': contractPayloadV2({ change: policyVersionChangeV1Schema }),
  'qf.communication.authorization-recorded@2': contractPayloadV2({
    authorization: communicationAuthorizationV1Schema,
  }),
  'qf.communication.result-recorded@2': contractPayloadV2({ result: communicationResultV1Schema }),
  'qf.communication.human-handoff-requested@2': contractPayloadV2({
    request: humanHandoffRequestV1Schema,
  }),
  'qf.communication.human-handoff-recorded@2': contractPayloadV2({
    record: humanHandoffRecordV1Schema,
  }),

  // --- Taxonomy. New in Stage 3.1.4, so version 1 is correct and there is nothing to supersede. ---
  'qf.taxonomy.city-created@1': cityCreatedPayloadSchema,
  'qf.taxonomy.city-updated@1': cityUpdatedPayloadSchema,
  'qf.taxonomy.city-deactivated@1': cityDeactivatedPayloadSchema,
  'qf.taxonomy.category-created@1': categoryCreatedPayloadSchema,
  'qf.taxonomy.category-updated@1': categoryUpdatedPayloadSchema,
  'qf.taxonomy.category-deactivated@1': categoryDeactivatedPayloadSchema,
  'qf.taxonomy.subcategory-created@1': subcategoryCreatedPayloadSchema,
  'qf.taxonomy.subcategory-moved@1': subcategoryMovedPayloadSchema,
  'qf.taxonomy.subcategory-updated@1': subcategoryUpdatedPayloadSchema,
  'qf.taxonomy.subcategory-deactivated@1': subcategoryDeactivatedPayloadSchema,
  'qf.taxonomy.version-published@1': taxonomyVersionPublishedPayloadSchema,
} as const;

export type CanonicalPayloadKey = keyof typeof CANONICAL_PAYLOAD_SCHEMAS;

/** `type@version` — the one key format, so nobody invents a second one. */
export function canonicalPayloadKey(eventType: string, eventVersion: number): string {
  return `${eventType}@${String(eventVersion)}`;
}

/**
 * Resolve the payload schema for an event type and version.
 *
 * **Returns `undefined` for anything unregistered, and the caller must fail.** There is no
 * fallback schema to return, because a fallback schema is a schema that accepts an event nobody
 * designed.
 */
export function resolveCanonicalPayloadSchema(
  eventType: string,
  eventVersion: number,
): z.ZodType | undefined {
  const key = canonicalPayloadKey(eventType, eventVersion);

  return Object.prototype.hasOwnProperty.call(CANONICAL_PAYLOAD_SCHEMAS, key)
    ? (CANONICAL_PAYLOAD_SCHEMAS as Record<string, z.ZodType>)[key]
    : undefined;
}

/** Every registered `type@version`, for tests and for the audit. */
export const CANONICAL_PAYLOAD_KEYS: readonly string[] = Object.keys(CANONICAL_PAYLOAD_SCHEMAS);
